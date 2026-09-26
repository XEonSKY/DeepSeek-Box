import type { Component } from 'vue'
import { extState } from './store'

/**
 * 渲染层控制点 1 的**视图侧**：程序内置标签页视图。
 *
 * ## 为什么需要它
 *
 * 标签页控制点原先只能贡献「一个 URL」—— 外壳把它当普通动态标签页打开
 * （见 `tabs.ts`）。但有一类标签页**天然不该是网页**：外壳自带的「新建标签页」。
 * 它的内容是程序自己的界面（Logo、跳转框、常用站点），过去由内核写死一个 Vue 页面
 * （`views/NewTab.vue`）渲染，是内核里唯一一处「浏览器功能」的实现。
 *
 * 现在它改为由扩展贡献：贡献项带 `view`（如 `newtab`），外壳按名字挂载本文件登记的实现。
 * 规则与设置面板的 `LOCAL_VIEWS` 完全一致 —— **只有内置 / 系统扩展能解析**
 * （外部扩展若能注入组件，就等于在外壳的 DOM 与 JS 上下文里执行任意代码）。
 *
 * ## 与 URL 型标签页的区别
 *
 * 带 `view` 的贡献**不会**被 `registerExtTabs` 打开成标签页 —— 它只是一条
 * 「视图注册声明」。新建标签页仍由外壳的 `openNewTab()` 产生（`kind === 'newtab'`），
 * 只是渲染时来这里查实现。
 *
 * ## 兜底
 *
 * 扩展被停用（或贡献项消失）时必须回落到外壳自带的最小页面 ——
 * 新增标签页是用户点「＋」就能触发的动作，不能出现空白页。回落实现见 `NewTabFallback.vue`。
 */

/**
 * 外壳登记的标签页视图实现：`view` 名 → 组件。
 *
 * 只放**内置 / 系统**扩展的实现（随构建进包）；外部扩展即使声明了同名 view
 * 也拿不到这里的组件（{@link resolveTabView} 会按 kind 判定）。
 */
const LOCAL_TAB_VIEWS: Record<string, () => Promise<Component>> = {
    // 「新建标签页」页（由内置扩展 xeonsky.browser 贡献）。
    // 视图与它的主进程实现在同一个目录（`src/extensions/xeonsky.browser/`），
    // 两端都用 `@ext/<id>/...` 引用。
    newtab: () => import('@ext/xeonsky.browser/NewTab.vue')
}

/**
 * 解析某标签页视图名对应的组件加载器。
 *
 * @param kind 扩展级别；**只有内置 / 系统**才允许解析本地视图，外部扩展一律 undefined。
 */
export function resolveTabView(view: string | undefined, kind: string | undefined): (() => Promise<Component>) | undefined {
    if (!view) return undefined
    if (kind !== 'builtin' && kind !== 'system') return undefined
    return LOCAL_TAB_VIEWS[view]
}

/**
 * 当前生效的「新建标签页」视图加载器；没有扩展贡献时返回 null（调用方回落到自带页）。
 *
 * 只认第一个带 `view` 且能解析出实现的贡献 —— 新建标签页是**单例**概念，
 * 多个扩展同时声明没有意义，先到先得（排序由主进程的扩展加载顺序决定）。
 */
export function newTabViewLoader(): (() => Promise<Component>) | null {
    for (const tab of extState.tabs) {
        if (!tab.view) continue
        const entry = extState.info?.entries.find((e) => e.id === tab.extId)
        const loader = resolveTabView(tab.view, entry?.kind)
        if (loader) return loader
    }
    return null
}

/**
 * 某扩展贡献项是不是「标签页视图声明」（而非可打开的 URL 标签页）。
 *
 * `registerExtTabs` 用它跳过这类贡献 —— 否则扩展一启用就会多出一个空标签页。
 */
export function isTabViewContribution(tab: { view?: string }): boolean {
    return !!tab.view
}
