import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import type { AppSlotRecord, AppSlotsState } from '@shared/types'
import writeFileAtomic from 'write-file-atomic'
import { mt } from './settings'
import { buildPosixRollbackScript, buildWindowsRollbackScript } from './rollbackscript'

/**
 * A/B 版本槽：把「当前运行的安装目标」压缩归档为「上一版」（只保留一个），
 * 需要时再用一个脱离本进程的脚本把它还原回去。
 *
 * 为什么不是真·双槽并行启动：本项目用 NSIS / dmg / AppImage 安装，安装目录由
 * 安装器固定，无法在启动阶段切槽。这里用「归档 + 还原」得到等价效果：
 *  - 更新安装前，把旧版整目录（或 AppImage 单文件）压成 tar.gz，只留一个；
 *  - 新版连续启动失败时自动还原（见 appupdate 的启动守卫）；
 *  - 用户也可在「关于」页手动回退一个版本。
 *
 * 回退本身也可能失败（最典型的就是装到 `C:\Program Files` 却没有管理员权限），
 * 因此这里的每一环都不能"失败还装作成功"：
 *  - 起脚本前先探测安装目录是否真的可写，不可写直接如实报错，不起脚本；
 *  - 脚本（见 rollbackscript.ts）有等待/重试上限、检查 tar 退出码，失败不重启；
 *  - 结果落 `rollback-<版本>.result`，由应用下次启动消费（见 takeRollbackResult）；
 *  - 每轮待安装记录至多发起一次回退（beginRollback 计数），杜绝"回退 → 启动 → 再回退"。
 */

/** 安装目标形态：Windows / mac 是目录，Linux AppImage 是单个文件。 */
export interface InstallTarget {
    kind: 'dir' | 'file'
    /** 目录本身，或 AppImage 文件路径。 */
    path: string
}

/** 待重启安装的更新记录（供启动守卫与自动回退使用）。 */
export interface PendingUpdate {
    /** 目标版本。 */
    to: string
    /** 来源版本。 */
    from: string | null
    /** 已启动新版但尚未确认健康的次数。 */
    attempts: number
    /**
     * 已发起过的回退次数。每轮记录至多 1 次：回退脚本起过之后如果当前版本**还是**目标版本，
     * 说明回退没生效，再试只会重复失败 —— 由启动守卫改用「放弃」处理（见 bootguard.ts）。
     */
    rollbacks?: number
    at: number
}

/** `app-slots/manifest.json` 的结构。 */
export interface SlotsManifest {
    current: string | null
    previous: AppSlotRecord | null
    pending: PendingUpdate | null
    updatedAt: number
}

/** 回退结果（message 已本地化，可直接展示）。 */
export interface RollbackResult {
    ok: boolean
    message: string
    version: string | null
}

let cachedTar: string | null = null

/** 版本槽目录：`<userData>/app-slots`。 */
export function slotsDir(): string {
    return path.join(app.getPath('userData'), 'app-slots')
}

/** 归档文件名（同一版本只保留一份）。 */
export function archiveName(version: string): string {
    return `${version}.tar.gz`
}

function manifestFile(): string {
    return path.join(slotsDir(), 'manifest.json')
}

/**
 * 当前安装目标：
 *  - Windows：exe 所在目录；
 *  - macOS：从 exe 向上找到的 .app 包；
 *  - Linux：APPIMAGE 指向的单文件，取不到时退回 exe 所在目录。
 */
export function installTarget(): InstallTarget {
    const exe = process.execPath
    if (process.platform === 'darwin') {
        let p = exe
        for (let i = 0; i < 6; i++) {
            if (p.endsWith('.app')) return { kind: 'dir', path: p }
            const up = path.dirname(p)
            if (up === p) break
            p = up
        }
        return { kind: 'dir', path: path.dirname(exe) }
    }
    if (process.platform === 'linux' && process.env.APPIMAGE) {
        return { kind: 'file', path: process.env.APPIMAGE }
    }
    return { kind: 'dir', path: path.dirname(exe) }
}

/** 取系统 tar（Windows 10+ 自带 bsdtar，支持 tar.gz）。 */
function tarBinary(): string {
    if (cachedTar) return cachedTar
    if (process.platform === 'win32' && process.env.SystemRoot) {
        const p = path.join(process.env.SystemRoot, 'System32', 'tar.exe')
        if (fs.existsSync(p)) return (cachedTar = p)
    }
    return (cachedTar = 'tar')
}

/** 读取槽清单；缺失或损坏时返回空清单。 */
export function readManifest(): SlotsManifest {
    try {
        const m = JSON.parse(fs.readFileSync(manifestFile(), 'utf8')) as Partial<SlotsManifest>
        return {
            current: typeof m.current === 'string' ? m.current : null,
            previous: m.previous && typeof m.previous.version === 'string' ? m.previous : null,
            pending: m.pending && typeof m.pending.to === 'string' ? m.pending : null,
            updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : 0
        }
    } catch {
        return { current: null, previous: null, pending: null, updatedAt: 0 }
    }
}

/** 原子写槽清单：交给 write-file-atomic（它额外处理同一路径的并发写与中断清理）。 */
export function writeManifest(m: SlotsManifest): void {
    try {
        fs.mkdirSync(slotsDir(), { recursive: true })
        writeFileAtomic.sync(manifestFile(), JSON.stringify({ ...m, updatedAt: Date.now() }, null, 2), 'utf8')
    } catch {
        /* 写失败不影响主流程 */
    }
}

/** 归档文件是否仍在磁盘上。 */
function archiveExists(rec: AppSlotRecord | null): boolean {
    try {
        return !!rec && fs.existsSync(path.join(slotsDir(), rec.archive))
    } catch {
        return false
    }
}

/** 对外状态（设置页展示）。 */
export function appSlotsState(): AppSlotsState {
    const m = readManifest()
    return {
        current: app.getVersion(),
        previous: archiveExists(m.previous) ? m.previous : null,
        pending: m.pending?.to ?? null,
        canRollback: archiveExists(m.previous)
    }
}

/** 运行 tar；成功返回 true。 */
function runTar(args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const child = spawn(tarBinary(), args, { windowsHide: true, stdio: 'ignore' })
            child.on('error', () => resolve(false))
            child.on('close', (code) => resolve(code === 0))
        } catch {
            resolve(false)
        }
    })
}

/** 清理其余历史归档，只保留 `keep`（「保留一个版本」）。 */
function pruneArchives(keep: string): void {
    try {
        for (const f of fs.readdirSync(slotsDir())) {
            if (f !== keep && f.endsWith('.tar.gz')) fs.rmSync(path.join(slotsDir(), f), { force: true })
        }
    } catch {
        /* ignore */
    }
}

/**
 * 把当前安装目标压缩归档为「上一版」。版本未变且归档仍在时直接复用。
 * 归档成功会同时清理旧归档并写回清单。
 */
export async function archiveRunningVersion(): Promise<boolean> {
    const version = app.getVersion()
    const m = readManifest()
    if (m.previous?.version === version && archiveExists(m.previous)) return true

    const target = installTarget()
    try {
        fs.mkdirSync(slotsDir(), { recursive: true })
    } catch {
        return false
    }
    const name = archiveName(version)
    const archive = path.join(slotsDir(), name)
    try {
        fs.rmSync(archive, { force: true })
    } catch {
        /* ignore */
    }
    const ok = await runTar(['-czf', archive, '-C', path.dirname(target.path), path.basename(target.path)])
    if (!ok) {
        try {
            fs.rmSync(archive, { force: true })
        } catch {
            /* ignore */
        }
        return false
    }
    let bytes = 0
    try {
        bytes = fs.statSync(archive).size
    } catch {
        /* ignore */
    }
    pruneArchives(name)
    writeManifest({
        ...m,
        previous: { version, archive: name, createdAt: Date.now(), bytes }
    })
    return true
}

/** 记录「已下载、待重启安装」的更新，供启动守卫判断。 */
export function stagePendingUpdate(to: string): void {
    const m = readManifest()
    if (m.pending?.to === to) return
    writeManifest({ ...m, pending: { to, from: m.current, attempts: 0, at: Date.now() } })
}

/** 清除待安装记录（安装完成，或确认新版健康）。 */
export function clearPending(): void {
    const m = readManifest()
    if (m.pending) writeManifest({ ...m, pending: null })
}

/** 记一次「启动新版但尚未确认健康」，返回累计次数。 */
export function noteBootAttempt(to: string): number {
    const m = readManifest()
    const attempts = (m.pending?.to === to ? m.pending.attempts : 0) + 1
    writeManifest({
        ...m,
        pending: {
            to,
            from: m.pending?.to === to ? m.pending.from : m.current,
            attempts,
            rollbacks: m.pending?.to === to ? m.pending.rollbacks : 0,
            at: Date.now()
        }
    })
    return attempts
}

/**
 * 记一次「已发起回退」：同时把本次启动计入 attempts，写入回退次数。
 *
 * 这一次写盘是**防死循环的关键**：即使脚本因权限、被杀、机器重启等原因没有回写结果，
 * 下次启动也能从 `rollbacks` 看出「已经回退过一轮却没换回版本」，从而停止重试。
 */
export function beginRollback(to: string): void {
    const m = readManifest()
    const prev = m.pending && m.pending.to === to ? m.pending : null
    writeManifest({
        ...m,
        pending: {
            to,
            from: prev ? prev.from : m.current,
            attempts: (prev?.attempts ?? 0) + 1,
            rollbacks: (prev?.rollbacks ?? 0) + 1,
            at: Date.now()
        }
    })
}

/** 回退脚本回写的结果文件：`<slots>/rollback-<版本>.result`。 */
function rollbackResultFile(version: string): string {
    return path.join(slotsDir(), `rollback-${version}.result`)
}

/**
 * 取走并清除回退脚本留下的结果（没有则返回 null）。
 *
 * 脚本在解包成功/失败时都会写这个文件；应用下次启动据此知道上一轮回退是成了还是废了 ——
 * 失败时必须停止重试并如实报错，而不是再起一轮（那正是"无限重启"的来源）。
 */
export function takeRollbackResult(): { version: string; ok: boolean } | null {
    let newest: { version: string; mtime: number } | null = null
    try {
        for (const f of fs.readdirSync(slotsDir())) {
            const hit = /^rollback-(.+)\.result$/.exec(f)
            if (!hit) continue
            const mtime = fs.statSync(path.join(slotsDir(), f)).mtimeMs
            if (!newest || mtime > newest.mtime) newest = { version: hit[1], mtime }
        }
    } catch {
        return null
    }
    if (!newest) return null
    const file = rollbackResultFile(newest.version)
    let text = ''
    try {
        text = fs.readFileSync(file, 'utf8')
    } catch {
        /* 读不到就按失败处理 */
    }
    try {
        fs.rmSync(file, { force: true })
    } catch {
        /* ignore */
    }
    return { version: newest.version, ok: /^ok\b/i.test(text.trim()) }
}

/** 清理一小时前的回退残留（脚本名带时间戳，正在跑的不会被误删）。 */
function pruneRollbackScripts(keep: string): void {
    const cutoff = Date.now() - 3600_000
    try {
        for (const f of fs.readdirSync(slotsDir())) {
            if (f === keep || !/^rollback-.+\.(cmd|sh|log)$/.test(f)) continue
            const p = path.join(slotsDir(), f)
            try {
                if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true })
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }
}

/**
 * 目标父目录是否真的可写：写一个探针文件再删掉。
 *
 * `fs.accessSync(dir, W_OK)` 在 Windows 上不看 ACL，判不准；而这里必须判准 ——
 * 装到 `C:\Program Files` 又没有管理员权限时，解包**必然**失败，那就别起脚本了。
 */
function canWriteDir(dir: string): boolean {
    const probe = path.join(dir, `.dsbox-write-probe-${process.pid}-${Date.now()}`)
    try {
        fs.writeFileSync(probe, '')
        fs.rmSync(probe, { force: true })
        return true
    } catch {
        return false
    }
}

/**
 * 生成回退脚本：等待本进程退出 → 解包覆盖安装目标 → 重新启动应用。
 * 返回脚本路径；失败返回 null。
 */
function writeRollbackScript(archive: string, target: InstallTarget, version: string): string | null {
    const parent = path.dirname(target.path)
    const tar = tarBinary()
    const resultFile = rollbackResultFile(version)
    const logFile = path.join(slotsDir(), 'rollback.log')
    // 脚本名带时间戳：旧实例还在按偏移读取时，新脚本不会覆盖它（老实现同名覆盖会让 cmd 读到错位内容）
    const stamp = Date.now()
    try {
        fs.mkdirSync(slotsDir(), { recursive: true })
    } catch {
        return null
    }

    if (process.platform === 'win32') {
        const file = path.join(slotsDir(), `rollback-${version}-${stamp}.cmd`)
        // Windows 上安装目标是目录，重启要用其中的可执行文件。
        const relaunch = target.kind === 'file' ? target.path : process.execPath
        const text = buildWindowsRollbackScript({
            tar,
            archive,
            parent,
            relaunch,
            resultFile,
            logFile,
            pid: process.pid,
            image: path.basename(process.execPath)
        })
        try {
            fs.writeFileSync(file, text, 'utf8')
            pruneRollbackScripts(file)
            return file
        } catch {
            return null
        }
    }

    const file = path.join(slotsDir(), `rollback-${version}-${stamp}.sh`)
    const relaunch =
        process.platform === 'darwin'
            ? `open "${target.path}"`
            : target.kind === 'file'
                ? `chmod +x "${target.path}"; "${target.path}" >/dev/null 2>&1 &`
                : `"${process.execPath}" >/dev/null 2>&1 &`
    const text = buildPosixRollbackScript({
        tar,
        archive,
        parent,
        relaunch,
        resultFile,
        logFile,
        pid: process.pid
    })
    try {
        fs.writeFileSync(file, text, { encoding: 'utf8', mode: 0o755 })
        pruneRollbackScripts(file)
        return file
    } catch {
        return null
    }
}

/** 迁走当前版本号（每次启动写入，供 UI 与待安装记录对照）。 */
export function syncCurrentVersion(version: string): void {
    const m = readManifest()
    if (m.current !== version) writeManifest({ ...m, current: version })
}

/** 回退成功后清掉已变旧的归档记录。 */
export function dropPreviousIfCurrent(version: string): void {
    const m = readManifest()
    if (m.previous?.version === version) {
        try {
            fs.rmSync(path.join(slotsDir(), m.previous.archive), { force: true })
        } catch {
            /* ignore */
        }
        writeManifest({ ...m, previous: null })
    }
}

/**
 * 回退到压缩保留的上一版：起一个脱离本进程的脚本，等本进程退出后解包覆盖并重启。
 * 调用方拿到 ok 后应尽快 `app.exit()`，把舞台让给脚本。
 *
 * 起脚本之前先确认「解包这步真的可能成功」：安装目录父目录不可写（典型：
 * `C:\Program Files` 下的 per-machine 安装、当前用户无管理员权限）时直接返回失败。
 * 否则脚本必然解包失败，却仍会重启应用 → 变成「回退 → 启动 → 再回退」的无限循环。
 */
export function restorePrevious(): RollbackResult {
    const m = readManifest()
    const rec = m.previous
    if (!rec) return { ok: false, message: mt('m.appUpdate.noRollback'), version: null }
    const archive = path.join(slotsDir(), rec.archive)
    if (!fs.existsSync(archive)) return { ok: false, message: mt('m.appUpdate.rollbackMissing'), version: null }

    const target = installTarget()
    if (!canWriteDir(path.dirname(target.path))) {
        return { ok: false, message: mt('m.appUpdate.rollbackNoPermission'), version: null }
    }

    const script = writeRollbackScript(archive, target, rec.version)
    if (!script) return { ok: false, message: mt('m.appUpdate.rollbackFail'), version: null }

    try {
        if (process.platform === 'win32') {
            const child = spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true })
            child.unref()
        } else {
            const child = spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' })
            child.unref()
        }
    } catch {
        return { ok: false, message: mt('m.appUpdate.rollbackFail'), version: null }
    }
    return { ok: true, message: mt('m.appUpdate.rollbackStarted', { version: rec.version }), version: rec.version }
}
