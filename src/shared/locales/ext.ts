import zhBase from './zh'
import enBase from './en'
import anime from './zh/anime'
import wenyan from './zh/wenyan'
import hant from './zh/hant'
import pirate from './en/pirate'
import shakespeare from './en/shakespeare'

/**
 * 扩展翻译：统一为「文本覆盖」。
 * 每个变体（anime/wenyan/hant ← zh；pirate/shakespeare ← en）都是一个与
 * 对应语言同构、只写差异键的文案目录文本，运行时深合并到基础文案之上。
 * 覆盖需要覆盖的地方，其余自动沿用基础文案；不改 dsh 设置。
 */

export type ExtStyle = 'off' | 'anime' | 'wenyan' | 'hant' | 'pirate' | 'shakespeare'
export type ExtLocale = 'zh' | 'en'

const BASE: Record<ExtLocale, Record<string, unknown>> = {
    zh: zhBase as Record<string, unknown>,
    en: enBase as Record<string, unknown>
}

/** 变体 -> 差异目录 */
const OVERLAY: Record<Exclude<ExtStyle, 'off'>, Record<string, unknown>> = {
    anime,
    wenyan,
    hant,
    pirate,
    shakespeare
}

type AnyDict = Record<string, unknown>

/**
 * 深合并两个文案字典（patch 覆盖 base，对象递归、标量与数组直接覆盖）。
 * 扩展层合并与变体覆盖共用这一个实现，避免两处语义漂移。
 */
export function deepMergeDict(base: AnyDict, patch: AnyDict): AnyDict {
    const out: AnyDict = { ...base }
    for (const k of Object.keys(patch)) {
        const pv = patch[k]
        const bv = out[k]
        if (pv && typeof pv === 'object' && !Array.isArray(pv)) {
            out[k] = deepMergeDict((bv && typeof bv === 'object' && !Array.isArray(bv) ? bv : {}) as AnyDict, pv as AnyDict)
        } else {
            out[k] = pv
        }
    }
    return out
}

function deepMerge(base: AnyDict, patch: AnyDict): AnyDict {
    return deepMergeDict(base, patch)
}

/** 某变体属于哪种语言。 */
export function styleLocaleOf(style: ExtStyle): ExtLocale {
    return style === 'pirate' || style === 'shakespeare' ? 'en' : 'zh'
}

/** 取某语言文案目录：off→基础；其它→基础 + 变体文本覆盖。 */
export function catalogForLocale(locale: ExtLocale, style: ExtStyle): Record<string, unknown> {
    if (style === 'off') return deepMerge(BASE[locale], extensionLayer[locale])
    const target = styleLocaleOf(style)
    return deepMerge(deepMerge(BASE[target], OVERLAY[style]), extensionLayer[target])
}

// ---------------------------------------------------------------------------
// 扩展自有文案层（「扩展自管语言文件」的接口）
//
// 内置扩展的界面文案**不进**上面的基础目录（zh/ en/ 是外壳的领地），而是各扩展
// 在自己的目录里带一份 `locales.ts`（键统一挂在 `ext.<id 驼峰>.*` 命名空间下），
// 由渲染层扩展框架在启动时把所有扩展的字典**深合并**成一张表，经
// {@link installExtensionCatalogs} 注入到这里。{@link catalogForLocale} 在每次
// 重建目录（切语言 / 换扩展翻译风格）时都把扩展层合在最上层 ——
// 于是扩展键既不会被语言切换冲掉，也永远盖不过外壳的键（扩展层里没有外壳键）。
// ---------------------------------------------------------------------------

/** 各语言一张的扩展文案表（由渲染层扩展框架组装）。 */
export interface ExtensionLocaleTable {
    zh: Record<string, unknown>
    en: Record<string, unknown>
}

/** 已注入的扩展文案层（初始为空表：没有扩展时行为与从前完全一致）。 */
let extensionLayer: ExtensionLocaleTable = { zh: {}, en: {} }

/** 注入扩展文案层（启动时调用一次；重复调用以最后一次为准）。 */
export function installExtensionCatalogs(table: ExtensionLocaleTable): void {
    extensionLayer = table
}
