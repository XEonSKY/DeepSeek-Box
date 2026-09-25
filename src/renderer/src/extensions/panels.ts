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
 */

/** 侧栏项（内置面板之后追加）。 */
export interface ExtMenuItem {
    /** 路由与高亮用的 key。 */
    key: string
    /** 展示名（贡献里的 titleKey，扩展自备 i18n）。 */
    title: string
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
        title: p.titleKey,
        extId: p.extId,
        extName: p.extName,
        view: p.view,
        icon: p.icon
    }))
}

/** 某 key 是否是扩展面板（SettingsView 据此把路由交给扩展面板视图）。 */
export function isExtPanel(key: string): boolean {
    return extState.panels.some((p) => p.key === key)
}

/** 取某 key 对应的扩展面板项。 */
export function extPanelOf(key: string): ExtMenuItem | undefined {
    return extMenus().find((p) => p.key === key)
}

/**
 * 外壳登记的本地视图实现：`view` 名 → 组件。
 *
 * 只放**内置 / 系统**扩展的实现（随构建进包）。外部扩展即使声明了同名 view，
 * 也拿不到这里的组件 —— {@link resolveExtPanelView} 会按 kind 判定。
 */
const LOCAL_VIEWS: Record<string, () => Promise<Component>> = {
    // 「扩展管理」页（由内置扩展 box.extensions 贡献）。
    extensions: () => import('../views/settings/ExtensionsPanel.vue')
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

/** 注册设置面板控制点（设置页通过 `extMenus()` 响应式读取，故此处无副作用）。 */
export function registerExtPanels(): void {
    // 与 registerExtTabs 对称保留：让 index.ts 的装配一眼可见两个控制点。
}
