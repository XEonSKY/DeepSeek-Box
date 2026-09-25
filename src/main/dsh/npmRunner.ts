import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import type { InstalledVersions, NodeDeployProgress, NodeRuntimeKind, NpmRuntimeStatus, NpmSource, NpmStatus, Settings, ToolActionResult } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { IS_WIN } from '../app/runtime'
import { loadSettings, mt, bundledNpmDir, tempDownloadDir, tempNpmDir } from '../app/settings'
import { nodeRuntimeFor, nodeRuntimeForCfg, localNodeNpmCli, findSystemNpm, pathEnv, findInDirs } from './tools'
import { localNodeDir } from './nodeenv'
import { probeVersion, runChild } from './child'
import { removeQuietly } from './fsutil'
import { compareVersions, stripV, sortVersionsDesc } from './semver'
import { pushLog } from './logbus'
import { downloadFile } from './downloader'
import { httpFetch } from './http'
import { proxyEnv, npmProxyArgs } from './net'
import { beginCancelable, CANCELED_MESSAGE } from './cancel'
import { activeVersion, installRoot, listInstalled, prepareVersionDir, removeVersion, setActiveVersion, versionDir } from './installs'
// registry 基址搬去 registry.ts（纯模块，可单测）；本文件只作为使用方引入。
import { registryBase } from './registry'

/**
 * npm / 外部工具的调用层：如何按所选来源（系统 npm、内置 npm、本地 Node 自带 npm）
 * 与代理设置真正把命令跑起来，并把输出接进日志视图。
 *
 * 从 manage.ts 抽出：manage.ts 负责「装哪个版本、装到哪、失败怎么诊断」，
 * 本模块只负责「怎么把它们跑起来」——两者关注点不同，分开后各自更好读。
 */

export type ToolResult = { ok: boolean; stderrTail: string; canceled?: boolean }

/**
 * 把 npm 的缓存目录钉到 `<工作目录>/temp/npm`：所有 npm 调用（dsh 安装、npm 自更新、
 * 内置 / 本地 Node 的 npm）都带上它，避免污染用户主目录的 ~/.npm。
 */
function npmCacheEnv(): NodeJS.ProcessEnv {
    const dir = tempNpmDir()
    try {
        fs.mkdirSync(dir, { recursive: true })
    } catch {
        /* 目录创建失败时交给 npm 自己处理 */
    }
    return { npm_config_cache: dir }
}

/** 跑一个命令并把 stdout/stderr 接进日志视图（转义与尾部诊断交给 runChild）。 */
async function runTool(exec: string, argv: string[], label: string, opts: { shell: boolean; env?: NodeJS.ProcessEnv }, signal?: AbortSignal): Promise<ToolResult> {
    pushLog('o', `[Manager] ${label} …`)
    const r = await runChild(
        exec,
        {
            argv,
            cwd: os.homedir(),
            env: opts.env ?? process.env,
            shell: opts.shell,
            stderrTailLimit: 3000,
            onStdoutLine: (line) => {
                pushLog('o', line)
                console.log('[Manager]', line)
            },
            onStderr: (s) => {
                pushLog('e', s)
                console.error('[Manager]', s.replace(/\n/g, '\n[Manager]'))
            }
        },
        signal
    )
    if (r.ok) pushLog('o', `[Manager] ${label} completed.`)
    else pushLog('e', `[Manager] ${label} failed (code=${r.code}).`)
    return { ok: r.ok, stderrTail: r.stderrTail, canceled: r.canceled }
}

/** Run the system `npm` (npm.cmd on Windows). */
export function runNpm(args: string[], label: string, signal?: AbortSignal): Promise<ToolResult> {
    const cfg = loadSettings()
    const env = { ...process.env, ...proxyEnv(cfg, 'npm'), ...npmCacheEnv() }
    return runTool(IS_WIN ? 'npm.cmd' : 'npm', [...args, ...npmProxyArgs(cfg)], label, { shell: IS_WIN, env }, signal)
}

/** Run an npm-cli.js under a Node runtime (used for the bundled / localnode npm). */
function runNpmCli(cli: string, args: string[], label: string, runtime?: NodeRuntimeKind, signal?: AbortSignal): Promise<ToolResult> {
    const cfg = loadSettings()
    // 默认用与 dsh 相同的 Node 运行时（DSH_NODE 覆盖同样生效）。
    const rt = runtime ? nodeRuntimeFor(runtime) : nodeRuntimeForCfg(cfg)
    const env = { ...process.env, ...rt.env, ...proxyEnv(cfg, 'npm'), ...npmCacheEnv() }
    return runTool(rt.exec, [cli, ...args, ...npmProxyArgs(cfg)], label, { shell: false, env }, signal)
}

export function runNpmInstallGlobal(pkg: string, registry?: 'npmjs' | 'npmmirror', signal?: AbortSignal): Promise<ToolResult> {
    const args = ['install', '-g', pkg]
    if (registry) args.push(`--registry=${registryBase(registry)}`)
    return runNpm(args, `npm install -g ${pkg}`, signal)
}

/** Whether a system `npm` is available on PATH (or the Windows global prefix). 导出给 pnpm 的 system 来源复用。 */
export function hasSystemNpm(): boolean {
    const dirs = pathEnv()
    if (IS_WIN) {
        dirs.push(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'))
        return findInDirs(dirs, ['npm.cmd', 'npm.bat']) !== undefined
    }
    return findInDirs(dirs, ['npm']) !== undefined
}

/** Resolve the bundled npm's npm-cli.js after it has been fetched + extracted. */
function bundledNpmCli(): string {
    return path.join(bundledNpmDir(), 'package', 'bin', 'npm-cli.js')
}

// ---- 版本探测 / 列表（安静：不写日志视图）----------------------------------
// 环境页每次进入都要问版本，**绝不能**走 runTool（它把输出推进终端日志，会刷屏）。

/** 内置 npm 跑在所选 Node 运行时上（与 dsh 同一个 Node）；取不到运行时返回 null。 */
function npmNode(): { exec: string; env: NodeJS.ProcessEnv } | null {
    try {
        const rt = nodeRuntimeForCfg()
        return { exec: rt.exec, env: { ...process.env, ...rt.env, ...npmCacheEnv() } }
    } catch {
        return null
    }
}

/** 系统 npm 的版本（没有系统 npm → null）。 */
function systemNpmVersion(): Promise<string | null> {
    const p = findSystemNpm()
    if (!p) return Promise.resolve(null)
    // Windows 上 .cmd 必须经 shell 启动，而 shell 模式下**带空格的路径**会被拆成两段，
    // 所以显式加引号（npm 常装在 C:\Program Files\nodejs 下）。
    return probeVersion(IS_WIN ? `"${p}"` : p, ['--version'], { ...process.env, ...npmCacheEnv() }, IS_WIN)
}

/** 内置 npm 的版本（尚未下载到配置目录 → null）。 */
function bundledNpmVersion(): Promise<string | null> {
    const cli = bundledNpmCli()
    if (!fs.existsSync(cli)) return Promise.resolve(null)
    const n = npmNode()
    return n ? probeVersion(n.exec, [cli, '--version'], n.env) : Promise.resolve(null)
}

/** 本地部署 Node 自带 npm 的版本（未部署本地 Node → null）。 */
function localNodeNpmVersion(): Promise<string | null> {
    const cli = localNodeNpmCli()
    if (!cli) return Promise.resolve(null)
    try {
        const rt = nodeRuntimeFor('local')
        return probeVersion(rt.exec, [cli, '--version'], { ...process.env, ...rt.env, ...npmCacheEnv() })
    } catch {
        return Promise.resolve(null)
    }
}

/**
 * registry 元数据的短缓存（键含 registry，换源后不串味）。
 * npm 的 packument 动辄几 MB，不能每次进设置页都拉；**失败不缓存**。
 */
const REG_TTL_MS = 10 * 60 * 1000
let latestCache: { key: string; at: number; version: string | null } | null = null
let listCache: { key: string; at: number; list: string[] } | null = null

/** registry 上的最新 npm 版本（失败返回 null，不缓存失败）。 */
export async function npmLatestVersion(cfg: Settings): Promise<string | null> {
    const key = cfg.npmRegistry
    if (latestCache && latestCache.key === key && Date.now() - latestCache.at < REG_TTL_MS) {
        return latestCache.version
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    try {
        const res = await httpFetch('npm', `${registryBase(key)}/npm/latest`, { signal: ctrl.signal })
        if (!res.ok) return null
        const meta = (await res.json()) as { version?: unknown }
        if (typeof meta.version !== 'string' || !meta.version) return null
        latestCache = { key, at: Date.now(), version: meta.version }
        return meta.version
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

/**
 * 可安装的 npm 版本列表（新 → 旧）。
 * 用 registry 的**缩写元数据**（`application/vnd.npm.install-v1+json`）：完整 packument 有好几 MB，
 * 缩写版小得多；结果按 registry 缓存 10 分钟（失败不缓存）。
 */
export async function listNpmVersions(cfg: Settings, prerelease: boolean): Promise<string[]> {
    const key = cfg.npmRegistry
    let all: string[]
    if (listCache && listCache.key === key && Date.now() - listCache.at < REG_TTL_MS) {
        all = listCache.list
    } else {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 30000)
        try {
            const res = await httpFetch('npm', `${registryBase(key)}/npm`, {
                signal: ctrl.signal,
                headers: { accept: 'application/vnd.npm.install-v1+json' }
            })
            if (!res.ok) return []
            const meta = (await res.json()) as { versions?: Record<string, unknown> }
            const keys = meta.versions ? Object.keys(meta.versions) : []
            if (keys.length === 0) return []
            all = keys
            listCache = { key, at: Date.now(), list: keys }
        } catch {
            return []
        } finally {
            clearTimeout(timer)
        }
    }
    return sortVersionsDesc(all, prerelease)
}

/** 三个 npm 来源的当前版本 + registry 最新版（设置 → 环境页）。 */
export async function npmStatus(): Promise<NpmStatus> {
    const cfg = loadSettings()
    const [latest, system, bundled, localnode] = await Promise.all([
        npmLatestVersion(cfg),
        systemNpmVersion(),
        bundledNpmVersion(),
        localNodeNpmVersion()
    ])
    const mk = (version: string | null): NpmRuntimeStatus => ({
        present: !!version,
        version,
        outdated: !!version && !!latest && compareVersions(stripV(version), stripV(latest)) < 0
    })
    return { latest, system: mk(system), bundled: mk(bundled), localnode: mk(localnode) }
}

/** Locate a system `tar` (Windows ships tar.exe in System32). */
function findSystemTar(): string | null {
    const dirs = pathEnv()
    const names = IS_WIN ? ['tar.exe', 'tar'] : ['tar']
    if (IS_WIN) dirs.push(path.join(process.env.WINDIR || 'C:\\Windows', 'System32'))
    return findInDirs(dirs, names) ?? null
}

/**
 * 确保「程序内置」npm 可用：把 tarball 解压到 `<configDir>/npm/<版本>/` 并设为生效版本。
 *
 * `version` 指定要装哪个版本；不传时：已有生效版本直接复用，否则拉最新版。
 * cpu/取消经 signal 传递（下载与解压阶段都可中止）。
 */
/** 解压 tar.gz 到目标目录；取消时杀掉子进程。 */
function extractTar(tgz: string, dest: string, signal?: AbortSignal): Promise<boolean> {
    const tar = findSystemTar()
    if (!tar) return Promise.resolve(false)
    pushLog('o', '[Manager] 解压 npm 压缩包…')
    return runChild(tar, { argv: ['-xzf', tgz, '-C', dest], onStderr: (s) => pushLog('e', s) }, signal).then((r) => r.ok)
}

async function ensureBundledNpm(
    cfg: Settings,
    version?: string,
    onProgress?: (p: NodeDeployProgress) => void,
    signal?: AbortSignal
): Promise<{ ok: boolean; cli?: string; message?: string; canceled?: boolean }> {
    const activeCli = bundledNpmCli()
    if (version === undefined && fs.existsSync(activeCli)) return { ok: true, cli: activeCli }

    const target = version ?? (await npmLatestVersion(cfg))
    if (!target) return { ok: false, message: mt('m.dsh.bundledNpmFetchFail') }
    if (!/^\d+\.\d+\.\d+/.test(target)) return { ok: false, message: `npm 版本号不合法：${target}` }

    const dest = versionDir('npm', target)
    const cli = path.join(dest, 'package', 'bin', 'npm-cli.js')
    if (fs.existsSync(cli)) {
        setActiveVersion('npm', target)
        return { ok: true, cli }
    }

    const base = registryBase(cfg.npmRegistry)
    const stage = path.join(installRoot('npm'), '.tmp')
    try {
        await removeQuietly(stage)
        await fs.promises.mkdir(stage, { recursive: true })
    } catch (err) {
        return { ok: false, message: errorMessage(err) }
    }
    const tgz = path.join(stage, `npm-${target}.tgz`)
    const dl = await downloadFile({
        url: `${base}/npm/-/npm-${target}.tgz`,
        destDir: stage,
        fileName: `npm-${target}.tgz`,
        tmpDir: tempDownloadDir(),
        threads: cfg.downloadThreads,
        signal,
        // 内置 npm 的安装包属于「npm 安装 / 下载」这一档代理范围
        proxyScope: 'npm',
        onProgress: (p) => onProgress?.({ phase: 'download', ...p })
    })
    if (dl.canceled) {
        await removeQuietly(stage)
        return { ok: false, canceled: true, message: CANCELED_MESSAGE }
    }
    if (!dl.ok) {
        await removeQuietly(stage)
        return { ok: false, message: mt('m.dsh.bundledNpmFetchFail') }
    }
    if (!findSystemTar()) {
        await removeQuietly(stage)
        return { ok: false, message: mt('m.dsh.bundledNpmNoTar') }
    }

    onProgress?.({ phase: 'extract', percent: 100, downloaded: 0, total: 0, speed: 0 })
    let destDir: string
    try {
        destDir = await prepareVersionDir('npm', target)
    } catch (err) {
        await removeQuietly(stage)
        return { ok: false, message: errorMessage(err) }
    }
    const okExtract = await extractTar(tgz, destDir, signal)
    await removeQuietly(stage)
    if (signal?.aborted) {
        await removeVersion('npm', target)
        return { ok: false, canceled: true, message: CANCELED_MESSAGE }
    }
    if (!okExtract || !fs.existsSync(cli)) {
        await removeVersion('npm', target)
        return { ok: false, message: okExtract ? mt('m.dsh.bundledNpmMissing') : mt('m.dsh.bundledNpmExtractFail') }
    }
    setActiveVersion('npm', target)
    return { ok: true, cli }
}

/**
 * Pick the npm to use for a LOCAL install per cfg.npmSource:
 *  - 'system'   : the system npm (error when none).
 *  - 'bundled'  : the bundled npm (fetched/cached on first use).
 *  - 'localnode': the npm bundled with the deployed local Node.
 * `cli === null` means "use the system npm"; otherwise the npm-cli.js path,
 * plus the Node runtime it must run under.
 */
async function chooseLocalNpm(cfg: Settings, signal?: AbortSignal): Promise<{ ok: boolean; cli: string | null; runtime?: NodeRuntimeKind; message?: string; canceled?: boolean }> {
    if (cfg.npmSource === 'bundled') {
        const b = await ensureBundledNpm(cfg, undefined, undefined, signal)
        // runtime 留空：由 runNpmCli 取当前设置的 nodeRuntime（默认 local）。
        return b.ok && b.cli ? { ok: true, cli: b.cli } : { ok: false, cli: null, message: b.message, canceled: b.canceled }
    }
    if (cfg.npmSource === 'localnode') {
        const cli = localNodeNpmCli()
        if (!cli) return { ok: false, cli: null, message: mt('m.dsh.noLocalNodeNpm') }
        return { ok: true, cli, runtime: 'local' }
    }
    if (hasSystemNpm()) return { ok: true, cli: null }
    return { ok: false, cli: null, message: mt('m.dsh.noSystemNpm') }
}

/**
 * 首次安装向导用：确保「程序内置」npm 可用。
 *
 * 与 updateNpm 不同，这里**不强制升级** —— 已缓存就直接返回，只有尚未缓存时才下载最新版，
 * 并通过 onProgress 上报下载进度，供向导在「NPM 环境」这一步展示后进入下一步。
 */
/**
 * 首次安装向导用：确保「程序内置」npm 可用。
 *
 * 不传 version 时**不强制升级** —— 已缓存就直接返回，只有尚未缓存时才下载最新版；
 * 通过 onProgress 上报下载 / 解压进度，供向导展示后进入下一步。
 */
export async function ensureBundledNpmReady(opts?: { version?: string }, onProgress?: (p: NodeDeployProgress) => void): Promise<ToolActionResult> {
    const token = beginCancelable()
    try {
        const r = await ensureBundledNpm(loadSettings(), opts?.version, onProgress, token.signal)
        if (r.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: opts?.version ?? null }
        return r.ok
            ? { ok: true, message: 'npm 已就绪', version: opts?.version ?? null }
            : { ok: false, message: r.message ?? mt('m.dsh.bundledNpmFetchFail'), version: opts?.version ?? null }
    } finally {
        token.done()
    }
}

/** 已安装 / 生效的内置 npm 版本。 */
export function listInstalledNpmVersions(): InstalledVersions {
    return { installed: listInstalled('npm'), active: activeVersion('npm') }
}

/** 切换内置 npm 生效版本（只改指针，不重装）。 */
export function useNpmVersion(version: string): ToolActionResult {
    if (!listInstalled('npm').includes(version)) return { ok: false, message: `未安装 npm ${version}`, version: null }
    setActiveVersion('npm', version)
    return { ok: true, message: `已切换到 npm ${version}`, version }
}

/** 删除某个已安装的内置 npm 版本。 */
export async function removeInstalledNpmVersion(version: string): Promise<ToolActionResult> {
    await removeVersion('npm', version)
    return { ok: true, message: `已删除 npm ${version}`, version }
}

/** Local install into <configDir>/dsh via `npm --prefix`. */
export async function runLocalNpmInstall(target: string, cfg: Settings, prefix: string, signal?: AbortSignal): Promise<{ ok: boolean; stderrTail: string; fatal?: string; canceled?: boolean }> {
    const npm = await chooseLocalNpm(cfg, signal)
    if (!npm.ok) return { ok: false, stderrTail: '', fatal: npm.message, canceled: npm.canceled }
    try {
        fs.mkdirSync(prefix, { recursive: true })
        const pkgFile = path.join(prefix, 'package.json')
        if (!fs.existsSync(pkgFile)) {
            fs.writeFileSync(pkgFile, JSON.stringify({ name: 'dsbox-dsh', private: true, version: '0.0.0' }, null, 2))
        }
    } catch (err) {
        return { ok: false, stderrTail: '', fatal: errorMessage(err) }
    }
    const args = ['install', '--prefix', prefix, '--no-audit', '--no-fund', target]
    if (cfg.npmRegistry) args.push(`--registry=${registryBase(cfg.npmRegistry)}`)
    const label = `npm install ${target} (local)`
    return npm.cli ? runNpmCli(npm.cli, args, label, npm.runtime, signal) : runNpm(args, label, signal)
}

/**
 * 把 npm 的失败输出整理成一句能照着做的提示。
 * 权限类错误（EPERM/EACCES）最常见的原因是：npm 的全局 prefix 指向了系统 Node 目录
 * （`C:\Program Files\nodejs`），在 Windows 上写它需要管理员权限。
 */
function npmFailMessage(tail: string): string {
    const t = (tail || '').trim()
    if (/EPERM|EACCES/i.test(t)) {
        return '权限不足（EPERM）：npm 需要写入受保护的目录。这通常是因为全局 prefix 指向了系统 Node 目录 —— 系统来源需要以管理员身份运行，或改用「程序内置 / 本机 Node 自带」把包装进配置目录。'
    }
    return t.slice(-400) || 'npm 执行失败。'
}

/**
 * 按来源下载 / 切换 npm 版本（不传 `version` 为最新版）。设置页「环境 → npm 来源」用。
 *
 *  - `bundled`  ：拉 tarball 解压缓存到 `<configDir>/npm`（应用代管）；
 *  - `system`   ：交给**系统 npm 自己**执行 `npm install -g npm@<版本>` —— 这是 npm 官方的自更新
 *                 方式，但会**真实改动系统全局 npm**（这是设置页上明说过的）；
 *  - `localnode`：用本地 Node 的 npm 装进 `<configDir>/node`，应用代管。
 *
 * 后两者会把过程输出接进终端日志（复用 runNpm / runNpmCli 的既有行为），捆绑下载则只看结果。
 */
export async function updateNpm(opts: { source: NpmSource; version?: string }, onProgress?: (p: NodeDeployProgress) => void): Promise<ToolActionResult> {
    const token = beginCancelable()
    try {
        const cfg = loadSettings()
        const target = opts.version ?? (await npmLatestVersion(cfg))
        if (!target) return { ok: false, message: mt('m.dsh.bundledNpmFetchFail'), version: null }
        // 版本号会被拼进下载 URL 与 npm 参数，必须挡住意外/恶意字符串。
        if (!/^\d+\.\d+\.\d+/.test(target)) return { ok: false, message: `npm 版本号不合法：${target}`, version: null }

        if (opts.source === 'bundled') {
            const r = await ensureBundledNpm(cfg, target, onProgress, token.signal)
            if (r.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: target }
            return r.ok
                ? { ok: true, message: `npm ${target} 已缓存到配置目录`, version: target }
                : { ok: false, message: r.message ?? mt('m.dsh.bundledNpmFetchFail'), version: target }
        }

        if (opts.source === 'localnode') {
            const cli = localNodeNpmCli()
            if (!cli) return { ok: false, message: mt('m.dsh.noLocalNodeNpm'), version: null }
            const r = await runNpmCli(cli, ['install', '-g', `npm@${target}`, '--prefix', localNodeDir()], `npm install -g npm@${target} (local node)`, 'local', token.signal)
            if (r.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: target }
            return r.ok
                ? { ok: true, message: `npm ${target} 已装入本地 Node`, version: target }
                : { ok: false, message: npmFailMessage(r.stderrTail), version: target }
        }

        if (!hasSystemNpm()) return { ok: false, message: mt('m.dsh.noSystemNpm'), version: null }
        const r = await runNpm(['install', '-g', `npm@${target}`], `npm install -g npm@${target}`, token.signal)
        if (r.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: target }
        return r.ok
            ? { ok: true, message: `npm ${target} 已更新`, version: target }
            : { ok: false, message: npmFailMessage(r.stderrTail), version: target }
    } finally {
        token.done()
    }
}
