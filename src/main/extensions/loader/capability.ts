/**
 * 扩展间**能力槽**（由加载器持有）。
 *
 * 为什么不直接复用内核的 `kernel/services.ts`：两者的**失败策略与时机都不同**。
 *
 *  | | kernel/services | 本模块 |
 *  |---|---|---|
 *  | 策略 | 未注册即抛错（装配错误必须立刻暴露） | 未注册即降级（外部扩展可被禁用，不能连坐） |
 *  | 时机 | 模块 `onReady` 时注册 | 扩展按 manifest 拓扑序激活时注册 |
 *
 * 前者对内核模块是正确的 —— 模块是随包发布的、装配错误就是程序 bug。
 * 但对外部扩展是错的：一个扩展被用户禁用，它的消费者不该因此启动失败。
 *
 * 所以：**内核只提供槽的「机制」（一个 Map 加两个函数），加载器持有「内容」
 * （扩展间的能力图）**。这正是 NeoForge 与 Minecraft 的分工 ——
 * MC 提供了方块/物品的概念，但注册表是 NeoForge 建立的。
 *
 * 本文件保持纯逻辑（不碰 fs、不 import electron），便于被 typecheck 覆盖。
 */

/** 能力实现：一个函数，入参出参由提供方与消费方自行约定。 */
export type CapabilityFn = (...args: never[]) => unknown

/**
 * 一个能力的**动作表**：动作名 → 实现。
 *
 * 能力不直接暴露一堆散落的函数引用，而是暴露一张可枚举的表 —— 于是授权、审计、
 * 将来加日志 / 限流都只需要动一个入口（`ctx.capabilities.call`）。
 * 这也让「这个能力到底能做什么」在类型上是可见的。
 */
export type CapabilityActions = Record<string, (...args: never[]) => unknown>

interface CapEntry {
    /** 提供该能力的扩展 id。 */
    owner: string
    fn: CapabilityFn
    /** 动作表（若提供方用 `provideActions` 注册）。 */
    actions?: CapabilityActions
}

/**
 * 能力名 → 实现。
 *
 * 名字格式：
 *  - `ext:<extId>` 或 `ext:<extId>/<name>`：扩展对外提供的能力；
 *  - 系统能力（`fs` / `net` / ...）不在这里 —— 它们由系统扩展包装，**同样经本槽注册**，
 *    于是消费者用同一条路径取用，不必区分「系统给的」还是「别的扩展给的」。
 */
const caps = new Map<string, CapEntry>()

/** 重复提供同一能力名 = 装配冲突，直接抛错（与内核服务槽同样严格）。 */
export function provide(owner: string, name: string, fn: CapabilityFn): void {
    const existing = caps.get(name)
    if (existing) {
        throw new Error(`能力重复提供：${name}（${existing.owner} 与 ${owner} 都想提供）`)
    }
    caps.set(name, { owner, fn })
}

/**
 * 以**动作表**的形式提供一个能力。
 *
 * 与 `provide` 的区别：这是系统扩展（能力包装）该用的形式 —— 包装的能力天然是
 * 「一组动作」（fs 有 read/write/remove、net 有 fetch…），注册成表之后
 * `ctx.capabilities.call('fs', 'remove', p)` 才能按动作名分发，且动作名可枚举。
 */
export function provideActions(owner: string, name: string, actions: CapabilityActions): void {
    const existing = caps.get(name)
    if (existing) {
        throw new Error(`能力重复提供：${name}（${existing.owner} 与 ${owner} 都想提供）`)
    }
    // fn 只是占位（消费方若直接 use 会拿到它），真正的调用走 actions。
    caps.set(name, { owner, fn: undefined as unknown as CapabilityFn, actions })
}

/** 取一个能力；未提供则抛错（消费方若允许缺失，应先用 `has` 判断）。 */
export function use(name: string): CapabilityFn {
    const entry = caps.get(name)
    if (!entry) throw new Error(`能力尚未提供：${name}（提供它的扩展可能未启用或加载失败）`)
    return entry.fn
}

/** 取一个能力的动作表；未提供（或以单函数形式提供）则返回 null。 */
export function actionsOf(name: string): CapabilityActions | null {
    return caps.get(name)?.actions ?? null
}

/** 能力是否可用（软依赖判定用：缺失即降级，不抛错）。 */
export function has(name: string): boolean {
    return caps.has(name)
}

/** 某个扩展提供了哪些能力（卸载与界面展示用）。 */
export function providedBy(owner: string): string[] {
    const out: string[] = []
    for (const [name, entry] of caps) {
        if (entry.owner === owner) out.push(name)
    }
    return out
}

/**
 * 精确摘除**一个**能力名。
 *
 * 与 {@link revoke} 的区别：后者按 owner 扫全表，用于「连人带能力一起撤」；
 * 本函数只摘指定名字。扩展卸载时逐个撤销自己提供的能力用这个 —— 更精确，
 * 且不受「系统能力的 owner 也是扩展 id」这类巧合的影响。
 *
 * @returns 是否真的摘掉了一个（不存在返回 false）
 */
export function revokeName(name: string): boolean {
    return caps.delete(name)
}

/**
 * 撤销某个扩展提供的全部能力。
 *
 * 这是 `rmmod` 语义的关键一步：卸载扩展时必须把它注册过的能力一并摘掉，
 * 否则后来的扩展会取到一个「提供者已经不在」的陈旧实现。
 *
 * @returns 实际摘除的能力名数量
 */
export function revoke(owner: string): number {
    let n = 0
    for (const [name, entry] of caps) {
        if (entry.owner === owner) {
            caps.delete(name)
            n++
        }
    }
    return n
}

/** 清空全部能力（仅在整体卸载 / 测试时用）。 */
export function reset(): void {
    caps.clear()
}

/** 当前能力快照（界面展示与排查用）。 */
export function snapshot(): Array<{ name: string; owner: string }> {
    return [...caps.entries()].map(([name, entry]) => ({ name, owner: entry.owner }))
}
