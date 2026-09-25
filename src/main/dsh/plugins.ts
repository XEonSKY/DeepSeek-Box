import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DshPluginResult, DshPluginsInfo, NodeDeployProgress } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { loadSettings, mt } from '../app/settings'
import { profileDir, profileManifestFile, profilesRoot } from './dshHome'
import { resolveDshModule, nodeRuntimeForCfg } from './tools'
import { runChild } from './child'
import { pushLog } from './logbus'
import { proxyEnv } from './net'
import { beginCancelable, CANCELED_MESSAGE } from '../kernel/operations'
import { bundledPnpmCli, ensureBundledPnpmReady, pnpmShimEnv, pnpmStoreEnv, systemPnpmPath } from './pnpmRunner'
import {
    buildPluginEntries,
    effectiveBundles,
    isBundlePackage,
    readBundleList,
    readDependencyNames,
    readDisabledBundles,
    requiredBundles,
    toggleBundle,
    toggleDisabled,
    type ProfileManifestLike
} from './pluginManifest'

/**
 * dsh 插件（profile 组合包）管理：读取 / 启停 `dsh.profile.bundles`，并通过
 * `dsh plugin --profile <name> <pnpm args>` 安装 / 卸载（dsh 会转发给 pnpm 并自行重建
 * bundles 列表；见 dsh 源码 apps/cli/src/plugin.ts）。
 *
 * pnpm 的来源由设置决定（settings.pnpmSource）：系统自带则直接用 PATH 上的 `pnpm`；
 * 内置（默认）时 dsh 找的是 PATH 上的字面量 `pnpm`，
 * 因此这里为子进程前置一个垫片目录（见 pnpmShimEnv）。
 *
 * profile 位于 `$DSH_HOME/profiles/<name>`，与 Box 的配置目录无关。
 */

/** 列出已有 profile（目录名，排除 node_modules / 隐藏目录），'web' 优先。 */
export function listDshProfiles(): string[] {
    let names: string[]
    try {
        names = fs.readdirSync(profilesRoot(), { withFileTypes: true })
            .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
            .map((e) => e.name)
            .filter((n) => fs.existsSync(profileManifestFile(n)))
    } catch {
        return []
    }
    names.sort((a, b) => a.localeCompare(b))
    if (names.includes('web')) names = ['web', ...names.filter((n) => n !== 'web')]
    return names
}

/** 读 profile manifest；文件缺失或非法返回 null。 */
function readManifest(name: string): ProfileManifestLike | null {
    try {
        const raw = fs.readFileSync(profileManifestFile(name), 'utf8')
        const parsed = JSON.parse(raw) as unknown
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as ProfileManifestLike)
            : null
    } catch {
        return null
    }
}

/** 读某包（相对 profile 的 node_modules）的 manifest；读不到返回 null。 */
function readInstalledManifest(name: string, pkg: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(path.join(profileDir(name), 'node_modules', pkg, 'package.json'), 'utf8')) as unknown
    } catch {
        return null
    }
}

/** 解析要展示的 profile：优先请求值，其次 web，最后第一个已有 profile。 */
function resolveProfileName(requested?: string): string {
    const all = listDshProfiles()
    if (requested && all.includes(requested)) return requested
    if (requested && !fs.existsSync(path.join(profileDir(requested), 'package.json'))) return requested
    return all[0] ?? 'web'
}

/** 组装「设置 → 插件」页数据。 */
export function readPluginsInfo(requested?: string): DshPluginsInfo {
    const profiles = listDshProfiles()
    const name = resolveProfileName(requested)
    const manifest = readManifest(name)
    const bundles = readBundleList(manifest)
    const disabled = readDisabledBundles(manifest)
    const required = requiredBundles(name)
    // 依赖里混着普通库（供插件 import），只有声明 dsh.bundle 的才是可管理的插件。
    const pluginDeps = readDependencyNames(manifest).filter(
        (dep) => bundles.includes(dep) || isBundlePackage(readInstalledManifest(name, dep))
    )
    return {
        profile: name,
        profiles,
        dir: profileDir(name),
        manifestPath: path.join(profileDir(name), 'package.json'),
        // 停用的 bundle 仍可能被 dsh 写回 bundles，展示时先剔除。
        entries: buildPluginEntries(effectiveBundles(bundles, disabled), pluginDeps, required)
    }
}

/**
 * 启用 / 停用某个插件：只改 `dsh.profile.bundles`（不动依赖，卸载才删依赖）。
 * 必备模板 bundle 不允许停用；请求非法时返回未改动的数据。
 */
export function setPluginEnabled(profile: string, pkg: string, enabled: boolean): DshPluginsInfo {
    if (!pkg || requiredBundles(profile).includes(pkg)) return readPluginsInfo(profile)
    const manifest = readManifest(profile) ?? {}
    const nextBundles = toggleBundle(readBundleList(manifest), pkg, enabled)
    const nextDisabled = toggleDisabled(readDisabledBundles(manifest), pkg, enabled)
    writeManifest(profile, manifest, nextBundles, nextDisabled)
    return readPluginsInfo(profile)
}

/** 写回 profile manifest（只改 bundles / disabledBundles，保留其它字段）。 */
function writeManifest(profile: string, manifest: ProfileManifestLike, bundles: string[], disabled: string[]): void {
    const dir = profileDir(profile)
    const profileField: Record<string, unknown> = { ...(manifest.dsh?.profile ?? {}), bundles }
    if (disabled.length > 0) profileField.disabledBundles = disabled
    else delete profileField.disabledBundles
    const updated: ProfileManifestLike = {
        ...manifest,
        dsh: { ...(manifest.dsh ?? {}), profile: profileField }
    }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(updated, undefined, 2) + '\n')
}

/**
 * dsh 的 `plugin` 命令会把每个「依赖即组合包」重新写回 bundles，所以 Box 在安装 / 卸载成功后
 * 重新剔除 Box 记录为停用的 bundle，使停用状态不被打包操作抹掉；已卸载的停用项一并清理。
 */
function reapplyDisabled(profile: string): void {
    const manifest = readManifest(profile)
    if (!manifest) return
    const disabled = readDisabledBundles(manifest)
    if (disabled.length === 0) return
    const bundles = readBundleList(manifest)
    const deps = new Set(readDependencyNames(manifest))
    // 已卸载的停用项一并清掉，避免同名包重新安装时被意外停用。
    const kept = disabled.filter((n) => deps.has(n) || bundles.includes(n))
    const nextBundles = effectiveBundles(bundles, kept)
    if (nextBundles.join('\n') === bundles.join('\n') && kept.length === disabled.length) return
    writeManifest(profile, manifest, nextBundles, kept)
}

/** 运行一次 `dsh plugin --profile <name> <args>`（经内置 pnpm 垫片）。 */
async function runDshPlugin(
    profile: string,
    args: string[],
    onProgress?: (p: NodeDeployProgress) => void,
    signal?: AbortSignal
): Promise<DshPluginResult> {
    const cfg = loadSettings()
    const resolved = resolveDshModule(cfg)
    if (!resolved.present || !resolved.entry) {
        return { ok: false, message: mt('m.dsh.missingMsg') }
    }
    // dsh 会把参数转发给 pnpm：按设置挑来源。
    //  - 系统来源：dsh 从 PATH 就能找到 `pnpm`，不需要垫片；系统上没装则回落到内置。
    //  - 内置来源（默认）：先把内置 pnpm 备好（首次会在线下载），再用垫片目录把它的 JS 入口
    //    以字面量 `pnpm` 的形式前置到 PATH。
    const rt = nodeRuntimeForCfg(cfg)
    const sysPnpm = cfg.pnpmSource === 'system' ? systemPnpmPath() : null
    let env: NodeJS.ProcessEnv
    if (sysPnpm) {
        pushLog('o', `[Manager] 使用系统 pnpm：${sysPnpm}`)
        env = { ...process.env, ...pnpmStoreEnv(), ...proxyEnv(cfg, 'dsh') }
    } else {
        if (cfg.pnpmSource === 'system') pushLog('e', '[Manager] 未找到系统 pnpm，回落到内置 pnpm。')
        const ready = await ensureBundledPnpmReady(undefined, onProgress)
        if (ready.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE }
        if (!ready.ok) return { ok: false, message: ready.message || mt('m.dsh.bundledPnpmFetchFail') }
        const cli = bundledPnpmCli()
        if (!fs.existsSync(cli)) return { ok: false, message: mt('m.dsh.bundledPnpmMissing') }
        // dsh→pnpm 的联网走「DSH 本体」代理范围（pnpm 继承 dsh 的 HTTP(S)_PROXY）。
        env = { ...pnpmShimEnv(cli), ...proxyEnv(cfg, 'dsh') }
    }
    const label = `dsh plugin --profile ${profile} ${args.join(' ')}`
    pushLog('o', `[Manager] ${label} …`)
    const r = await runChild(
        rt.exec,
        {
            argv: [resolved.entry, 'plugin', '--profile', profile, ...args],
            cwd: os.homedir(),
            env,
            shell: false,
            stderrTailLimit: 4000,
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
    if (r.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, tail: r.stderrTail }
    if (!r.ok) {
        pushLog('e', `[Manager] ${label} failed (code=${r.code}).`)
        return { ok: false, message: r.stderrTail.trim().slice(-400) || mt('m.dsh.pluginOpFail'), tail: r.stderrTail }
    }
    pushLog('o', `[Manager] ${label} completed.`)
    return { ok: true, message: '' }
}

/** 安装一个插件（转发 `dsh plugin --profile <name> add <spec>`，dsh 负责重建配置层）。 */
export async function installDshPlugin(profile: string, spec: string, onProgress?: (p: NodeDeployProgress) => void): Promise<DshPluginResult> {
    const value = spec.trim()
    // 拒绝把 pnpm flag 当包名传入（例如 --global）——命令由主进程拼装，必须挡住意外字符串。
    if (!value || value.startsWith('-')) return { ok: false, message: mt('m.dsh.pluginSpecInvalid') }
    const token = beginCancelable()
    try {
        const r = await runDshPlugin(profile, ['add', value], onProgress, token.signal)
        if (r.ok) reapplyDisabled(profile)
        return r.ok ? { ok: true, message: value } : r
    } catch (err) {
        return { ok: false, message: errorMessage(err) }
    } finally {
        token.done()
    }
}

/** 卸载一个插件（转发 `dsh plugin --profile <name> remove <name>`，同时删依赖与配置层）。 */
export async function removeDshPlugin(profile: string, pkg: string): Promise<DshPluginResult> {
    const value = pkg.trim()
    if (!value || value.startsWith('-')) return { ok: false, message: mt('m.dsh.pluginSpecInvalid') }
    const token = beginCancelable()
    try {
        const r = await runDshPlugin(profile, ['remove', value], undefined, token.signal)
        if (r.ok) reapplyDisabled(profile)
        return r.ok ? { ok: true, message: value } : r
    } catch (err) {
        return { ok: false, message: errorMessage(err) }
    } finally {
        token.done()
    }
}
