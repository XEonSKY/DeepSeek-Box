import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import type { InstalledVersions, DshActionResult, Settings, UpdateResult } from '@shared/types'
import { IS_WIN, broadcast } from '../app/runtime'
import { resolveDshModule } from './tools'
import { loadSettings, mt, localDshDir } from '../app/settings'
import { rememberChild, isDshRunning, stopAllDsh, restart } from './dsh'
import { isPrerelease, compareVersions, filterByPrerelease, pickLatest, sortVersionsDesc } from './semver'
import { registryBase, runNpm, runNpmInstallGlobal, runLocalNpmInstall } from './npmRunner'
import { httpFetch } from './http'
import { beginCancelable, CANCELED_MESSAGE } from './cancel'
import { activeVersion, listInstalled, removeVersion, setActiveVersion, versionDir } from './installs'

// ---------------------------------------------------------------------------
// @deepseek-ai/dsh install & version checks (source-aware: local vs global)
// ---------------------------------------------------------------------------

interface DshInstallInfo {
    present: boolean
    version: string | null
    dir: string | null
    kind: 'local' | 'global'
}

/** Detect whether the dsh install chosen by cfg.dshSource is present, and its version. */
export function resolveInstall(cfg: Settings): DshInstallInfo {
    const k = resolveDshModule(cfg)
    return { present: k.present, version: k.version, dir: k.moduleDir || null, kind: k.kind }
}

export function dshInstalled(): boolean {
    return resolveInstall(loadSettings()).present
}

async function fetchPublishedVersions(registry: 'npmjs' | 'npmmirror'): Promise<string[] | null> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
        // 注册表查询：同时服务于「npm 安装/下载」与「DeepSeek Harness 更新检查」两个代理范围
        const res = await httpFetch('registry', `${registryBase(registry)}/@deepseek-ai%2Fdsh`, { signal: ctrl.signal })
        if (!res.ok) return null
        const data = (await res.json()) as { versions?: Record<string, unknown> }
        if (!data.versions) return null
        return Object.keys(data.versions)
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

/** Run a full install/update check and return a result for the renderer to show. */
export async function performUpdateCheck(
    cfg: Settings,
    opts?: { prerelease?: boolean; registry?: 'npmjs' | 'npmmirror' }
): Promise<UpdateResult> {
    if (opts?.registry && opts.registry !== cfg.npmRegistry) cfg = { ...cfg, npmRegistry: opts.registry }
    const info = resolveInstall(cfg)
    if (!info.present) {
        return {
            status: 'missing',
            current: null,
            latest: null,
            message: mt('m.dsh.missingMsg')
        }
    }
    if (!info.version) {
        return { status: 'error', current: null, latest: null, message: mt('m.dsh.noVersion') }
    }
    const versions = await fetchPublishedVersions(cfg.npmRegistry)
    if (!versions || versions.length === 0) {
        return {
            status: 'error',
            current: info.version,
            latest: null,
            message: mt('m.dsh.registryUnreachable', { version: info.version })
        }
    }
    const pool = filterByPrerelease(versions, opts?.prerelease === true)
    const latest = pickLatest(pool)
    if (!latest) {
        return { status: 'ok', current: info.version, latest: null, message: mt('m.dsh.noComparable') }
    }
    if (compareVersions(info.version, latest) >= 0) {
        return { status: 'ok', current: info.version, latest, message: mt('m.dsh.upToDate', { version: info.version }) }
    }
    const kind = isPrerelease(latest) ? mt('m.dsh.preKind') : mt('m.dsh.stableKind')
    return {
        status: 'update',
        current: info.version,
        latest,
        message: mt('m.dsh.newKind', { kind, current: info.version, latest })
    }
}

// ---------------------------------------------------------------------------
// Uninstall-failure diagnosis (global npm only — the module may be locked)
// ---------------------------------------------------------------------------

function detectHolders(dir: string): Promise<string[]> {
    return new Promise((resolve) => {
        const escDir = dir.replace(/'/g, "''")
        const script = [
            `$rows = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escDir}*' }`,
            '$rows | Sort-Object ProcessId | Select-Object -First 6 | ForEach-Object {',
            '  $c = $_.CommandLine; if ($c -and $c.Length -gt 160) { $c = $c.Substring(0, 160) }',
            '  Write-Output ("{0} {1} :: {2}" -f $_.ProcessId, $_.Name, $c)',
            '}'
        ].join('\n')
        const child = rememberChild(
            spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
                windowsHide: true,
                env: process.env,
                stdio: ['ignore', 'pipe', 'pipe']
            })
        )
        let out = ''
        const timer = setTimeout(() => {
            try {
                child.kill('SIGKILL')
            } catch {
                /* ignore */
            }
        }, 8000)
        child.stdout!.on('data', (d: Buffer) => {
            if (out.length < 6000) out += d.toString()
        })
        child.stderr!.on('data', () => {
            /* ignore */
        })
        const done = (): void => {
            clearTimeout(timer)
            resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
        }
        child.on('error', done)
        child.on('exit', done)
    })
}

function probeDirInUse(dir: string): boolean {
    const tmp = `${dir}.~uninstall-probe-${Date.now()}`
    try {
        fs.renameSync(dir, tmp)
    } catch {
        return true
    }
    try {
        fs.renameSync(tmp, dir)
    } catch {
        try {
            fs.renameSync(tmp, dir)
        } catch {
            console.error('[Manager] could not restore module dir after lock probe:', tmp)
        }
    }
    return false
}

async function uninstallDiagnose(dir: string | null, tail: string): Promise<string> {
    const fallback = mt('m.dsh.uninstallFail', { tail: tail.trim() || '...' })
    if (!dir) return fallback

    const dirExists = fs.existsSync(dir)
    let reason: string
    if (dirExists) {
        const holders = IS_WIN ? await detectHolders(dir) : []
        if (holders.length) {
            reason = mt('m.dsh.uninstallReasonHolder', { procs: holders.slice(0, 5).join('；') })
        } else if (probeDirInUse(dir)) {
            reason = mt('m.dsh.uninstallReasonLocked')
        } else {
            reason = mt('m.dsh.uninstallReasonPresent')
        }
    } else {
        reason = mt('m.dsh.uninstallReasonRemoved')
    }
    return mt('m.dsh.uninstallDiag', { reason, tail: tail.trim() || '...' })
}

let dshBusy = false
function busyMsg(): DshActionResult {
    return { ok: false, message: mt('m.dsh.busy'), version: null }
}

/** Newest considered published versions (newest first). */
export async function listVersions(opts?: { prerelease?: boolean; registry?: 'npmjs' | 'npmmirror' }): Promise<string[]> {
    const cfg = loadSettings()
    const registry = opts?.registry ?? cfg.npmRegistry
    const versions = await fetchPublishedVersions(registry)
    if (!versions) return []
    return sortVersionsDesc(versions, opts?.prerelease ?? cfg.checkPrerelease)
}

async function resolveTargetVersion(cfg: Settings, registry: 'npmjs' | 'npmmirror'): Promise<string> {
    const versions = await fetchPublishedVersions(registry)
    if (!versions || !versions.length) throw new Error(mt('m.dsh.installNoVersions'))
    // 稳定版过滤后为空时退回全量（例如此版本仅在预发布渠道发布），避免「列表有版本却装不了」。
    const picked = pickLatest(filterByPrerelease(versions, cfg.checkPrerelease))
    if (!picked) throw new Error(mt('m.dsh.installNone'))
    return picked
}

/** Upgrade / install dsh to the newest (or a specific) version. */
async function installTo(local: boolean, target: string, registry: 'npmjs' | 'npmmirror', cfg: Settings, signal?: AbortSignal): Promise<DshActionResult> {
    const wasRunning = isDshRunning()
    stopAllDsh()
    let result: { ok: boolean; stderrTail: string; fatal?: string; canceled?: boolean }
    if (local) {
        // 本地 dsh 装进 `<configDir>/dsh/<版本>/`（多版本并存）。
        result = await runLocalNpmInstall(`@deepseek-ai/dsh@${target}`, cfg, versionDir('dsh', target), signal)
    } else {
        result = await runNpmInstallGlobal(`@deepseek-ai/dsh@${target}`, registry, signal)
    }
    if (result.canceled) {
        if (wasRunning) void restart()
        return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: null }
    }
    if (!result.ok) {
        if (wasRunning) void restart()
        const message =
            result.fatal ??
      (local ? mt('m.dsh.localInstallFail', { tail: result.stderrTail.trim() || '...' }) : mt('m.dsh.installFail', { tail: result.stderrTail.trim() || '...' }))
        return { ok: false, message, version: null }
    }
    if (local) setActiveVersion('dsh', target)
    void restart() // bring the new/installed dsh up
    return { ok: true, message: mt('m.dsh.installOk', { version: target }), version: target }
}

/** Upgrade to the newest considered version. */
export async function updateDsh(opts?: { registry?: 'npmjs' | 'npmmirror' }): Promise<DshActionResult> {
    if (dshBusy) return busyMsg()
    const cfg = loadSettings()
    const effRegistry = opts?.registry ?? cfg.npmRegistry
    const local = cfg.dshSource !== 'global'
    const check = await performUpdateCheck(cfg, { prerelease: cfg.checkPrerelease, registry: effRegistry })
    if (check.status !== 'update' || !check.latest) {
        return { ok: false, message: check.message || '', version: null }
    }
    dshBusy = true
    const token = beginCancelable()
    try {
        return await installTo(local, check.latest, effRegistry, cfg, token.signal)
    } finally {
        token.done()
        dshBusy = false
    }
}

/** Install / switch to a version (latest when none given). Fresh installs start dsh. */
export async function installDsh(opts?: { version?: string | null; registry?: 'npmjs' | 'npmmirror' }): Promise<DshActionResult> {
    if (dshBusy) return busyMsg()
    const cfg = loadSettings()
    const registry = opts?.registry ?? cfg.npmRegistry
    const local = cfg.dshSource !== 'global'
    let target = (opts?.version ?? '').trim()
    if (!target) {
        try {
            target = await resolveTargetVersion(cfg, registry)
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : String(err), version: null }
        }
    }
    dshBusy = true
    const token = beginCancelable()
    try {
        return await installTo(local, target, registry, cfg, token.signal)
    } finally {
        token.done()
        dshBusy = false
    }
}

/** Uninstall the effective dsh install. */
export async function uninstallDsh(): Promise<DshActionResult> {
    if (dshBusy) return busyMsg()
    const info = resolveInstall(loadSettings())
    const local = info.kind === 'local'
    dshBusy = true
    try {
        stopAllDsh()
        if (local) {
            try {
                // 删除当前生效的版本目录即可（npm 在 `<configDir>/dsh/<版本>` 下管理它）。
                const active = activeVersion('dsh')
                if (active) removeVersion('dsh', active)
                else fs.rmSync(path.join(localDshDir(), 'node_modules'), { recursive: true, force: true })
            } catch (err) {
                return { ok: false, message: err instanceof Error ? err.message : String(err), version: null }
            }
            broadcast('dsh:missing')
            return { ok: true, message: mt('m.dsh.uninstallOk'), version: null }
        }
        const r = await runNpm(['uninstall', '-g', '@deepseek-ai/dsh'], 'npm uninstall -g @deepseek-ai/dsh')
        if (!r.ok) {
            const message = await uninstallDiagnose(info.dir, r.stderrTail)
            return { ok: false, message, version: null }
        }
        broadcast('dsh:missing')
        return { ok: true, message: mt('m.dsh.uninstallOk'), version: null }
    } finally {
        dshBusy = false
    }
}

/** 已安装 / 生效的本地 dsh 版本。 */
export function listInstalledDshVersions(): InstalledVersions {
    return { installed: listInstalled('dsh'), active: activeVersion('dsh') }
}

/** 切换本地 dsh 生效版本（只改指针并重启，不重装）。 */
export function useDshVersion(version: string): DshActionResult {
    if (!listInstalled('dsh').includes(version)) return { ok: false, message: `未安装 dsh ${version}`, version: null }
    stopAllDsh()
    setActiveVersion('dsh', version)
    void restart()
    return { ok: true, message: mt('m.dsh.installOk', { version }), version }
}

/** 删除某个已安装的本地 dsh 版本；删掉生效版本会自动切到剩余最新版。 */
export function removeInstalledDshVersion(version: string): DshActionResult {
    if (activeVersion('dsh') === version) stopAllDsh()
    removeVersion('dsh', version)
    if (!listInstalled('dsh').length) broadcast('dsh:missing')
    else if (activeVersion('dsh')) void restart()
    return { ok: true, message: `已删除 dsh ${version}`, version }
}
