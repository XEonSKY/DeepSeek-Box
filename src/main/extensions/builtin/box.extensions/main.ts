import type { ExtContext } from '../../loader/ctx'

/**
 * 内置扩展 `box.extensions` —— 「扩展管理」页的贡献者。
 *
 * 它自己不提供任何能力，只做一件事：在设置页贡献一个面板（`contributions.settings`），
 * 并把视图交给外壳登记的实现（渲染层的 `view: 'extensions'`）。
 *
 * 为什么把管理页也做成扩展（而不是外壳里的一个内置面板）：
 * 「扩展管理」需要能用**同一套**控制点去呈现 —— 如果它走特例，就无法验证
 * 「内置扩展与外部扩展在控制点上待遇一致」这条设计目标；而且将来把管理页
 * 交给第三方实现，只需要改这一个扩展。
 *
 * 主进程侧不需要 activate 做任何事：管理端点属于内核模块（`modules/extensions.ts`），
 * 因为它们是**外壳自身**的能力（即便所有扩展被安全模式停掉，也要能操作），
 * 不能依赖扩展加载成功。本扩展只负责"把它挂到设置页里"。
 */
export function activate(ctx: ExtContext): void {
    ctx.log.info('内置扩展 box.extensions 已激活（贡献：设置页「扩展管理」面板）')
}
