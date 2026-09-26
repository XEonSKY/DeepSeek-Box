import { provideActions } from '../../loader/capability'
import { reloadExt, reloadAllLoader, info } from '../../loader'
import type { ExtContext } from '../../loader/ctx'
import type { ExtensionsInfo } from '@shared/extensions'

/**
 * 系统扩展 `system.extmanage` —— 把**扩展层的管理动作**包装成能力。
 *
 * 与 `system.app` 包装内核服务槽、`system.fs` 包装内核文件操作同一套路：
 * 本扩展不实现任何逻辑，只把加载器已有的导出（`loader/index.ts` 的
 * `reloadExt` / `reloadAllLoader` / `info`）按动作注册进能力槽。
 *
 * ## 为什么需要这条能力
 *
 * 「重载扩展」是扩展开发与调试时最常用的动作（改完代码不想重启整个应用）。
 * 它天然属于**加载器**的职责，而加载器不对外暴露（内核侧经 `modules/extensions.ts` 调用）。
 * 把这条入口做成系统能力后：
 *
 *  - 别的扩展（如 `xeonsky.extui` 的界面、将来的扩展市场）可以经同一条路径触发重载，
 *    不必让加载器认识它们，也不必给它们开特例；
 *  - 能力面可枚举、可审计 —— 想知道「谁能重载扩展」只需看这条能力被谁申请。
 *
 * ## 与内核路由的分工
 *
 * 基础管理端点（列表 / 启停 / 重载）仍由内核模块 `modules/extensions.ts` 直接提供，
 * 因为它们是**外壳自身**的能力：即便所有扩展被安全模式停掉，用户也要能操作它们，
 * 不能依赖某个扩展加载成功。本能力是给「扩展生态内部互相协作」用的入口，
 * 与那条路由并存、调用同一个加载器实现，因此不存在两套行为。
 */

/** 允许的动作。 */
const actions = {
    /**
     * 重载单个扩展（卸载 → 按当前磁盘状态重新激活）。
     *
     * @returns 该扩展重载后的界面信息；id 不存在时为 null
     */
    reload: (id: string): Promise<unknown> => reloadExt(id) as Promise<unknown>,

    /**
     * 重载全部扩展（等价于重新执行一次加载器启动流程，但不重启 Electron）。
     *
     * @returns 重载后的完整扩展信息
     */
    reloadAll: (): Promise<ExtensionsInfo> => reloadAllLoader(),

    /** 当前扩展列表快照（含失败 / 跳过 / 停用与安全模式状态）。 */
    list: (): ExtensionsInfo => info()
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'extmanage', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info('capability provided: extmanage (actions: reload, reloadAll, list)')
}
