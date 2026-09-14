import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import type { AppSlotRecord, AppSlotsState } from '@shared/types'
import { mt } from './settings'

/**
 * A/B 版本槽：把「当前运行的安装目标」压缩归档为「上一版」（只保留一个），
 * 需要时再用一个脱离本进程的脚本把它还原回去。
 *
 * 为什么不是真·双槽并行启动：本项目用 NSIS / dmg / AppImage 安装，安装目录由
 * 安装器固定，无法在启动阶段切槽。这里用「归档 + 还原」得到等价效果：
 *  - 更新安装前，把旧版整目录（或 AppImage 单文件）压成 tar.gz，只留一个；
 *  - 新版连续启动失败时自动还原（见 appupdate 的启动守卫）；
 *  - 用户也可在「关于」页手动回退一个版本。
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

/** 原子写槽清单（先写临时文件再 rename，避免留下半截 JSON）。 */
export function writeManifest(m: SlotsManifest): void {
    try {
        fs.mkdirSync(slotsDir(), { recursive: true })
        const tmp = manifestFile() + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify({ ...m, updatedAt: Date.now() }, null, 2), 'utf8')
        fs.renameSync(tmp, manifestFile())
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
            at: Date.now()
        }
    })
    return attempts
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
 * 生成回退脚本：等待本进程退出 → 解包覆盖安装目标 → 重新启动应用。
 * 返回脚本路径；失败返回 null。
 */
function writeRollbackScript(archive: string, target: InstallTarget, version: string): string | null {
    const parent = path.dirname(target.path)
    const pid = process.pid
    const tar = tarBinary()
    try {
        fs.mkdirSync(slotsDir(), { recursive: true })
    } catch {
        return null
    }

    if (process.platform === 'win32') {
        const file = path.join(slotsDir(), `rollback-${version}.cmd`)
        // Windows 上安装目标是目录，重启要用其中的可执行文件。
        const relaunch = target.kind === 'file' ? target.path : process.execPath
        // 用镜像名而不是 PID 判断存活，避免与 tasklist 的内存列数字误匹配。
        const image = path.basename(process.execPath)
        const lines = [
            '@echo off',
            'setlocal',
            ':wait',
            `tasklist /FI "PID eq ${pid}" /NH 2>nul | findstr /I /C:"${image}" >nul`,
            'if not errorlevel 1 (',
            '  timeout /t 1 /nobreak >nul',
            '  goto wait',
            ')',
            `"${tar}" -xzf "${archive}" -C "${parent}"`,
            `start "" "${relaunch}"`,
            'del "%~f0" >nul 2>nul'
        ]
        try {
            fs.writeFileSync(file, lines.join('\r\n') + '\r\n', 'utf8')
            return file
        } catch {
            return null
        }
    }

    const file = path.join(slotsDir(), `rollback-${version}.sh`)
    const relaunch =
        process.platform === 'darwin'
            ? `open "${target.path}"`
            : target.kind === 'file'
                ? `chmod +x "${target.path}"; "${target.path}" >/dev/null 2>&1 &`
                : `"${process.execPath}" >/dev/null 2>&1 &`
    const lines = [
        '#!/bin/sh',
        `while kill -0 ${pid} 2>/dev/null; do sleep 1; done`,
        `"${tar}" -xzf "${archive}" -C "${parent}"`,
        relaunch,
        'rm -f "$0"'
    ]
    try {
        fs.writeFileSync(file, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o755 })
        return file
    } catch {
        return null
    }
}

/**
 * 回退到压缩保留的上一版：起一个脱离本进程的脚本，等本进程退出后解包覆盖并重启。
 * 调用方拿到 ok 后应尽快 `app.exit()`，把舞台让给脚本。
 */
export function restorePrevious(): RollbackResult {
    const m = readManifest()
    const rec = m.previous
    if (!rec) return { ok: false, message: mt('m.appUpdate.noRollback'), version: null }
    const archive = path.join(slotsDir(), rec.archive)
    if (!fs.existsSync(archive)) return { ok: false, message: mt('m.appUpdate.rollbackMissing'), version: null }

    const script = writeRollbackScript(archive, installTarget(), rec.version)
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
