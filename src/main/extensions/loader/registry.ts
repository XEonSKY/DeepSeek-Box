/**
 * 贡献点注册表（由加载器持有）。
 *
 * 关键约束是**每个注册项都带 owner**，卸载扩展时按 owner 一次性撤销 ——
 * 这是 `rmmod` 语义的另一半（另一半是 capability.revoke）。
 *
 * 为什么需要它：内核提供插槽（比如把一条路由挂进 Router），但**内核并不知道这条路由是谁挂的**。
 * 一旦某个扩展被禁用/崩溃，若不撤销它挂过的东西，就会留下「指向已卸载代码」的端点，
 * 调用时才炸，而且炸在别人的调用栈里。注册表就是解决这个问题的记账本。
 *
 * 本文件保持纯逻辑（不碰 fs、不 import electron）。
 */

/** 一条被登记的贡献：谁（owner）挂了什么（kind），以及撤销它要做什么。 */
interface Contribution {
    owner: string
    /** 贡献种类，同时用作撤销时的分组依据（如 'route' / 'tab' / 'settings-panel'）。 */
    kind: string
    /** 唯一 key（同一 kind 内），用于查重与定位。 */
    key: string
    /** 撤销回调：由登记方提供，必须能安全地重复调用。 */
    dispose: () => void
}

const items: Contribution[] = []

/** 登记一条贡献，返回撤销函数（便于调用方在内部提前归还）。 */
export function register(owner: string, kind: string, key: string, dispose: () => void): () => void {
    const dedup = `${kind}\u0000${key}`
    const existing = items.find((i) => `${i.kind}\u0000${i.key}` === dedup)
    if (existing) {
        // 同 kind 同 key 的冲突属于装配错误：两个扩展抢同一个 key（或同一扩展重复注册）。
        throw new Error(`贡献点重复登记：${kind} ${key}（${existing.owner} 与 ${owner}）`)
    }
    const item: Contribution = { owner, kind, key, dispose }
    items.push(item)
    return () => removeOne(item)
}

/** 从数组里摘掉一条并执行其 dispose（重复调用安全）。 */
function removeOne(item: Contribution): void {
    const idx = items.indexOf(item)
    if (idx < 0) return
    items.splice(idx, 1)
    try {
        item.dispose()
    } catch (err) {
        // 撤销阶段的异常不该阻断卸载流程：报出来继续摘其它的。
        console.error(`[ext] 撤销贡献点失败：${item.kind} ${item.key}`, err)
    }
}

/**
 * 撤销某个扩展的全部贡献，返回撤销条数。
 *
 * 逆序撤销：后登记的先撤，与加载顺序对称（同内核 `runQuit` 的语义）。
 */
export function revokeAll(owner: string): number {
    const owned = items.filter((i) => i.owner === owner)
    for (let i = owned.length - 1; i >= 0; i--) removeOne(owned[i])
    return owned.length
}

/** 某个扩展当前挂着的贡献（界面展示与排查用）。 */
export function listByOwner(owner: string): Array<{ kind: string; key: string }> {
    return items.filter((i) => i.owner === owner).map((i) => ({ kind: i.kind, key: i.key }))
}

/** 某类贡献的全部 key（用于检查冲突与调试）。 */
export function listByKind(kind: string): Array<{ owner: string; key: string }> {
    return items.filter((i) => i.kind === kind).map((i) => ({ owner: i.owner, key: i.key }))
}

/** 当前登记总数。 */
export function size(): number {
    return items.length
}

/** 清空（仅在整体卸载 / 测试时用）。 */
export function reset(): void {
    items.length = 0
}
