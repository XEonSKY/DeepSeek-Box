import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 顶层视图（web / settings / setup）的路由映射。
 *
 * 原先 App.vue 里同时存在 `view` computed、`go()` 与 `ensureWebRoute()` 三份等价逻辑；
 * 抽出 TitleBar 后两边都需要，故收敛到本模块（封装重复、避免两处各写一份而漂移）。
 *
 * **终端不再是顶层视图**：它已并进设置页成为 `/settings/log` 面板；Ctrl+T 的「跳到终端」
 * 语义由 `useToggleTerminal()` 直接跳那一个子页（用 useGoView('settings') 只会落到设置首页）。
 *
 * **初始化页（setup）是顶层视图**：它和设置页一样盖在 web 之上（webview 仍保活），
 * 但不是强制流程 —— 用户可自由离开，只有进入 dsh 页面时才会被送回去（见 App.vue 的 watch）。
 */

export type ViewKey = 'web' | 'settings' | 'setup'

/** 初始化页（安装向导）的 hash 路径。 */
export const SETUP_PATH = '/setup'

/** 终端所在的设置子页（设置侧栏「终端」；Ctrl+T 的去处）。 */
export const TERMINAL_PATH = '/settings/log'

/** 当前顶层视图（由 hash 路由推导）。 */
export function useView(): ComputedRef<ViewKey> {
    const route = useRoute()
    return computed<ViewKey>(() => {
        if (route.path.startsWith('/settings')) return 'settings'
        if (route.path.startsWith(SETUP_PATH)) return 'setup'
        return 'web'
    })
}

/** 切到某顶层视图；路径未变则不做任何事。 */
export function useGoView(): (k: ViewKey) => void {
    const route = useRoute()
    const router = useRouter()
    return (k: ViewKey): void => {
        const path = k === 'web' ? '/' : k === 'settings' ? '/settings' : SETUP_PATH
        if (route.path !== path) void router.push(path)
    }
}

/**
 * Ctrl+T：在网页与「设置·终端」之间来回切（已经停在终端页则回网页）。
 * 不写成 `go(view==='web' ? ... )` 是因为终端现在是设置页的子页，顶层视图这一个维度表达不了它。
 */
export function useToggleTerminal(): () => void {
    const route = useRoute()
    const router = useRouter()
    return (): void => {
        const next = route.path === TERMINAL_PATH ? '/' : TERMINAL_PATH
        if (route.path !== next) void router.push(next)
    }
}
