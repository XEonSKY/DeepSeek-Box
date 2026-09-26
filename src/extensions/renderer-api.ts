/**
 * 渲染层扩展 API 面 —— 与主进程的 `ExtContext`（`main/extensions/loader/ctx.ts`）对称。
 *
 * 本文件位于 `src/extensions/` 根下（不在任何具体扩展目录里）：它是**公共设施**，
 * 供所有扩展的渲染层实现使用，所以刻意与各扩展目录平级、文件名带 `-api` 后缀以示区别。
 * 各扩展则在 `src/extensions/<id>/` 下自成一体（如 `xeonsky.extui/`）。
 *
 * ## 为什么需要这一层
 *
 * 主进程侧早就定了「扩展只依赖加载器给的 ctx，**不直接 import 内核**」这条原则
 * （见 loader/ctx.ts 顶部说明），好处是内核内部重构不波及扩展。
 * 但渲染层侧一直缺一个对应的东西：内置扩展的视图要取翻译、要调 IPC，
 * 只能去 import 外壳的内部模块（`@/lib/locales` 之类）。
 *
 * 那样等于**扩展直接依赖内核** —— 与主进程侧的原则自相矛盾，
 * 而且把「外壳内部实现细节」变成了事实上的稳定契约：
 * 哪天 `lib/locales` 改名或拆分，所有扩展视图跟着坏，尽管 `ctx` 契约没动。
 *
 * ## 这一层给什么
 *
 * 只给**扩展做界面必需**的几件事，刻意很窄（与 ctx 一样窄）：
 *  - 应用内 IPC（{@link extApi}，内核与扩展用同一份端点契约）；
 *  - 本窗口界面状态（{@link extShell}，标签页 / 视图切换 —— 这些是渲染层单例，
 *    不走 IPC）；
 *  - 取翻译（{@link extT}，组件外兜底；组件内请用 `useI18n()`）；
 *  - 错误信息归一（{@link extErrorMessage}）。
 *
 * 不给 Router 实例、不给 store、不给任意 lib —— 想要更多能力应当先扩这一层，
 * 让它成为**唯一**的扩展可见面。
 *
 * ## 谁可以用
 *
 * 内置扩展的渲染层实现（`src/extensions/<id>/*.vue`）与将来的外部扩展渲染层入口。
 * 外壳自身的界面（`renderer/src/views/**`）**不必**走这里 —— 它是内核的一部分，
 * 直接 import 内部模块是正常的。本层的价值在于把「扩展能看见什么」显式化。
 */

import type { RendererApi } from '@shared/api'
import { tt } from '../renderer/src/lib/locales'
import { errorMessage } from '@shared/errors'
import { activateTab, closeTab, findTab, openTab, webTabs } from '../renderer/src/shell/tabs'
import { useGoView } from '../renderer/src/shell/viewnav'

/**
 * 应用内 IPC 面（`window.api` 的扩展可见子集）。
 *
 * 直接转发而不是重新实现：`window.api` 的类型由 `@shared/api.ts` 的端点表派生，
 * 扩展与内核用的是**同一份契约**。本层先原样透出，将来若要按扩展做端点白名单，
 * 拦在这里即可 —— 这正是要有一层显式 API 的意义。
 *
 * 与 `window.api` 完全同构（含 `ext` 自定义通道）：扩展既能调内置端点，
 * 也能用自己的 `ext:<id>:<action>` 通道，与主进程侧 `ctx.ipc` 对应。
 */
export const extApi: RendererApi = window.api

/**
 * 外壳**标签页 / 视图**的受控操作面。
 *
 * ## 为什么需要它（而不是走 IPC 端点）
 *
 * 标签页模型（`renderer/src/shell/tabs.ts`）是**渲染层单例**，主进程根本不持有它 ——
 * 「切到某个固定站」「开一个动态标签页并关掉发起它的导航页」这类动作在渲染层就地就能
 * 完成，绕主进程一圈既慢、又把纯窗口内状态变成跨进程契约。
 *
 * 但扩展的渲染层实现**不能直接 import 外壳内部**（与主进程侧同一原则），
 * 于是在这里给出一组**窄接口**：只暴露扩展做界面真正需要的几个动作，
 * 每个都对应外壳的一个既有语义。扩展拿不到 `webTabs` 这个可变单例本身 ——
 * 否则它能任意改标签列表，等于绕过外壳的状态机。
 *
 * ## 与 {@link extApi} 的分工
 *
 * `extApi` 管**跨进程**（设置、扩展信息、窗口控制……）；本对象管**本窗口内的界面状态**。
 * 两者合起来才是扩展能看见的完整面。
 */
export interface ExtShellAccess {
    /**
     * 开一个动态标签页承载 url，并把它激活。
     *
     * @param closeSelf 是否顺带关掉「当前这个内置导航页」—— 导航页是一次性的，
     *                  从它发起的跳转不该把它继续留在标签栏上。当前激活页不是导航页时无效果。
     */
    openTab(url: string, title?: string, closeSelf?: boolean): void
    /** 激活外壳的固定站标签页（`home` / `chat` / `platform`）；`closeSelf` 语义同上。 */
    activateFixed(tabId: string, closeSelf?: boolean): void
    /** 切到设置页（可选定位到某个面板 key，如 `browser`）。 */
    goSettings(panel?: string): void
}

/** 若当前激活页是内置导航页则关掉它（`closeSelf` 的统一实现）。 */
function closeSelfIfNewTab(selfId: string | null): void {
    if (!selfId) return
    const self = findTab(selfId)
    if (self && self.kind === 'newtab') closeTab(selfId)
}

export const extShell: ExtShellAccess = {
    openTab(url, title, closeSelf) {
        const selfId = closeSelf ? webTabs.activeId : null
        openTab(url, title)
        if (selfId) closeSelfIfNewTab(selfId)
    },
    activateFixed(tabId, closeSelf) {
        const selfId = webTabs.activeId
        if (!findTab(tabId)) return
        activateTab(tabId)
        if (closeSelf) closeSelfIfNewTab(selfId)
    },
    goSettings(panel) {
        useGoView()('settings')
        if (panel) {
            void import('../renderer/src/shell/router').then((m) => m.router.push(`/settings/${panel}`))
        }
    }
}

/**
 * 在**非组件**环境取翻译（模块级代码 / 组合式函数里没有 `useI18n` 上下文）。
 *
 * 组件内请优先用 vue-i18n 的 `useI18n()` —— 它才是响应式的正路，
 * 本函数是给组件外用的兜底。之所以再包一层而不是让扩展直接 import 外壳的
 * `lib/locales`，是为了守住「扩展不直接依赖内核」这条线。
 */
export function extT(key: string, named?: Record<string, unknown>): string {
    return tt(key, named)
}

/**
 * 把任意抛出的值归一成可展示的错误文案（含解包 IPC 错误）。
 *
 * 扩展视图几乎每处 `catch` 都要做这件事，收进 API 面可避免各视图各写一份。
 */
export function extErrorMessage(err: unknown): string {
    return errorMessage(err)
}
