import type { HttpMethod } from '@shared/api'
import { Router } from './router'

/**
 * 扩展端点的挂载点 —— 内核侧为扩展开的一个**受控口子**。
 *
 * 为什么需要这个文件：内核的 `Router` 只接受 `ApiRoutes` 里声明过的路径（编译期约束），
 * 而扩展端点是**运行期才知道**的（`ext:<extId>:<action>`），不可能写进共享契约。
 * 于是这里提供一个「绕过类型约束」的登记函数，但它把水搅浑的范围**限制到最小**：
 *
 *  - 路径前缀固定为 `/ext/`，扩展无法声明任意路径（防与内置端点撞名，
 *    也防外部扩展伪装成内置端点被渲染层调用）；
 *  - 仍然挂进**同一个 Router**，于是仍然只有那一个 `ipcMain.handle`，
 *    扩展端点走的是同一条消息通道、同一套分发逻辑；
 *  - 重复路径在 Router 内部按「后注册覆盖」处理 —— 但由于前缀含扩展 id，
 *    跨扩展不可能重名；扩展自己重复声明同一 action 会在注册表（registry）被拦下。
 *
 * 返回的撤销函数用于卸载扩展时摘除端点（由 registry 按 owner 记账）。
 */

/** 扩展端点路径的固定前缀。 */
export const EXT_ROUTE_PREFIX = '/ext'

/** 唯一 Router 实例（由 `app/ipc.ts` 在装配期注入）。 */
let activeRouter: Router | null = null

/** 注入 Router（`registerIpc()` 里调用一次）。 */
export function bindExtRouter(router: Router): void {
    activeRouter = router
}

/**
 * 登记一条扩展端点。
 *
 * @param method HTTP 方法（扩展目前只用 POST，但保留完整动词）
 * @param routePath 完整路径，形如 `/ext/<extId>/<action>`
 * @param handler 处理函数（入参为 `{ params, query, body }`，返回值即响应）
 * @returns 撤销函数（从 Router 里摘除该端点）
 */
export function registerExtRoute(
    method: HttpMethod,
    routePath: string,
    handler: (...args: never[]) => unknown
): () => void {
    if (!activeRouter) throw new Error('扩展路由尚未就绪：Router 未绑定')
    if (!routePath.startsWith(`${EXT_ROUTE_PREFIX}/`)) {
        throw new Error(`扩展端点必须以 ${EXT_ROUTE_PREFIX}/ 开头：${routePath}`)
    }
    // Router.add 的 handler 签名是宽松的（unknown），这里收窄成扩展约定的一致性检查。
    activeRouter.add(method, routePath, handler)
    return () => {
        activeRouter?.remove(method, routePath)
    }
}
