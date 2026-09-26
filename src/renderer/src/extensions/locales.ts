import { deepMergeDict, installExtensionCatalogs, type ExtensionLocaleTable } from '@shared/locales/ext'
import { logger } from '../lib/logger'
import { mergeLocaleMessages } from '../lib/locales'
import { extLocales as xeonskyExtuiLocales } from '@ext/xeonsky.extui/locales'
import { extLocales as xeonskyZipLocales } from '@ext/xeonsky.zip/locales'
import { extLocales as xeonskyDownloadLocales } from '@ext/xeonsky.download/locales'
import { extLocales as xeonskyBrowserLocales } from '@ext/xeonsky.browser/locales'

/**
 * 扩展自有文案的**装配点**（「扩展自管语言文件」的外壳一半）。
 *
 * 契约（与 `shared/locales/ext.ts` 的说明配套）：
 *  - 带界面的内置扩展在自己的目录里放一份 `locales.ts`，导出
 *    `extLocales: ExtensionLocaleTable`（zh / en 各一张字典）；
 *  - 键必须挂在 `ext.<稳定名>.*` 命名空间下 —— 命名空间由扩展**自己挑**，
 *    但要唯一且稳定（本仓库两个扩展用 id 的驼峰：`ext.xeonskyExtui.*`、`ext.xeonskyZip.*`）；
 *  - 本表登记「扩展 id → 它的字典」；启动时把全部扩展的字典深合并成一张表，
 *    经 {@link installExtensionCatalogs} 注入 shared 的目录构建器。
 *
 * 为什么是静态表而不是运行期发现：内置扩展与系统扩展一样**编译进 bundle**，
 * 磁盘上没有可扫的目录（见 main/extensions/loader/sources.ts 的说明），
 * 表在这里 = 「编译期决定有哪些」，与 LOCAL_VIEWS 的登记方式同构。
 * 外部扩展目前没有渲染层入口，自然也不涉及文案合并。
 *
 * 命名空间冲突检查：两个扩展若都挂了 `ext.<同名>`，后合并的会覆盖前者 ——
 * 这属于扩展作者的错误，启动时告警一次（不阻断），让问题在开发期就暴露。
 */

const log = logger('[ext]')

/** 内置扩展的语言文件表：扩展 id → zh/en 字典。新带界面的内置扩展在这里加一行。 */
const EXT_LOCALES: Record<string, ExtensionLocaleTable> = {
    'xeonsky.extui': xeonskyExtuiLocales,
    'xeonsky.zip': xeonskyZipLocales,
    'xeonsky.download': xeonskyDownloadLocales,
    'xeonsky.browser': xeonskyBrowserLocales
}

/** 取一个扩展字典在 `ext.` 下的顶层命名空间名（用于冲突告警）。 */
function topNamespaces(dict: Record<string, unknown>): string[] {
    const ext = dict['ext']
    return ext && typeof ext === 'object' ? Object.keys(ext as Record<string, unknown>) : []
}

/** 合并全部扩展的字典并注入 shared 目录构建器（启动时调用一次）。 */
export function installExtensionLocales(): void {
    const table: ExtensionLocaleTable = { zh: {}, en: {} }
    const seen = new Map<string, string>()
    for (const [id, dict] of Object.entries(EXT_LOCALES)) {
        for (const ns of topNamespaces(dict.zh)) {
            const owner = seen.get(ns)
            if (owner) log.warn(`extension locale namespace "ext.${ns}" declared by both ${owner} and ${id}; the later wins`)
            else seen.set(ns, id)
        }
        table.zh = deepMergeDict(table.zh, dict.zh)
        table.en = deepMergeDict(table.en, dict.en)
    }
    installExtensionCatalogs(table)
    // 再把合并结果立即补进当前消息目录：catalogForLocale 只在「重建」时生效，
    // 启动早期可能还没有任何重建发生，不补这一步的话扩展键在首屏会是原始键。
    mergeLocaleMessages('zh', table.zh)
    mergeLocaleMessages('en', table.en)
}
