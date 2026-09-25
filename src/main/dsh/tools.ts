import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { IS_WIN } from '../kernel/runtime'
import { installRoot, listInstalled, resolveActive, versionDir } from './installs'
import { nodeModulesRootOf } from './dshHome'
import { probeVersion } from './child'
import { readPkgVersion } from '../kernel/treeops'
import type { NodeRuntimeKind } from '@shared/types'

/**
 * dsh / tooling location helpers.
 *
 * @deepseek-ai/dsh may be installed in two ways:
 *   - local ('local', default): installed by this app into <configDir>/dsh
 *     and run with the Node deployed under the config directory.
 *   - global ('global'): the system `npm install -g @deepseek-ai/dsh`, found on PATH.
 *
 * Either way we launch dsh by running its real JS bin entry under a Node
 * runtime we pick, instead of a shell `.cmd` shim.
 */

/** PATH 上的目录列表（去掉空项）。供各处定位系统工具复用。 */
export function pathEnv(): string[] {
    return (process.env.PATH || '').split(path.delimiter).filter(Boolean)
}

/** 在若干目录里按名称顺序找第一个存在的文件；找到返回绝对路径，否则 undefined。 */
export function findInDirs(dirs: string[], names: string[]): string | undefined {
    for (const dir of dirs) {
        for (const n of names) {
            const p = path.join(dir, n)
            if (fs.existsSync(p)) return p
        }
    }
    return undefined
}

/** Where the app-managed (local) dsh is installed: `<configDir>/dsh/<版本>/node_modules/@deepseek-ai/dsh`. */
function localDshModuleDir(): string {
    const active = resolveActive('dsh')
    const base = active ? versionDir('dsh', active) : installRoot('dsh')
    return path.join(base, 'node_modules', '@deepseek-ai', 'dsh')
}

/**
 * Resolve the JS bin entry of a package from its module dir (reads package.json
 * `bin`, preferring the entry mapped to `dsh`, falling back to `main`).
 */
function resolveModuleBin(moduleDir: string): string | null {
    let pkg: { bin?: unknown; main?: string }
    try {
        pkg = JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8')) as {
            bin?: unknown
            main?: string
        }
    } catch {
        return null
    }
    let rel: string | null = null
    const bin = pkg.bin
    if (typeof bin === 'string') {
        rel = bin
    } else if (bin && typeof bin === 'object') {
        const map = bin as Record<string, string>
        const pick = Object.keys(map).find((k) => k === 'dsh') ?? Object.keys(map)[0]
        if (pick) rel = map[pick]
    }
    const candidates = [rel, pkg.main ?? null].filter((c): c is string => !!c)
    for (const c of candidates) {
        const abs = path.resolve(moduleDir, c)
        if (fs.existsSync(abs)) return abs
    }
    return null
}

/**
 * Walk upward from a resolved launcher path to find the @deepseek-ai/dsh module
 * directory (used for the global install, whose launcher lives in the npm prefix).
 */
function findDshModule(startPath: string): { dir: string; version: string } | null {
    let d = path.dirname(startPath)
    for (let i = 0; i < 5; i++) {
        const moduleDir = path.join(d, 'node_modules', '@deepseek-ai', 'dsh')
        if (fs.existsSync(path.join(moduleDir, 'package.json'))) {
            const version = readPkgVersion(path.join(moduleDir, 'package.json'))
            if (version) return { dir: moduleDir, version }
        }
        // The resolved path might itself point inside the module (e.g. .../bin.js).
        if (path.basename(d) === 'dsh' && fs.existsSync(path.join(d, 'package.json'))) {
            const version = readPkgVersion(path.join(d, 'package.json'))
            if (version) return { dir: d, version }
        }
        d = path.dirname(d)
    }
    return null
}

/** Resolve the global `dsh` launcher on PATH (throws when absent). */
function resolveDshLauncher(configured: string | null): string {
    if (configured) {
        if (!fs.existsSync(configured)) throw new Error(`DSH_BIN / settings.dshBin points at a missing file: ${configured}`)
        return configured
    }
    const want = IS_WIN ? ['dsh.cmd', 'dsh.bat', 'dsh.exe', 'dsh'] : ['dsh']
    const hit = findInDirs(pathEnv(), want)
    if (hit) return hit
    if (IS_WIN) {
        const npm = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm')
        const g = findInDirs([npm], ['dsh.cmd', 'dsh.bat'])
        if (g) return g
    }
    throw new Error('Could not find the `dsh` CLI on PATH. Install it with:\n  npm install -g @deepseek-ai/dsh\nor set DSH_BIN to the launcher path.')
}

/** What we know about the currently effective dsh install for a given setting. */
interface ResolvedDsh {
    kind: 'local' | 'global'
    present: boolean
    /** @deepseek-ai/dsh module directory ('' when unknown). */
    moduleDir: string
    version: string | null
    /** Absolute JS bin entry to run the CLI (null when not present). */
    entry: string | null
}

/** Resolve presence / version / bin entry of the dsh install chosen by cfg.dshSource. */
export function resolveDshModule(cfg: { dshSource?: 'local' | 'global'; dshBin?: string | null }): ResolvedDsh {
    if (cfg.dshSource === 'global') {
        let launcher: string
        try {
            launcher = resolveDshLauncher(cfg.dshBin ?? null)
        } catch {
            return { kind: 'global', present: false, moduleDir: '', version: null, entry: null }
        }
        const m = findDshModule(launcher)
        if (!m) return { kind: 'global', present: true, moduleDir: '', version: null, entry: null }
        return { kind: 'global', present: true, moduleDir: m.dir, version: m.version, entry: resolveModuleBin(m.dir) }
    }
    const moduleDir = localDshModuleDir()
    const present = fs.existsSync(path.join(moduleDir, 'package.json'))
    const version = present ? readPkgVersion(path.join(moduleDir, 'package.json')) : null
    const entry = present ? resolveModuleBin(moduleDir) : null
    return { kind: 'local', present, moduleDir, version, entry }
}

/**
 * dsh 安装目录下的 `node_modules`（解析它的**随附 bundle** 用）；解析不到返回 null。
 *
 * 由 `dshHome.nodeModulesRootOf` 从模块目录反推：`@deepseek-ai/dsh` 是 **scoped** 包，
 * 所以不能简单地取一次 `dirname`（那会得到 `.../node_modules/@deepseek-ai`，
 * 拼出来的 bundle 路径会多一层 `@deepseek-ai`，bundle 层全部找不到 → 模型页显示 0 个供应商）。
 */
export function dshInstallNodeModules(cfg: { dshSource?: 'local' | 'global'; dshBin?: string | null }): string | null {
    const resolved = resolveDshModule(cfg)
    return resolved.present && resolved.moduleDir ? nodeModulesRootOf(resolved.moduleDir) : null
}

/** Locate the system `node` binary on PATH / common install dirs. */
export function findSystemNode(): string | null {
    const want = IS_WIN ? ['node.exe'] : ['node']
    const dirs = pathEnv()
    if (IS_WIN) dirs.push('C:\\Program Files\\nodejs', 'C:\\Program Files (x86)\\nodejs')
    return findInDirs(dirs, want) ?? null
}

/** Locate the system `npm` launcher on PATH / the Windows global prefix. */
export function findSystemNpm(): string | null {
    const want = IS_WIN ? ['npm.cmd', 'npm.bat'] : ['npm']
    const dirs = pathEnv()
    if (IS_WIN) dirs.push(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'))
    return findInDirs(dirs, want) ?? null
}

/**
 * Locate the system `pnpm` launcher on PATH / the Windows global prefix.
 * pnpm 不在 Node 发行版里，通常由 `npm i -g pnpm` 装到与 npm 同一个全局目录，
 * 也可能是 corepack 生成的垫片 —— 这里连同 `.exe` 一起找。
 */
export function findSystemPnpm(): string | null {
    const want = IS_WIN ? ['pnpm.cmd', 'pnpm.exe', 'pnpm.bat'] : ['pnpm']
    const dirs = pathEnv()
    if (IS_WIN) dirs.push(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm'))
    return findInDirs(dirs, want) ?? null
}

/** Ask a node binary for its version (`node --version`), best effort. */
export function nodeVersionOf(nodePath: string): Promise<string | null> {
    return probeVersion(nodePath)
}

/**
 * The Node runtime used to execute the watchdog, the local dsh and any bundled
 * tooling.
 */
export interface NodeRuntime {
    exec: string
    env: Record<string, string>
}

/**
 * 可用的本地 Node 安装目录，按优先级：生效版本 → 其它完整版本 → 平铺旧布局。
 * 这样即使某个版本目录残缺（搬迁时 node.exe 被占用没搬进来），也不会误报「未部署」。
 */
function nodeBaseCandidates(): string[] {
    const out: string[] = []
    const active = resolveActive('node')
    if (active) out.push(versionDir('node', active))
    for (const v of listInstalled('node')) {
        if (v !== active) out.push(versionDir('node', v))
    }
    out.push(installRoot('node'))
    return out
}

/** 应用按架构下载部署到配置目录的 Node 可执行文件（`<configDir>/node/<版本>/`）。 */
export function localNodeExecPath(): string | null {
    for (const base of nodeBaseCandidates()) {
        const exec = IS_WIN ? path.join(base, 'node.exe') : path.join(base, 'bin', 'node')
        if (fs.existsSync(exec)) return exec
    }
    return null
}

/** 部署的本地 Node 自带的 npm-cli（不存在返回 null）。 */
export function localNodeNpmCli(): string | null {
    for (const base of nodeBaseCandidates()) {
        const c = IS_WIN
            ? path.join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js')
            : path.join(base, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
        if (fs.existsSync(c)) return c
    }
    return null
}

/** 按选择的运行时返回 Node 运行方式（不存在时抛错）。 */
export function nodeRuntimeFor(kind: NodeRuntimeKind): NodeRuntime {
    if (kind === 'system') {
        const p = findSystemNode()
        if (!p) throw new Error('System Node is required but was not found on PATH.')
        return { exec: p, env: {} }
    }
    const p = localNodeExecPath()
    if (!p) throw new Error('No locally deployed Node found. Deploy one under the config directory first.')
    return { exec: p, env: {} }
}

/** 依据设置（可选 DSH_NODE 环境覆盖）解析运行 dsh/npm 的 Node。 */
export function nodeRuntimeForCfg(cfg?: { nodeRuntime?: NodeRuntimeKind }): NodeRuntime {
    const override = process.env.DSH_NODE
    if (override) {
        if (!fs.existsSync(override)) throw new Error(`DSH_NODE points at a missing file: ${override}`)
        return { exec: override, env: {} }
    }
    return nodeRuntimeFor(cfg?.nodeRuntime ?? 'local')
}
