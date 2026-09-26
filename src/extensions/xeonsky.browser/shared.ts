/**
 * 内置扩展 `xeonsky.browser` 的**跨端共享类型与常量**。
 *
 * 放在扩展目录里而不是 `@shared/types`：浏览（搜索引擎 / 常用站点）这些概念随功能
 * 从内核迁到本扩展后，内核设置结构里不再有它们 —— 停用本扩展时这些设置一并消失，
 * 内核也不必为可选功能保留字段。
 *
 * 本文件同时被两端引用：
 *  - 主进程（同目录 `main.ts`）—— 解析输入、读写配置；
 *  - 渲染层（同目录 `NewTab.vue` / `BrowserPanel.vue`）—— 展示与编辑。
 * 因此**只用纯类型与纯函数**，不碰 DOM、不碰 Node。
 */

// ---------------------------------------------------------------------------
// 搜索引擎
// ---------------------------------------------------------------------------

/** 支持的搜索引擎。ID 顺序即下拉展示顺序。 */
export type SearchEngineId = 'baidu' | 'sogou' | '360' | 'bing' | 'google' | 'duckduckgo'

export const SEARCH_ENGINE_IDS: readonly SearchEngineId[] = ['baidu', 'sogou', '360', 'bing', 'google', 'duckduckgo']

/** 各引擎的文案键（本扩展语言文件里的 `ext.xeonskyBrowser.engine.*`）。 */
export const ENGINE_LABEL_KEY: Record<SearchEngineId, string> = {
    baidu: 'ext.xeonskyBrowser.engine.baidu',
    sogou: 'ext.xeonskyBrowser.engine.sogou',
    360: 'ext.xeonskyBrowser.engine.q360',
    bing: 'ext.xeonskyBrowser.engine.bing',
    google: 'ext.xeonskyBrowser.engine.google',
    duckduckgo: 'ext.xeonskyBrowser.engine.duckduckgo'
}

/** 各引擎搜索 URL 模板（`{q}` 为查询词占位）。 */
const ENGINE_TEMPLATE: Record<SearchEngineId, string> = {
    baidu: 'https://www.baidu.com/s?wd={q}',
    sogou: 'https://www.sogou.com/web?query={q}',
    360: 'https://www.so.com/s?q={q}',
    bing: 'https://www.bing.com/search?q={q}',
    google: 'https://www.google.com/search?q={q}',
    duckduckgo: 'https://duckduckgo.com/?q={q}'
}

/** 生成某引擎的搜索 URL。 */
export function buildSearchUrl(engine: SearchEngineId, query: string): string {
    const tpl = ENGINE_TEMPLATE[engine] ?? ENGINE_TEMPLATE.bing
    return tpl.replace('{q}', encodeURIComponent(query))
}

/** 归一化引擎 id：不在集合内一律回落 bing。 */
export function normalizeEngine(v: unknown): SearchEngineId {
    return SEARCH_ENGINE_IDS.includes(v as SearchEngineId) ? (v as SearchEngineId) : 'bing'
}

// ---------------------------------------------------------------------------
// 常用站点
// ---------------------------------------------------------------------------

/** 导航页上的常用站点（标题 + URL）。 */
export interface Shortcut {
    title: string
    url: string
}

/** 归一化常用站点列表：丢掉非对象项，字段缺失补空串。 */
export function normalizeShortcuts(v: unknown): Shortcut[] {
    if (!Array.isArray(v)) return []
    return v
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
            title: typeof x.title === 'string' ? x.title : '',
            url: typeof x.url === 'string' ? x.url : ''
        }))
}
