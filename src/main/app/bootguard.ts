/**
 * A/B 启动守卫的**判定逻辑**（纯函数，不 import Electron，便于单测）。
 *
 * 守卫本意是「新版反复起不来就自动回退」，最容易出事的是**回退本身失败**：
 * 老实现只要 attempts 超阈值就无限次重启回退脚本，一旦脚本空转就把整机拖垮
 * （详见 rollbackscript.ts 的注释）。因此规则收窄成三条：
 *
 *  1. 待安装记录与当前运行版本不符 → 说明安装没发生（或回退已生效），清掉记录；
 *  2. 记录里已发起过一次回退（`rollbacks >= 1`）而当前版本**仍是**目标版本 →
 *     回退没生效，直接放弃并清记录，绝不再来第二轮；
 *  3. 未超阈值继续计数，超过才回退。
 */

/** 守卫关心的待安装记录字段（结构子集，避免与 appslots 形成运行时耦合）。 */
export interface BootGuardPending {
    /** 待安装（正在观察）的目标版本。 */
    to: string
    /** 已记录过的「启动但未确认健康」次数。 */
    attempts: number
    /** 已发起过的回退次数（每轮记录至多 1 次）。 */
    rollbacks?: number
}

/** 守卫给出的处置。 */
export type BootGuardDecision =
    | { kind: 'idle' }
    | { kind: 'clear' }
    | { kind: 'count'; attempts: number }
    | { kind: 'rollback'; attempts: number }
    | { kind: 'giveup'; reason: 'alreadyRolledBack' }

/** 计算本次启动该做什么（不做任何 I/O，调用方负责落盘与广播）。 */
export function decideBootGuard(input: {
    /** 当前运行版本。 */
    running: string
    /** 待安装记录；无则 null。 */
    pending: BootGuardPending | null
    /** 允许的「未确认健康」次数上限。 */
    maxAttempts: number
}): BootGuardDecision {
    const { running, pending, maxAttempts } = input
    if (!pending) return { kind: 'idle' }
    if (pending.to !== running) return { kind: 'clear' }
    const attempts = pending.attempts + 1
    // 已经回退过一次还是这个版本 → 回退没起作用，再试只会重复失败与重启
    if ((pending.rollbacks ?? 0) >= 1) return { kind: 'giveup', reason: 'alreadyRolledBack' }
    if (attempts > maxAttempts) return { kind: 'rollback', attempts }
    return { kind: 'count', attempts }
}
