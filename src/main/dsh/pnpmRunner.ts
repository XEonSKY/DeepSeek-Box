import path from 'node:path'
import fs from 'node:fs'
import type { InstalledVersions, NodeDeployProgress, PnpmSource, PnpmStatus, PnpmRuntimeStatus, Settings, ToolActionResult } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { IS_WIN } from '../kernel/runtime'
import { loadSettings, mt, bundledPnpmDir, tempDownloadDir, tempNpmDir, tempPnpmStoreDir } from '../app/settings'
import { nodeRuntimeForCfg, findSystemPnpm } from './tools'
import { hasSystemNpm, runNpm } from './npmRunner'
import { probeVersion } from './child'
import { removeQuietly } from '../kernel/treeops'
import { extractTar, findSystemTar } from './tarutil'
import { compareVersions, stripV, sortVersionsDesc } from './semver'
import { downloadFile } from './download'
import { pnpmEntryIn } from './pnpmEntry'
import { httpFetch } from './http'
import { beginCancelable, CANCELED_MESSAGE } from '../kernel/operations'
import { activeVersion, installRoot, listInstalled, prepareVersionDir, removeVersion, setActiveVersion, versionDir } from './installs'
import { registryBase } from './registry'

/**
 * pnpm 的获取 / 运行层：与内置 npm（npmRunner.ts）同一套「版本化目录 + 下载 tarball 解压」流程，
 * 供 dsh 自身的 `dsh plugin` 等命令在 profile 目录里执行字面量 `pnpm` 时使用。
 *
 * **两种来源**（settings.pnpmSource）：
 *  - `bundled`（默认）：应用把 pnpm 的 tarball 解压到 `<configDir>/pnpm/<版本>`，运行时用垫片让 dsh 找到它；
 *  - `system`：直接用系统 PATH 上的 pnpm（dsh 本来就能找到），这里只负责探测版本 / 用系统 npm 升级它。
 *
 * pnpm 以 npm 包形式发布，运行方式与内置 npm-cli.js 一致：用当前 Node 运行时直接执行它的 JS 入口。
 * **入口文件名别写死** —— pnpm 12 起是 `package/bin/pnpm.mjs`（manifest 的 bin 指向根级 `pnpm`，
 * 那是个 sh 脚本，node 跑不了），≤ 11 才是 `bin/pnpm.cjs`：统一走 `pnpmEntry.ts` 的候选解析。
 */

/** 内置 pnpm 的入口（见 pnpmEntry.ts；尚未下载时返回的路径不存在）。 */
export function bundledPnpmCli(): string {
    return pnpmEntryIn(bundledPnpmDir())
}

/** pnpm 的缓存 / store 环境：全部钉到配置目录下的临时区，不污染用户主目录。 */
export function pnpmStoreEnv(): NodeJS.ProcessEnv {
    const store = tempPnpmStoreDir()
    const cache = tempNpmDir()
    try {
        fs.mkdirSync(store, { recursive: true })
        fs.mkdirSync(cache, { recursive: true })
    } catch {
        /* 目录创建失败时交给 pnpm 自己处理 */
    }
    return { npm_config_cache: cache, npm_config_store_dir: store }
}

/** 内置 pnpm 跑在所选 Node 运行时上（与 dsh 同一个 Node）；取不到运行时返回 null。 */
function pnpmNode(): { exec: string; env: NodeJS.ProcessEnv } | null {
    try {
        const rt = nodeRuntimeForCfg()
        return { exec: rt.exec, env: { ...process.env, ...rt.env, ...pnpmStoreEnv() } }
    } catch {
        return null
    }
}

/** 系统 pnpm 的版本（未安装 → null）。Windows 上 .cmd 必须经 shell 启动，且带空格的路径要加引号。 */
function systemPnpmVersion(): Promise<string | null> {
    const p = findSystemPnpm()
    if (!p) return Promise.resolve(null)
    return probeVersion(IS_WIN ? `"${p}"` : p, ['--version'], { ...process.env, ...pnpmStoreEnv() }, IS_WIN)
}

/**
 * 系统 pnpm 的位置（`pnpmSource === 'system'` 时插件安装直接用它）。
 * 找不到返回 null —— 调用方回落到内置 pnpm。
 */
export function systemPnpmPath(): string | null {
    return findSystemPnpm()
}

/** registry 元数据的短缓存（键含 registry）。失败不缓存。 */
const REG_TTL_MS = 10 * 60 * 1000
let latestCache: { key: string; at: number; version: string | null } | null = null
let listCache: { key: string; at: number; list: string[] } | null = null

/** registry 上的最新 pnpm 版本（失败返回 null，不缓存失败）。 */
export async function pnpmLatestVersion(cfg: Settings): Promise<string | null> {
    const key = cfg.npmRegistry
    if (latestCache && latestCache.key === key && Date.now() - latestCache.at < REG_TTL_MS) {
        return latestCache.version
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    try {
        const res = await httpFetch('npm', `${registryBase(key)}/pnpm/latest`, { signal: ctrl.signal })
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

/** 可安装的 pnpm 版本列表（新 → 旧）。用 registry 缩写元数据，结果缓存 10 分钟。 */
export async function listPnpmVersions(cfg: Settings, prerelease: boolean): Promise<string[]> {
    const key = cfg.npmRegistry
    let all: string[]
    if (listCache && listCache.key === key && Date.now() - listCache.at < REG_TTL_MS) {
        all = listCache.list
    } else {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 30000)
        try {
            const res = await httpFetch('npm', `${registryBase(key)}/pnpm`, {
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

/** 内置 pnpm 的版本（尚未下载到配置目录 → null）。 */
function bundledPnpmVersion(): Promise<string | null> {
    const cli = bundledPnpmCli()
    if (!fs.existsSync(cli)) return Promise.resolve(null)
    const n = pnpmNode()
    return n ? probeVersion(n.exec, [cli, '--version'], n.env) : Promise.resolve(null)
}

/** pnpm 来源探测结果：系统 / 内置的版本 + registry 最新版。 */
export async function pnpmStatus(): Promise<PnpmStatus> {
    const cfg = loadSettings()
    const [latest, system, bundled] = await Promise.all([pnpmLatestVersion(cfg), systemPnpmVersion(), bundledPnpmVersion()])
    const mk = (version: string | null): PnpmRuntimeStatus => ({
        present: !!version,
        version,
        outdated: !!version && !!latest && compareVersions(stripV(version), stripV(latest)) < 0
    })
    return { latest, system: mk(system), bundled: mk(bundled) }
}

/**
 * 确保内置 pnpm 可用：把 tarball 解压到 `<configDir>/pnpm/<版本>/` 并设为生效版本。
 * 不传 version 时：已有生效版本直接复用，否则拉最新版。
 */
async function ensureBundledPnpm(
    cfg: Settings,
    version?: string,
    onProgress?: (p: NodeDeployProgress) => void,
    signal?: AbortSignal
): Promise<{ ok: boolean; cli?: string; message?: string; canceled?: boolean }> {
    const activeCli = bundledPnpmCli()
    if (version === undefined && fs.existsSync(activeCli)) return { ok: true, cli: activeCli }

    const target = version ?? (await pnpmLatestVersion(cfg))
    if (!target) return { ok: false, message: mt('m.dsh.bundledPnpmFetchFail') }
    if (!/^\d+\.\d+\.\d+/.test(target)) return { ok: false, message: `pnpm 版本号不合法：${target}` }

    const dest = versionDir('pnpm', target)
    const cli = pnpmEntryIn(dest)
    if (fs.existsSync(cli)) {
        setActiveVersion('pnpm', target)
        return { ok: true, cli }
    }

    const base = registryBase(cfg.npmRegistry)
    const stage = path.join(installRoot('pnpm'), '.tmp')
    try {
        await removeQuietly(stage)
        await fs.promises.mkdir(stage, { recursive: true })
    } catch (err) {
        return { ok: false, message: errorMessage(err) }
    }
    const tgz = path.join(stage, `pnpm-${target}.tgz`)
    const dl = await downloadFile({
        url: `${base}/pnpm/-/pnpm-${target}.tgz`,
        destDir: stage,
        fileName: `pnpm-${target}.tgz`,
        tmpDir: tempDownloadDir(),
        threads: cfg.downloadThreads,
        signal,
        proxyScope: 'npm',
        onProgress: (p) => onProgress?.({ phase: 'download', ...p })
    })
    if (dl.canceled) {
        await removeQuietly(stage)
        return { ok: false, canceled: true, message: CANCELED_MESSAGE }
    }
    if (!dl.ok) {
        await removeQuietly(stage)
        return { ok: false, message: mt('m.dsh.bundledPnpmFetchFail') }
    }
    if (!findSystemTar()) {
        await removeQuietly(stage)
        return { ok: false, message: mt('m.dsh.bundledPnpmNoTar') }
    }

    onProgress?.({ phase: 'extract', percent: 100, downloaded: 0, total: 0, speed: 0 })
    let destDir: string
    try {
        destDir = await prepareVersionDir('pnpm', target)
    } catch (err) {
        await removeQuietly(stage)
        return { ok: false, message: errorMessage(err) }
    }
    const okExtract = await extractTar(tgz, destDir, 'pnpm', signal)
    await removeQuietly(stage)
    if (signal?.aborted) {
        await removeVersion('pnpm', target)
        return { ok: false, canceled: true, message: CANCELED_MESSAGE }
    }
    if (!okExtract || !fs.existsSync(cli)) {
        await removeVersion('pnpm', target)
        return { ok: false, message: okExtract ? mt('m.dsh.bundledPnpmMissing') : mt('m.dsh.bundledPnpmExtractFail') }
    }
    setActiveVersion('pnpm', target)
    return { ok: true, cli }
}

/** 首次插件安装前用：确保内置 pnpm 可用（已缓存直接返回，否则下载最新版）。 */
export async function ensureBundledPnpmReady(opts?: { version?: string }, onProgress?: (p: NodeDeployProgress) => void): Promise<ToolActionResult> {
    const token = beginCancelable()
    try {
        const r = await ensureBundledPnpm(loadSettings(), opts?.version, onProgress, token.signal)
        if (r.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: opts?.version ?? null }
        return r.ok
            ? { ok: true, message: 'pnpm 已就绪', version: opts?.version ?? null }
            : { ok: false, message: r.message ?? mt('m.dsh.bundledPnpmFetchFail'), version: opts?.version ?? null }
    } finally {
        token.done()
    }
}

/**
 * 安装 / 切换到指定 pnpm 版本（不传 version 为最新版）。
 * `source === 'system'` 时交给系统 npm 装全局 pnpm（pnpm 官方推荐的安装方式就是 `npm i -g pnpm`）。
 */
export async function updatePnpm(
    opts: { source: PnpmSource; version?: string },
    onProgress?: (p: NodeDeployProgress) => void
): Promise<ToolActionResult> {
    const token = beginCancelable()
    try {
        const cfg = loadSettings()
        const target = opts.version ?? (await pnpmLatestVersion(cfg))
        if (!target) return { ok: false, message: mt('m.dsh.bundledPnpmFetchFail'), version: null }
        if (!/^\d+\.\d+\.\d+/.test(target)) return { ok: false, message: `pnpm 版本号不合法：${target}`, version: null }

        if (opts.source === 'system') {
            if (!hasSystemNpm()) return { ok: false, message: mt('m.dsh.noSystemNpm'), version: null }
            const s = await runNpm(['install', '-g', `pnpm@${target}`], `npm install -g pnpm@${target}`, token.signal)
            if (s.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: target }
            return s.ok
                ? { ok: true, message: `pnpm ${target} 已装入系统`, version: target }
                : { ok: false, message: mt('m.dsh.systemPnpmFail'), version: target }
        }

        const r = await ensureBundledPnpm(cfg, target, onProgress, token.signal)
        if (r.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: target }
        return r.ok
            ? { ok: true, message: `pnpm ${target} 已缓存到配置目录`, version: target }
            : { ok: false, message: r.message ?? mt('m.dsh.bundledPnpmFetchFail'), version: target }
    } finally {
        token.done()
    }
}

/** 已安装 / 生效的内置 pnpm 版本。 */
export function listInstalledPnpmVersions(): InstalledVersions {
    return { installed: listInstalled('pnpm'), active: activeVersion('pnpm') }
}

/** 切换内置 pnpm 生效版本（只改指针，不重装）。 */
export function usePnpmVersion(version: string): ToolActionResult {
    if (!listInstalled('pnpm').includes(version)) return { ok: false, message: `未安装 pnpm ${version}`, version: null }
    setActiveVersion('pnpm', version)
    return { ok: true, message: `已切换到 pnpm ${version}`, version }
}

/** 删除某个已安装的内置 pnpm 版本。 */
export async function removeInstalledPnpmVersion(version: string): Promise<ToolActionResult> {
    await removeVersion('pnpm', version)
    return { ok: true, message: `已删除 pnpm ${version}`, version }
}

/**
 * 为 `dsh plugin` 准备一个带 pnpm 的进程环境：dsh 在 profile 目录里执行字面量 `pnpm`，
 * 而内置 pnpm 是 JS 入口，所以这里生成一个同名的 `pnpm` / `pnpm.cmd` 垫片目录并前置到 PATH。
 * 调用前必须已确保内置 pnpm 就绪（已下载到配置目录）。
 * @param cli - 内置 pnpm 的入口绝对路径（见 pnpmEntry.ts）。
 * @returns 可直接作为 `dsh plugin` 子进程 env 的环境变量。
 */
export function pnpmShimEnv(cli: string): NodeJS.ProcessEnv {
    const rt = nodeRuntimeForCfg()
    const dir = path.join(installRoot('pnpm'), '.shim')
    fs.mkdirSync(dir, { recursive: true })
    if (IS_WIN) {
        fs.writeFileSync(path.join(dir, 'pnpm.cmd'), `@echo off\r\n"${rt.exec}" "${cli}" %*\r\n`)
    } else {
        const shim = path.join(dir, 'pnpm')
        fs.writeFileSync(shim, `#!/bin/sh\nexec "${rt.exec}" "${cli}" "$@"\n`)
        try {
            fs.chmodSync(shim, 0o755)
        } catch {
            /* 权限位设置失败时仍尝试执行 */
        }
    }
    const env: NodeJS.ProcessEnv = { ...process.env, ...rt.env, ...pnpmStoreEnv() }
    const nextPath = dir + path.delimiter + (env.PATH || '')
    env.PATH = nextPath
    // Windows 环境变量大小写不敏感，但 Node 的 env 是普通对象，两个键都写上更稳。
    env.Path = nextPath
    return env
}
