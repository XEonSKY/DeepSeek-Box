/**
 * dsh profile / 插件（bundle）清单的**纯**逻辑：不碰 fs、不 import electron，
 * 便于单测。文件读写与子进程编排在 plugins.ts，pnpm 调用在 pnpmRunner.ts。
 *
 * 概念（来自 dsh 源码 packages/boot/app-boot/src/profile.ts）：
 *  - profile：`$DSH_HOME/profiles/<name>/package.json`，`dsh.profile.bundles` 是有序组合包列表；
 *  - bundle：声明 `dsh.bundle.patch` 的 npm 包，其 patch 文件贡献一层配置；
 *  - 启停某个插件 = 在 `dsh.profile.bundles` 里增删它的包名（不改 dependencies，卸载才动依赖）。
 */
import type { DshPluginEntry } from '@shared/types'

/** profile manifest 的宽松形态：只声明本模块读取的字段。 */
export interface ProfileManifestLike {
    name?: string
    dependencies?: Record<string, string>
    dsh?: {
        profile?: {
            bundles?: unknown
            patchReload?: unknown
            /** Box 私有：已安装但停用的 bundle。dsh 不读取，但重写 manifest 时会原样保留。 */
            disabledBundles?: unknown
        }
    }
    [key: string]: unknown
}

/**
 * 各**随附** profile 的模板 bundle：由 dsh 安装目录解析，不是 dependencies，
 * 也绝不能停用（停掉 dsh-base / web-app 会让对应 profile 起不来）。
 * 自定义 profile 只保护 @deepseek-ai/dsh-base（dsh plugin 初始化时装入的第一层）。
 */
const SHIPPED_PROFILE_BUNDLES: Record<string, readonly string[]> = {
    web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
    acp: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'],
    sdk: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'],
    'sdk-minimal': ['@deepseek-ai/dsh-sdk-minimal']
}

/** 某个 profile 中不可停用的必备 bundle（随附模板），副本避免调用方误改。 */
export function requiredBundles(profile: string): string[] {
    return [...(SHIPPED_PROFILE_BUNDLES[profile] ?? ['@deepseek-ai/dsh-base'])]
}

/** manifest 里声明的组合包列表（去重前的原始顺序值）。 */
export function readBundleList(manifest: ProfileManifestLike | null | undefined): string[] {
    const raw = manifest?.dsh?.profile?.bundles
    if (!Array.isArray(raw)) return []
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/** manifest 里声明的依赖包名。 */
export function readDependencyNames(manifest: ProfileManifestLike | null | undefined): string[] {
    const deps = manifest?.dependencies
    if (deps === null || typeof deps !== 'object') return []
    return Object.keys(deps)
}

/** 某包 manifest 是否是一个组合包（声明了 dsh.bundle.patch）。 */
export function isBundlePackage(manifest: unknown): boolean {
    if (manifest === null || typeof manifest !== 'object') return false
    const dsh = (manifest as { dsh?: unknown }).dsh
    if (dsh === null || typeof dsh !== 'object') return false
    const bundle = (dsh as { bundle?: unknown }).bundle
    if (bundle === null || typeof bundle !== 'object') return false
    const patch = (bundle as { patch?: unknown }).patch
    return typeof patch === 'string' && patch.length > 0
}

/**
 * 在组合包列表里启用 / 停用某个包：启用则**追加到末尾**（与 dsh plugin 的追加语义一致，
 * 后加入的层优先级更高），停用则移除。已是目标状态或停用不存在的项时返回原列表副本。
 */
export function toggleBundle(bundles: readonly string[], name: string, enabled: boolean): string[] {
    const has = bundles.includes(name)
    if (enabled) return has ? [...bundles] : [...bundles, name]
    return has ? bundles.filter((b) => b !== name) : [...bundles]
}

/**
 * 组装插件列表：必备 bundle 在前，其余已启用 bundle 次之（保持列表顺序），
 * 最后是「已安装为组合包但当前停用」的依赖。调用方需先把普通依赖（非 bundle）过滤掉。
 */
export function buildPluginEntries(
    bundles: readonly string[],
    pluginDependencies: readonly string[],
    required: readonly string[]
): DshPluginEntry[] {
    const req = new Set(required)
    const dep = new Set(pluginDependencies)
    const out: DshPluginEntry[] = []
    const seen = new Set<string>()
    const push = (name: string, enabled: boolean): void => {
        if (seen.has(name)) return
        seen.add(name)
        const isReq = req.has(name)
        out.push({ name, enabled, installed: dep.has(name) || isReq, required: isReq })
    }
    for (const name of required) push(name, true)
    for (const name of bundles) push(name, true)
    for (const name of pluginDependencies) push(name, false)
    return out
}

/** manifest 里记录的「已安装但停用」的 bundle（Box 私有字段；dsh 不读取，但重写 manifest 时会原样保留）。 */
export function readDisabledBundles(manifest: ProfileManifestLike | null | undefined): string[] {
    const raw = manifest?.dsh?.profile?.disabledBundles
    if (!Array.isArray(raw)) return []
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/**
 * 从启用列表中剔除被停用的 bundle。
 * dsh 的 `plugin` 命令会因为「依赖是组合包」而把它们重新写回 bundles，所以展示与启动都以这份
 * 过滤后的列表为准。
 */
export function effectiveBundles(bundles: readonly string[], disabled: readonly string[]): string[] {
    if (disabled.length === 0) return [...bundles]
    const off = new Set(disabled)
    return bundles.filter((b) => !off.has(b))
}

/** 更新停用集合：停用则加入，启用则移除。 */
export function toggleDisabled(disabled: readonly string[], name: string, enabled: boolean): string[] {
    const has = disabled.includes(name)
    if (enabled) return has ? disabled.filter((d) => d !== name) : [...disabled]
    return has ? [...disabled] : [...disabled, name]
}

