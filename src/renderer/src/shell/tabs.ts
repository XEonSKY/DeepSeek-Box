import { reactive } from 'vue'
import { tt } from '../lib/locales'
import { isNewTabTarget } from '@shared/types'

/**
 * 标题栏「浏览器标签页」模型（渲染层单例）。
 *
 * 三个固定站标签页（home dsh UI / chat 网页对话 / platform 用量充值）始终保活、不可关闭。
 * 动态标签页（由 `ui:new-tab` 或「＋ 新建」产生）**可以开很多**（不再自动关闭），但为控制
 * 资源只对其中的最近 `KEEP_ALIVE_DYNAMIC` 个做 webview 保活；其余标签仍保留在列表里，
 * 切回时再（重新）加载。固定三站不计入该保活上限。
 *
 * 标签页只存「要去哪 / 叫什么 / 最近用次序」；真正承载页面的 `<webview>` 由 WebHost.vue
 * 按 id 维护（本模块不持有 webview DOM，避免与 Vue 渲染耦合）。
 */

export type WebTabKind = 'home' | 'chat' | 'platform' | 'dynamic' | 'newtab'

/** 动态标签页中保活（webview 常驻）的最近数量上限。 */
export const KEEP_ALIVE_DYNAMIC = 3

export interface WebTab {
    id: string
    kind: WebTabKind
    /** 标题；固定来源可为空串，由 UI 用 $t('app.nav.*') 提供友好名，动态标签页则存真实标题。 */
    title: string
    /** 目标 URL。home 在 dsh 就绪前为 null。 */
    url: string | null
    /** 固定（始终保活、不可关闭）。 */
    pinned: boolean
    /** 用户“保活”固定（动态标签页用）：webview 常驻，不计入最近 3 个保活名额；仍可关闭/取消。 */
    keep: boolean
    /** 是否曾被打开过：固定三站只有打开过才开始保活。 */
    visited: boolean
    /** LRU 次序（越大越新），用于决定哪些动态标签页保活。 */
    used: number
}

interface TabsState {
    list: WebTab[]
    activeId: string | null
}

let seq = 0
let order = 0
const newId = (kind: WebTabKind): string => `${kind}-${Date.now()}-${++seq}`
const nextOrder = (): number => ++order

/** 从一个 URL 提炼站点标题（主域名 + 主机名）。 */
function titleFromUrl(url: string): string {
    try {
        const u = new URL(url)
        const host = u.hostname.replace(/^www\./, '')
        return host || u.href
    } catch {
        return url
    }
}

export const webTabs: TabsState = reactive<TabsState>({
    list: [
    // 三个固定站始终存在，但只有打开过才开始保活。
        { id: 'home', kind: 'home', title: '', url: null, pinned: true, keep: false, visited: false, used: nextOrder() },
        { id: 'chat', kind: 'chat', title: '', url: 'https://chat.deepseek.com/', pinned: true, keep: false, visited: false, used: nextOrder() },
        { id: 'platform', kind: 'platform', title: '', url: 'https://platform.deepseek.com/', pinned: true, keep: false, visited: false, used: nextOrder() }
    ],
    activeId: 'home'
})

/** 某标签页的 UI 文案：无自有标题时按 kind 取友好名。 */
export const FIXED_LABEL_KEY: Record<'home' | 'chat' | 'platform', string> = {
    home: 'app.nav.ui',
    chat: 'app.nav.chat',
    platform: 'app.nav.platform'
}

/**
 * 标签页的显示文案：固定三站取 i18n 友好名，动态/新标签页用真实标题、没有则用默认名。
 * （App 的窗口标题同步与 TitleBar 的标签渲染都要用，故收敛在此，避免两处各写一份。）
 */
export function tabLabel(tab: WebTab): string {
    if (tab.kind === 'home' || tab.kind === 'chat' || tab.kind === 'platform') {
        return tt(FIXED_LABEL_KEY[tab.kind])
    }
    return tab.title || tt('app.tabs.new')
}

export function findTab(id: string): WebTab | undefined {
    return webTabs.list.find((t) => t.id === id)
}

export function activeTab(): WebTab | undefined {
    return findTab(webTabs.activeId ?? '') ?? webTabs.list.find((t) => t.kind === 'home')
}

/** 切换激活标签页，并把其 LRU 次序推到最新。 */
export function activateTab(id: string): void {
    const t = findTab(id)
    if (!t) return
    webTabs.activeId = id
    t.used = nextOrder()
}

/** 切换某标签页的“保活固定”（动态标签页）；固定后 webview 常驻且不计入最近 3 个名额。 */
export function toggleKeep(id: string): void {
    const t = findTab(id)
    if (!t || t.kind !== 'dynamic') return
    t.keep = !t.keep
    if (t.keep) t.used = nextOrder() // 顺手置为最近，避免刚固定就被裁
}

/** 需要给 webview 保活的标签页 id：已打开过的固定三站 + 用户“保活”的动态标签页（不计名额）+ 其余最近 N 个动态。 */
export function keptTabIds(): Set<string> {
    const keep = new Set<string>()
    // 固定三站只有打开过(visited)才开始保活
    for (const t of webTabs.list) {
        if ((t.kind === 'home' || t.kind === 'chat' || t.kind === 'platform') && t.visited) keep.add(t.id)
    }
    // 用户固定的动态标签页总是保活、不计入名额
    for (const t of webTabs.list) {
        if (t.kind === 'dynamic' && t.keep) keep.add(t.id)
    }
    // 其余(未固定)动态标签页按最近使用保活 KEEP_ALIVE_DYNAMIC 个
    const unpinned = webTabs.list
        .filter((t) => t.kind === 'dynamic' && !t.keep)
        .sort((a, b) => b.used - a.used)
        .slice(0, KEEP_ALIVE_DYNAMIC)
    for (const t of unpinned) keep.add(t.id)
    return keep
}

/** 从列表移除一个标签页（固定标签页忽略）。若移除的是当前激活页则回退相邻/首个标签。 */
function removeTabById(id: string): void {
    const i = webTabs.list.findIndex((t) => t.id === id)
    if (i < 0) return
    if (webTabs.list[i].pinned) return
    webTabs.list.splice(i, 1)
    if (webTabs.activeId === id) {
        const next = webTabs.list[Math.min(i, webTabs.list.length - 1)] ?? webTabs.list[0] ?? null
        webTabs.activeId = next ? next.id : null
    }
}

/** 关闭一个标签页（动态/新标签页可由用户关闭）。 */
export function closeTab(id: string): void {
    removeTabById(id)
}

/** 固定三站的规格（id=kind）。核心窗口才显示。 */
const FIXED_SPECS: Array<{ id: string; kind: WebTabKind; url: string | null; title: string }> = [
    { id: 'home', kind: 'home', url: null, title: '' },
    { id: 'chat', kind: 'chat', url: 'https://chat.deepseek.com/', title: '' },
    { id: 'platform', kind: 'platform', url: 'https://platform.deepseek.com/', title: '' }
]

/**
 * 依据本窗口是否“核心窗口”调整固定标签集合（幂等）：
 * - 核心：若缺少 dsh UI/网页对话/用量 则补齐（用于“副窗口接管成为新核心”时补上 dsh UI）。
 * - 非核心：移除三固定站（只保留动态/新建标签）。
 */
export function setCoreRole(isCore: boolean): void {
    const hasKind = (k: WebTabKind): boolean => webTabs.list.some((t) => t.kind === k)
    const fixedKinds = new Set<WebTabKind>(['home', 'chat', 'platform'])

    if (!isCore) {
        for (let i = webTabs.list.length - 1; i >= 0; i--) {
            if (fixedKinds.has(webTabs.list[i].kind)) webTabs.list.splice(i, 1)
        }
        if (!findTab(webTabs.activeId ?? '')) {
            webTabs.activeId = webTabs.list[0]?.id ?? null
        }
        return
    }

    // 核心：逐条补齐缺失的固定站，保持 dsh UI/网页/用量 的相对顺序
    for (let ci = 0; ci < FIXED_SPECS.length; ci++) {
        const spec = FIXED_SPECS[ci]
        if (hasKind(spec.kind)) continue
        // 插到“后一个已存在的固定站”之前，否则追加到末尾
        let idx = -1
        for (let later = ci + 1; later < FIXED_SPECS.length; later++) {
            const at = webTabs.list.findIndex((t) => t.kind === FIXED_SPECS[later].kind)
            if (at >= 0) {
                idx = at
                break
            }
        }
        if (idx < 0) idx = webTabs.list.length
        webTabs.list.splice(idx, 0, {
            id: spec.id,
            kind: spec.kind,
            title: spec.title,
            url: spec.url,
            pinned: true,
            keep: false,
            visited: false,
            used: nextOrder()
        })
        if (!webTabs.activeId) webTabs.activeId = spec.id
    }
}

/** 动态开新标签并激活（不做数量上限；保活交给 keptTabIds / WebHost）。 */
export function openTab(url: string, title?: string): WebTab {
    const tab: WebTab = {
        id: newId('dynamic'),
        kind: 'dynamic',
        title: title ?? titleFromUrl(url),
        url,
        pinned: false,
        keep: false,
        visited: false,
        used: nextOrder()
    }
    webTabs.list.push(tab)
    webTabs.activeId = tab.id
    return tab
}

/**
 * 按“目标”打开标签页：target 为内置导航页伪链接(dssh://about:blank)时开一个内置导航页，
 * 否则视为普通 URL 开动态标签页。无目标返回 null。
 */
export function openTarget(target: string | null | undefined): WebTab | null {
    if (!target) return null
    if (isNewTabTarget(target)) return openNewTab()
    return openTab(target)
}

/**
 * 打开一个内置导航页标签（点「＋」）。每次调用都新建一个导航页标签并激活，
 * 不自动复用，方便连续开新页。
 * 具体内容是否内置由设置 newTabMode 决定（'url' 时由调用方改走 openTab）。
 */
export function openNewTab(): WebTab {
    const tab: WebTab = {
        id: newId('newtab'),
        kind: 'newtab',
        title: '',
        url: null,
        pinned: false,
        keep: false,
        visited: false,
        used: nextOrder()
    }
    webTabs.list.push(tab)
    webTabs.activeId = tab.id
    return tab
}

/**
 * 从导航页发起一次跳转（搜索 / 点常用站点）：新建一个真实(动态)标签页承载该 URL，
 * 并关闭当前这个导航页（导航页是一次性的）。
 */
export function launchFromNewTab(url: string, title?: string): WebTab {
    const fromId = webTabs.activeId
    const tab = openTab(url, title)
    if (fromId) {
        const from = findTab(fromId)
        if (from && from.kind === 'newtab') removeTabById(fromId)
    }
    return tab
}

/** dsh 就绪后把地址填入 home 标签页（并确保 home 存在）。 */
export function setHomeUrl(url: string | null): void {
    const home = webTabs.list.find((t) => t.kind === 'home')
    if (home) {
        if (home.url !== url) home.url = url
    } else {
        webTabs.list.unshift({ id: 'home', kind: 'home', title: '', url, pinned: true, keep: false, visited: false, used: nextOrder() })
    }
}
