import { Router } from '../kernel/router'
import { ModuleRegistry } from '../kernel/module'
import { allModules } from '../modules'

/**
 * 主进程装配器。
 *
 * 这里**不再**写任何具体端点，也不再 import 任何 `app/*` 或 `dsh/*` 模块 —— 它只做三件事：
 *
 *   1. 建路由引擎（Router：全项目唯一碰 `ipcMain` 的地方）；
 *   2. 把 `modules/` 里的模块树收集成注册表；
 *   3. `mountRoutes` 统一挂载，并 `listen()` 在唯一通道上开始接收请求。
 *
 * 端点本身由各模块用 `defineModule({ id, routes })` 自证（见 `modules/*.ts`），
 * 类型仍由 `@shared/api` 的 `ApiRoutes` 校验，所以「契约唯一事实来源」这条没变。
 *
 * 装配期会发现并拦下两类错误：**跨模块端点重名**（两个模块抢同一条路径）与
 * **路径写错**（编译期，由 ApiRoutes 约束）。
 */
let registry: ModuleRegistry | null = null

/** 全部模块的路由挂载到唯一通道上（幂等：重复调用只生效一次）。 */
export function registerIpc(): void {
    if (registry) return
    const router = new Router()
    registry = new ModuleRegistry(allModules())
    registry.mountRoutes(router)
    router.listen()
}

/**
 * 运行各模块的 `onReady` 钩子（`app.whenReady()` 之后、建窗之前调用）。
 *
 * 与 `registerIpc()` 分开：模块的路由在 ready 前即可挂载（纯登记），但部分 `onReady`
 * 需要 Electron 就绪态（例如给内核注册服务、申请 session 能力），故由入口在两处分别驱动。
 */
export async function runModuleReady(): Promise<void> {
    await registry?.runReady()
}

/** 运行各模块的 `onQuit` 钩子（真正退出前调用，逆序）。 */
export async function runModuleQuit(): Promise<void> {
    await registry?.runQuit()
}
