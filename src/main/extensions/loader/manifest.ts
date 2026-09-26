/**
 * 扩展清单的**纯逻辑**：解析与校验，不碰 fs、不 import electron。
 *
 * 单独成文件的原因：本仓库已无单元测试，纯逻辑是唯一能被 typecheck 有效覆盖的形态；
 * 且加载器是单点（它自己有 bug 会连带全部扩展），所以能往外挪的判断逻辑尽量挪出来。
 *
 * 校验策略：**宽松读取 + 严格丢弃**。字段类型不对就当没写（而不是抛错中断整个加载），
 * 但**不可缺的字段缺失（如 id）导致该扩展被丢弃并报因** —— 让一个坏扩展只坏它自己。
 */

import type { ExtCapability, ExtContributions, ExtManifest, ExtSettingsContribution, ExtTabContribution } from '@shared/extensions'
import { SYS_CAPABILITIES } from '@shared/extensions'
import { asRecord as asObject } from '@shared/json'
import { logger } from '../../kernel/logger'

const log = logger('[ext]')

/** 解析结果：要么给出清单，要么给出「为什么不能用」。 */
export type ManifestParseResult = { ok: true; manifest: ExtManifest } | { ok: false; reason: string }

/** 取非空字符串；其它类型一律视为未提供。 */
function asString(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

/** 取字符串数组（过滤掉非字符串与空串）。 */
function asStringArray(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined
    const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
    return out.length > 0 ? out : undefined
}

/**
 * 扩展 id 必须能安全用作「命名空间前缀」与「目录名」：
 * 只允许小写字母、数字、`.`、`-`，且不能以 `.` / `-` 开头。
 *
 * 这条不是审美洁癖 —— id 会拼进 IPC 通道名（`ext:<id>:<action>`）与磁盘路径，
 * 放任特殊字符会在下游产生转义与路径穿越问题。
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/

/** 校验扩展 id 是否合法。 */
export function isValidExtId(id: string): boolean {
    return ID_PATTERN.test(id)
}

/** 判断一个字符串是否是合法能力名（系统能力或 `ext:<id>` 形式）。 */
export function isExtCapability(v: unknown): v is ExtCapability {
    if (typeof v !== 'string') return false
    if ((SYS_CAPABILITIES as readonly string[]).includes(v)) return true
    if (!v.startsWith('ext:')) return false
    const rest = v.slice(4)
    if (rest.length === 0) return false
    // 允许 `ext:<id>` 或 `ext:<id>/<name>`；id 部分按 id 规则校验，name 部分允许更多字符。
    const slash = rest.indexOf('/')
    const idPart = slash < 0 ? rest : rest.slice(0, slash)
    const namePart = slash < 0 ? '' : rest.slice(slash + 1)
    if (!isValidExtId(idPart)) return false
    return slash < 0 || namePart.length > 0
}

/** 解析贡献点里的标签页项；非法项直接丢弃（不因为一个坏项丢弃整个扩展）。 */
function parseTabs(raw: unknown): ExtTabContribution[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const out: ExtTabContribution[] = []
    for (const item of raw) {
        const o = asObject(item)
        if (!o) continue
        const key = asString(o.key)
        const titleKey = asString(o.titleKey)
        const url = asString(o.url)
        const view = asString(o.view)
        // `url` 与 `view` 至少要有一个：前者是「开一个 URL 标签页」，
        // 后者是「注册一个程序内置标签页视图」（如新建标签页页，由外壳按名挂载）。
        if (!key || !titleKey || (!url && !view)) continue
        const entry: ExtTabContribution = { key, titleKey }
        if (url) entry.url = url
        if (view) entry.view = view
        if (o.openOnStart === true) entry.openOnStart = true
        out.push(entry)
    }
    return out.length > 0 ? out : undefined
}

/** 解析贡献点里的设置面板项；非法项直接丢弃。 */
function parseSettings(raw: unknown): ExtSettingsContribution[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const out: ExtSettingsContribution[] = []
    for (const item of raw) {
        const o = asObject(item)
        if (!o) continue
        const key = asString(o.key)
        if (!key) continue
        const entry: ExtSettingsContribution = { key, titleKey: asString(o.titleKey) ?? `ext.${key}.title` }
        const icon = asString(o.icon)
        if (icon) entry.icon = icon
        const view = asString(o.view)
        if (view) entry.view = view
        out.push(entry)
    }
    return out.length > 0 ? out : undefined
}

/** 解析贡献点（两个控制点，种类固定）。 */
function parseContributions(raw: unknown): ExtContributions | undefined {
    const o = asObject(raw)
    if (!o) return undefined
    const out: ExtContributions = {}
    const tabs = parseTabs(o.tabs)
    if (tabs) out.tabs = tabs
    const settings = parseSettings(o.settings)
    if (settings) out.settings = settings
    return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 解析并校验一份清单。
 *
 * @param raw 已 `JSON.parse` 的内容（解析 JSON 本身由调用方做，本函数不碰 fs）
 */
export function parseManifest(raw: unknown): ManifestParseResult {
    const o = asObject(raw)
    if (!o) return { ok: false, reason: '清单不是对象' }

    const id = asString(o.id)
    if (!id) return { ok: false, reason: '缺失 id' }
    if (!isValidExtId(id)) return { ok: false, reason: `id 非法：${id}（只允许小写字母、数字、. 和 -，且不以 . / - 开头）` }

    const manifest: ExtManifest = { id }
    const name = asString(o.name)
    if (name) manifest.name = name
    const version = asString(o.version)
    if (version) manifest.version = version
    if (typeof o.apiVersion === 'number' && Number.isFinite(o.apiVersion)) manifest.apiVersion = o.apiVersion

    // 依赖：把自己依赖自己视为配置错误（会在拓扑排序里成环），直接丢弃这一项。
    const deps = asStringArray(o.dependencies)
    if (deps) {
        const filtered = deps.filter((d) => d !== id)
        if (filtered.some((d) => !isValidExtId(d))) {
            const bad = filtered.find((d) => !isValidExtId(d))
            return { ok: false, reason: `依赖 id 非法：${bad}` }
        }
        if (filtered.length > 0) manifest.dependencies = filtered
    }

    // 能力：非法能力名整条丢弃（静默降级成「没申请」比让扩展带着未知能力跑更安全）。
    if (Array.isArray(o.capabilities)) {
        const caps = o.capabilities.filter(isExtCapability)
        if (caps.length > 0) manifest.capabilities = [...new Set(caps)]
        const dropped = o.capabilities.length - caps.length
        if (dropped > 0) {
            // 只提示不失败：未知能力可能来自更新的 Box 版本，直接丢弃即可。
            log.warn(`${id}: ignored ${dropped} unrecognized capability name(s)`)
        }
    }

    const contributions = parseContributions(o.contributions)
    if (contributions) manifest.contributions = contributions

    const main = asString(o.main)
    if (main) manifest.main = main
    const renderer = asString(o.renderer)
    if (renderer) manifest.renderer = renderer

    return { ok: true, manifest }
}

/**
 * 贡献点 key 的合法性：会拼进路由 `/settings/<key>`，规则与 id 同源。
 * 供加载器在挂载前做最后一道检查（manifest 解析时 key 只做了非空检查）。
 */
export function isSafeContributionKey(key: string): boolean {
    return ID_PATTERN.test(key)
}

/**
 * 校验硬依赖是否都满足。
 *
 * @param manifest 待检查的扩展
 * @param available 已成功加载的扩展 id 集合
 * @returns 缺失的依赖 id 列表（空数组表示满足）
 */
export function missingDependencies(manifest: ExtManifest, available: ReadonlySet<string>): string[] {
    const deps = manifest.dependencies ?? []
    return deps.filter((d) => !available.has(d))
}
