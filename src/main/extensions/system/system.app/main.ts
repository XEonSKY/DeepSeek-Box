import { provideActions } from '../../loader/capability'
import { useService, hasService, SERVICE } from '../../../kernel/services'
import type { ExtContext } from '../../loader/ctx'

/**
 * 系统扩展 `system.app` —— 把内核的**服务槽**包装成能力。
 *
 * 内核的 `kernel/services.ts` 是「模块之间不直接 import」的解耦手段（控制反转）：
 * 提供方在自己的 `onReady` 注册，消费方按名字取用。扩展若想触达这类跨模块动作
 * （例如「重启 dsh」），走的就是这条能力 —— 与内核模块走同一个服务槽，
 * 于是**扩展和内置模块用的是同一份能力实现**，不存在两套行为。
 *
 * 与其它能力不同的两点：
 *  - 服务是**可选的**（某个服务可能因为对应模块没启用而不存在），因此有 `has` 动作；
 *  - 服务是「无参或少量参数的动作」，因此动作名固定枚举，而不是转发任意服务名 ——
 *    否则等于把内核全部服务名暴露给扩展（能力面就没收窄的意义了）。
 */

/** 允许的动作。 */
const actions = {
    /** 某跨模块服务当前是否可用。 */
    has: (name: string): boolean => hasService(name),
    /**
     * 重启 dsh 子进程。
     *
     * 只开放这一个服务：它是目前唯一有「应用内动作」语义的服务。
     * 需要新的服务，应当先想清楚是否真的该给扩展 —— 能力面越窄，授权才有落点。
     */
    restartDsh: (): unknown => useService(SERVICE.RESTART_DSH)()
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'app', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info('capability provided: app (actions: has, restartDsh)')
}
