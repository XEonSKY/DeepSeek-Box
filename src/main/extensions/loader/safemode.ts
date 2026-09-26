/**
 * 崩溃计数与**安全模式**判定的纯逻辑。
 *
 * 背景：扩展**反复崩溃时进安全模式，全部扩展不加载**，
 * 让用户有一条自救路径 —— 因为扩展与内核**同进程无隔离**，一个反复崩溃的扩展
 * 会让应用每次启动都崩在同一处，用户连界面都进不去。
 *
 * 三处要点：
 *
 *  1. **系统扩展不参与**：它是能力包装，禁掉它等于内核能力凭空消失，
 *     而且它随内核一同发布、有编译期保障，不承担「运行期恶意/半成品代码」的风险。
 *  2. 计数按**启动次数**记：扩展崩溃绝大多数发生在加载/激活阶段，按启动计能立刻收敛，
 *     不会让用户连续启动十几次都在同一个地方崩。
 *  3. 进安全模式时要能**说清是哪个扩展崩的** —— 否则用户不知道该删哪个目录。
 *
 * 本文件保持纯逻辑（不碰 fs、不 import electron）。
 */

import type { ExtKind } from '@shared/extensions'
import { EXT_CRASH_THRESHOLD, EXT_CRASH_WINDOW } from '@shared/extensions'

/** 一次崩溃记录。 */
export interface CrashRecord {
    id: string
    /** 连续失败次数（成功启动一次后由调用方清零）。 */
    count: number
    /** 最近一次失败的原因（用于界面提示）。 */
    lastReason: string
}

/** 安全模式判定结果。 */
export interface SafeModeDecision {
    /** 是否应进入安全模式。 */
    safeMode: boolean
    /** 触发安全模式的扩展（用于提示「是谁崩的」）。 */
    culprits: CrashRecord[]
    /** 给用户看的说明（已含扩展名，便于定位到目录）。 */
    reason: string
}

/**
 * 记录一次崩溃并判断是否该进安全模式。
 *
 * @param crashes 已有计数（会被就地更新）
 * @param id 崩溃的扩展 id
 * @param reason 失败原因
 */
export function recordCrash(crashes: Record<string, number>, id: string, reason: string): void {
    crashes[id] = (crashes[id] ?? 0) + 1
    // 只保留最近若干次的语义由调用方在启动成功时清零实现，这里不做衰减 ——
    // 衰减会让「每三次崩两次」这种稳定复现的问题被稀释而永远进不了安全模式。
    void reason
}

/**
 * 判定是否进入安全模式。
 *
 * @param crashes 崩溃计数
 * @param reasons 各扩展最近一次失败的说明（可选，用于提示）
 * @param kinds 扩展 id → 级别（**系统扩展被排除**）
 */
export function decideSafeMode(
    crashes: Record<string, number>,
    reasons: Record<string, string>,
    kinds: Record<string, ExtKind>
): SafeModeDecision {
    const culprits: CrashRecord[] = []
    for (const [id, count] of Object.entries(crashes)) {
        // 系统扩展从不参与安全模式判定。
        if (kinds[id] === 'system') continue
        if (count < EXT_CRASH_THRESHOLD) continue
        culprits.push({ id, count, lastReason: reasons[id] ?? '' })
    }
    if (culprits.length === 0) return { safeMode: false, culprits: [], reason: '' }

    culprits.sort((a, b) => b.count - a.count)
    const list = culprits.map((c) => (c.lastReason ? `${c.id}（${c.lastReason}）` : c.id)).join('、')
    return {
        safeMode: true,
        culprits,
        reason: `以下扩展在最近 ${EXT_CRASH_WINDOW} 次启动中反复失败，已进入安全模式并暂停加载全部内置 / 外部扩展：${list}。可在扩展页逐个启用排查，或直接删除对应目录。`
    }
}

/**
 * 启动成功后清空计数 —— 记为「这一次是好的」。
 *
 * 之所以整体清零而不是逐个衰减：本机制的目标是「让反复崩的应用能启动」，
 * 已经成功启动一次就说明问题不再阻塞启动，没必要继续累计历史。
 */
export function clearCrashesAfterCleanBoot(crashes: Record<string, number>): void {
    for (const key of Object.keys(crashes)) delete crashes[key]
}
