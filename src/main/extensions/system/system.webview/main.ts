import { session } from 'electron'
import type { PermissionCheckHandlerHandlerDetails } from 'electron'
import { provideActions } from '../../loader/capability'
import { loadSettings } from '../../../app/settings'
import { proxyActive, proxyUrl } from '../../../dsh/net'
import { proxyConfigFor } from '../../../dsh/http'
import type { ExtContext } from '../../loader/ctx'

/**
 * 系统扩展 `system.webview` —— 把「内嵌页面所在会话」的操作包装成能力。
 *
 * 这条能力**只服务一个消费者**：内置扩展 `xeonsky.browser`。之所以仍要坚持做成
 * 系统能力（而不是让那个扩展直接 import 内核），是为了守住依赖方向 ——
 * 扩展只能经 API 面触达内核，需要的新能力先扩能力面（见 AGENTS.md 红线）。
 *
 * ## 这个能力暴露什么
 *
 * 内嵌 `<webview>` 跑在 **defaultSession** 上（不是 dsh 自己的分区，也不是自更新器的
 * `electron-updater` 分区），因此这里的三组动作都作用于 `session.defaultSession`：
 *
 *  - UserAgent：让内嵌页面以一个普通的桌面浏览器身份出现（部分站点按 UA 分流）；
 *  - 代理：让「程序本体」范围的代理设置真正作用到 webview 的请求上；
 *  - 权限处理器：给任意站点装上「默认拒绝、白名单放行、拿不准就问」的策略。
 *
 * ## 为什么权限判定逻辑不在这里
 *
 * 这里只做**机制**（把处理器装到 session 上），判定规则与那个「记住选择」的记忆表
 * 属于**策略**，放在消费方（`xeonsky.browser`）里 —— 与内核 modules/kernel 的分层同构：
 * 能力层薄，策略层可替换。故 `installPermissionHandlers` 接收的是几个回调，
 * 而不是自己去 import 一份判定实现。
 */

/** 权限检查回调：给定权限与来源，返回是否放行（同步）。 */
export type PermissionCheck = (
    permission: string,
    requestingOrigin: string,
    details?: PermissionCheckHandlerHandlerDetails
) => boolean

/** 权限请求回调：给定权限与请求详情，异步返回是否放行。 */
export type PermissionRequest = (
    permission: string,
    requestingUrl: string,
    mediaTypes: readonly string[] | undefined
) => Promise<boolean>

/** 已应用的 UA（幂等：值没变就不重复设置）。 */
let appliedUa = ''

/** 已应用的代理 URL；null = 从未显式设置（沿用系统代理），undefined = 未初始化。 */
let appliedProxy: string | null | undefined = undefined

/** 当前 defaultSession（ready 之前为 null）。 */
function currentSession(): Electron.Session {
    return session.defaultSession
}

/** 允许的动作。 */
const actions = {
    /**
     * 把 UserAgent 应用到 defaultSession。
     *
     * **必须在 `app.whenReady()` 之后调用**（ready 前拿不到 defaultSession），
     * 且要在建窗之前 —— 这样 webContents 一创建拿到的就是它。值没变时什么都不做。
     *
     * @returns 是否实际写入了会话（幂等命中时 false）。
     */
    setUserAgent: (ua: string): boolean => {
        if (ua === appliedUa) return false
        try {
            currentSession().setUserAgent(ua)
            appliedUa = ua
            return true
        } catch {
            // ready 之前调用会抛：不更新缓存，调用方可在 ready 后重试。
            return false
        }
    },

    /** 当前已应用到会话的 UserAgent（未设置过为空串）。 */
    currentUserAgent: (): string => appliedUa,

    /**
     * 按当前设置里的「程序本体」代理范围，把代理应用到 defaultSession。
     *
     * 未启用代理时**不调用 setProxy**，保留 Electron 默认的「跟随系统代理」；
     * 只有从「有」变「无」时才显式回落 system。返回 Promise 是因为 `setProxy`
     * 异步生效，建窗 / 保存设置时应当 await，否则第一批请求仍按旧配置发出。
     *
     * @returns 实际生效的代理 URL（null = 系统代理）。
     */
    applyProxy: async (): Promise<string | null> => {
        const cfg = loadSettings()
        const url = proxyActive(cfg, 'app') ? proxyUrl(cfg) : null
        if (appliedProxy === url) return url
        appliedProxy = url
        try {
            await currentSession().setProxy(proxyConfigFor(url))
            return url
        } catch {
            // ready 之前调用会抛：撤销登记，调用方可在 ready 后重试。
            appliedProxy = undefined
            throw new Error('applyProxy failed (session not ready?)')
        }
    },

    /**
     * 给 defaultSession 装上四个权限处理器。
     *
     * **四个缺一不可**：`request` 管主动请求（getUserMedia 等），`check` 管同步查询
     * （navigator.permissions.query、设备枚举），`device` 管 HID / 串口 / USB
     * （**不走 request**），`displayMedia` 管屏幕共享。只装 request 会被后三条绕过。
     *
     * 传回调而不是在这里写死判定：见文件头「为什么权限判定逻辑不在这里」。
     * `onRequest` 为空时按「一律拒绝」装（保守兜底，绝不出现「没回调 = 默认放行」）。
     */
    installPermissionHandlers: (check: PermissionCheck, onRequest?: PermissionRequest): void => {
        const s = currentSession()
        // 设备类（HID / 串口 / USB）一律不给：内嵌页面是任意站点，接硬件属于最不该开放的一类。
        s.setDevicePermissionHandler(() => false)
        // 屏幕共享一律不给：同样理由，录制桌面比接硬件更敏感。
        s.setDisplayMediaRequestHandler((_request, callback) => callback({}))
        s.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
            check(permission, requestingOrigin, details)
        )
        s.setPermissionRequestHandler((_contents, permission, callback, details) => {
            const url = typeof details?.requestingUrl === 'string' ? details.requestingUrl : ''
            const mediaTypes = details && 'mediaTypes' in details ? details.mediaTypes : undefined
            if (!onRequest) {
                callback(false)
                return
            }
            void onRequest(permission, url, mediaTypes).then(
                (granted) => callback(granted),
                () => callback(false)
            )
        })
    },

    /** 撤销登记缓存（扩展停用 / 会话重建时让下次 apply 必定重设）。 */
    resetCache: (): void => {
        appliedUa = ''
        appliedProxy = undefined
    }
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'webview', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info('capability provided: webview (actions: setUserAgent, applyProxy, installPermissionHandlers)')
}
