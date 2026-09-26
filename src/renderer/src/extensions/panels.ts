import type { Component } from 'vue'
import { extState } from './store'

/**
 * 渲染层控制点 2：**设置页**。
 *
 * 扩展能做的只有一件事 —— 在设置侧栏**追加**一个面板项，并在 `/settings/<key>` 落一个视图。
 * 两条硬约束：
 *
 *   1. **只能追加，不能插入内置项中间** —— 内置面板是外壳的稳定结构，
 *      让扩展决定它们的顺序会让"设置页长什么样"变得不确定的；
 *   2. 视图**由外壳统一渲染**，扩展不注入 Vue 组件。
 *      外部扩展若能与外壳在同一个 DOM 与 JS 上下文里执行任意代码，风险远高于主进程侧
 *      的能力申请 —— 所以它的面板一律落到通用容器（`ExtSettingsPanel.vue`）。
 *
 * 但**内置 / 系统**扩展不同：它们随构建进包、受编译期检查，可以声明一个
 * {@link LOCAL_VIEWS} 里已登记的实现名（`view` 字段），由外壳挂载真实组件。
 * 于是「扩展管理」页本身也是内置扩展的贡献，外壳不为它写特例 ——
 * 内置与外部在控制点上的待遇一致，唯一差别是主进程侧的加载方式。
 *
 * **内置扩展的实现按扩展收拢在 `src/extensions/<id>/`**：一个目录里同时放主进程入口
 * （`main.ts`）、清单（`manifest.ts`）与渲染层视图（`*.vue`）。之所以能这么做：
 * 目录在中立的顶层、不属于任何单一构建入口，两端都以 `@ext/<id>/...` 引用
 * （别名见 electron.vite.config.ts，对 main / preload / renderer 三处都配了）。
 * 改一个扩展只动一个目录，不必在 `views/settings/` 与 `main/extensions/` 之间来回找。
 *
 * 与之相对，本文件与 `store.ts` / `tabs.ts` / `index.ts` 是**扩展框架本身**
 * （加载器 + 两个控制点），属于基础设施，不随任何具体扩展走；
 * 扩展能用的公开面则是 `src/extensions/renderer-api.ts`。
 */

/** 侧栏项（内置面板之后追加）。 */
export interface ExtMenuItem {
    /** 路由与高亮用的 key。 */
    key: string
    /** 展示名的 i18n 键（来自贡献的 titleKey，由渲染层翻译）。 */
    titleKey: string
    /** 来源扩展 id（便于展示与排查）。 */
    extId: string
    /** 来源扩展名。 */
    extName: string
    /** 本地视图实现名（仅内置 / 系统扩展会带；外部扩展忽略）。 */
    view?: string
    /** 图标名（由外壳映射，扩展不能传组件）。 */
    icon?: string
}

/** 当前生效的扩展设置面板（供 SettingsView 渲染侧栏与路由）。 */
export function extMenus(): ExtMenuItem[] {
    return extState.panels.map((p) => ({
        key: p.key,
        titleKey: p.titleKey,
        extId: p.extId,
        extName: p.extName,
        view: p.view,
        icon: p.icon
    }))
}

/**
 * 外壳登记的本地视图实现：`view` 名 → 组件。
 *
 * 只放**内置 / 系统**扩展的实现（随构建进包）。外部扩展即使声明了同名 view，
 * 也拿不到这里的组件 —— {@link resolveExtPanelView} 会按 kind 判定。
 */
const LOCAL_VIEWS: Record<string, () => Promise<Component>> = {
    // 「扩展管理」页（由内置扩展 xeonsky.extm 贡献）。
    // 视图与它的主进程实现在同一个目录（`src/extensions/xeonsky.extm/`），
    // 两端都用 `@ext/<id>/...` 引用 —— 见本文件顶部说明。
    extensions: () => import('@ext/xeonsky.extm/ExtensionsPanel.vue'),
    // 「内嵌浏览器」页（由内置扩展 xeonsky.browser 贡献）。
    browser: () => import('@ext/xeonsky.browser/BrowserPanel.vue')
}

/**
 * 解析某扩展面板该渲染的组件。
 *
 * @param kind 扩展级别；**只有内置 / 系统**才允许解析本地视图，外部扩展一律 undefined
 *             （落到通用容器视图）。
 */
export function resolveExtPanelView(view: string | undefined, kind: string | undefined): (() => Promise<Component>) | undefined {
    if (!view) return undefined
    if (kind !== 'builtin' && kind !== 'system') return undefined
    return LOCAL_VIEWS[view]
}
