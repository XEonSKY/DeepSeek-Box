/**
 * dsh profile / 插件（bundle）清单的**纯**逻辑：不碰 fs、不 import electron。
 *
 * 概念（来自 dsh 源码 packages/boot/app-boot/src/profile.ts）：
 *  - profile：`$DSH_HOME/profiles/<name>/package.json`，`dsh.profile.bundles` 是有序组合包列表；
 *  - bundle：声明 `dsh.bundle.patch` 的 npm 包，其 patch 文件贡献一层配置。
 *
 * **本模块只有读取**：`dshPatchLayers.ts` 靠 `bundles` / `patch files` 合成有效配置层。
 * 插件的增删启停（写入 manifest、调 pnpm 子进程）已随「设置 → 插件」页一起移除 ——
 * 那些事交给 `dsh plugin` 命令本身，Box 不再代劳。
 */

import { asRecord } from '@shared/json'

/** profile manifest 的宽松形态：只声明本模块读取的字段。 */
export interface ProfileManifestLike {
    name?: string
    dependencies?: Record<string, string>
    dsh?: {
        profile?: {
            bundles?: unknown
            patchReload?: unknown
        }
    }
    [key: string]: unknown
}

/**
 * 各**随附** profile 的模板 bundle：由 dsh 安装目录解析，不是 dependencies，
 * 是 profile 起不来时的兜底。自定义 profile 只兜底 @deepseek-ai/dsh-base
 * （dsh plugin 初始化时装入的第一层）。
 */
const SHIPPED_PROFILE_BUNDLES: Record<string, readonly string[]> = {
    web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
    acp: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'],
    sdk: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'],
    'sdk-minimal': ['@deepseek-ai/dsh-sdk-minimal']
}

/** 某个 profile 的兜底 bundle 列表（随附模板），副本避免调用方误改。 */
export function requiredBundles(profile: string): string[] {
    return [...(SHIPPED_PROFILE_BUNDLES[profile] ?? ['@deepseek-ai/dsh-base'])]
}

/** manifest 里声明的组合包列表（去重前的原始顺序值）。 */
export function readBundleList(manifest: ProfileManifestLike | null | undefined): string[] {
    const raw = manifest?.dsh?.profile?.bundles
    if (!Array.isArray(raw)) return []
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/**
 * 组合包声明的 patch 文件（相对包目录），按应用顺序。
 *
 * dsh 允许 `dsh.bundle.patch` 是**一个路径或一个路径数组**（见 dsh 的 `bundlePatchFiles`），
 * 数组形式按顺序依次叠加成多层，所以两种都要认；非法的声明一律当「没有 patch」。
 */
export function readBundlePatchFiles(manifest: unknown): string[] {
    const patch = asRecord(asRecord(asRecord(manifest)?.dsh)?.bundle)?.patch
    if (typeof patch === 'string') return patch.length > 0 ? [patch] : []
    if (Array.isArray(patch)) return patch.filter((v): v is string => typeof v === 'string' && v.length > 0)
    return []
}

