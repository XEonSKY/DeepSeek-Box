import fs from 'node:fs'
import path from 'node:path'
import { composePatchEntries, parsePatchLayer } from './cordisPatch'
import { DSH_PROFILE, bundleRoots, homePatchFile, profileManifestFile, profilePatchFile } from './dshHome'
import { readBundleList, readBundlePatchFiles, requiredBundles, type ProfileManifestLike } from './pluginManifest'

/**
 * 收集 dsh 的**有效 patch 层**（只碰文件系统，不 import electron，便于单测）。
 *
 * 层叠顺序与 dsh 一致（低 → 高）：
 * **随附 bundle 层 → profile 的 `cordis.patch.yml` → home 的 `cordis.patch.yml`**。
 *
 * 为什么必须包含 bundle 层：dsh 把「开箱可用」的默认值写在 bundle 里 —— `dsh-base` 的
 * `agent-default-model: { provider: deepseek-official }` 与 `llm-deepseek` 路由都是随附默认，
 * 用户层（profile / home）**只在覆盖时才出现**。只看用户层会把默认供应商整个漏掉，
 * 表现为「共 0 个供应商」。
 *
 * bundle 解析不到 / 坏掉一律跳过（dsh 自己也只在 stderr 报告后继续）；
 * 用户层坏掉才把 `parseError` 置起来，交给调用方决定怎么提示。
 */

/** 读文本文件；不存在 / 不可读返回 null。 */
function readTextFile(file: string): string | null {
    try {
        return fs.readFileSync(file, 'utf8')
    } catch {
        return null
    }
}

/** 读 JSON 文件；不存在 / 解析失败返回 null。 */
function readJsonFile(file: string): unknown {
    const text = readTextFile(file)
    if (text === null) return null
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

/**
 * profile manifest 里声明的组合包（有序）；manifest 缺失时回落到 dsh 的随附模板，
 * 这样在 dsh 还没初始化过的机器上也还能读到默认配置。
 */
function profileBundleNames(): string[] {
    const declared = readBundleList(readJsonFile(profileManifestFile()) as ProfileManifestLike | null)
    return declared.length > 0 ? declared : requiredBundles(DSH_PROFILE)
}

/** 一个 bundle 包贡献的 patch 文件文本（按 `dsh.bundle.patch` 的声明顺序）；坏掉的 YAML 剔除。 */
function bundleLayerTexts(bundleDir: string): string[] {
    const manifest = readJsonFile(path.join(bundleDir, 'package.json'))
    const out: string[] = []
    for (const rel of readBundlePatchFiles(manifest)) {
        const text = readTextFile(path.join(bundleDir, rel))
        // 坏掉的 bundle 层对合成零贡献（解析结果为「空层 + error」），留着只会让层数对不上账。
        if (text === null || parsePatchLayer(text).error) continue
        out.push(text)
    }
    return out
}

/**
 * 按 dsh 的层叠顺序收集 patch 层文本。
 *
 * @param installNodeModules dsh 安装目录下的 `node_modules`（随附 bundle 装在这里）；
 *   解析不到时传 null，此时只读用户层。
 * @returns `layers` 为按优先级从低到高的 patch 文本；`parseError` 表示**用户层**有坏掉的 YAML；
 *   `bundleLayers` 是随附 bundle 层贡献的 patch 文件数 —— 为 0 说明没解析到任何 dsh 安装
 *   （尚未安装、被移除、或安装不完整）。调用方据此区分「dsh 缺失」与「dsh 装了但没配供应商」，
 *   否则会把「没装 dsh」误报成「请先去 dsh 配供应商」。
 */
export function collectPatchLayers(installNodeModules: string | null): {
    layers: string[]
    parseError: boolean
    bundleLayers: number
} {
    const layers: string[] = []
    let bundleLayers = 0

    for (const name of profileBundleNames()) {
        for (const root of bundleRoots(installNodeModules)) {
            const dir = path.join(root, name)
            if (!fs.existsSync(path.join(dir, 'package.json'))) continue
            const texts = bundleLayerTexts(dir)
            bundleLayers += texts.length
            layers.push(...texts)
            break // 与 dsh 一致：先命中的解析锚点胜出
        }
    }

    let parseError = false
    for (const file of [profilePatchFile(), homePatchFile()]) {
        const text = readTextFile(file)
        if (text === null) continue // 这一层不存在：合法的空层
        if (parsePatchLayer(text).error) parseError = true
        layers.push(text)
    }
    return { layers, parseError, bundleLayers }
}

/** 挂载态的有效配置：条目 id → config（没有 config 的条目是空对象），外加被停用的 id。 */
export interface MountedConfig {
    cfg: Map<string, Record<string, unknown>>
    disabled: Set<string>
}

/**
 * 把 patch 层合成为**已挂载条目**的配置。
 *
 * 与 `cordisPatch.composePatchConfig` 的区别是这里**每个存在的条目都入表**：dsh 的
 * bundle 默认路由（例如 `llm-deepseek`）只声明 `id` 与 `name`、**没有 `config`**，
 * 而「条目存在」本身就表示这条路由已挂载、各字段走默认值。只收带 config 的条目会
 * 把整条默认路由漏掉 —— 那样模型页就会把「开箱可用」的 DeepSeek 显示成 0 个供应商。
 */
export function composeMountedConfig(layers: readonly string[]): MountedConfig {
    const cfg = new Map<string, Record<string, unknown>>()
    const disabled = new Set<string>()
    for (const [id, entry] of composePatchEntries(layers)) {
        cfg.set(id, entry.config ?? {})
        if (entry.disabled === true) disabled.add(id)
    }
    return { cfg, disabled }
}
