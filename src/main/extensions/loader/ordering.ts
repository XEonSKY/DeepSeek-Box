/**
 * 依赖定序的**纯逻辑**：按 manifest 声明的硬依赖做拓扑排序。
 *
 * 为什么这一步必须由加载器持有、而不能让内核做：依赖关系是**扩展与扩展之间**的事，
 * 内核不认识扩展，自然无从排序。这对应 NeoForge 与 Minecraft 的分工 ——
 * MC 提供方块/物品的概念，但**注册表**是 NeoForge 建立的。
 *
 * 排序结果同时决定加载顺序（正序）与卸载顺序（**逆序**），
 * 与内核 `ModuleRegistry` 的 `runReady` 正序 / `runQuit` 逆序是同一套语义。
 */

/** 一个待排序项：只要 id 与它依赖的 id 列表。 */
export interface SortableItem {
    id: string
    dependencies?: readonly string[]
}

/** 排序结果。 */
export interface SortResult<T extends SortableItem> {
    /** 拓扑序：被依赖者在前，依赖者在后。 */
    ordered: T[]
    /**
     * 被丢弃的项及原因。成环的、或依赖了「不存在且未在本次排序集合里」的项会落在这里
     * —— 与其让它们带着半成品状态启动，不如明确不加载并报因。
     */
    dropped: Array<{ item: T; reason: string }>
}

/**
 * 按依赖做拓扑排序（Kahn 算法）。
 *
 * 刻意**不**在发现缺失依赖时抛错，而是把它归入 `dropped` 并继续 —— 一个扩展的依赖没装，
 * 不应该让其它无关扩展都加载不了。缺失的判定有两种来源：
 *   1. 依赖的 id 根本不在本次集合里（未安装）；
 *   2. 依赖的项本身因成环被丢弃（级联丢弃）。
 *
 * @param items 全部候选（含依赖缺失的）
 */
export function topoSort<T extends SortableItem>(items: readonly T[]): SortResult<T> {
    const byId = new Map<string, T>()
    for (const item of items) {
        // 同 id 只保留先出现的那个；重复 id 由调用方在更外层报出。
        if (!byId.has(item.id)) byId.set(item.id, item)
    }

    const dropped: Array<{ item: T; reason: string }> = []
    const indegree = new Map<string, number>()
    /** 反向边：被依赖者 → 依赖它的人。 */
    const dependents = new Map<string, string[]>()

    // 先算出度（本项还差几个前置），并登记反向边。
    for (const item of byId.values()) {
        const deps = item.dependencies ?? []
        let missing: string | undefined
        for (const dep of deps) {
            if (!byId.has(dep)) {
                missing = dep
                break
            }
        }
        if (missing) {
            // 直接丢弃：连前置都没装，排进队列也没有意义。
            dropped.push({ item, reason: `缺少依赖扩展：${missing}` })
            indegree.set(item.id, Number.POSITIVE_INFINITY)
            continue
        }
        indegree.set(item.id, deps.length)
        for (const dep of deps) {
            const list = dependents.get(dep)
            if (list) list.push(item.id)
            else dependents.set(dep, [item.id])
        }
    }

    // 从入度为 0 的开始出队。保持输入顺序，让结果可预测（不依赖 Map 迭代的偶然性）。
    const queue: string[] = []
    for (const item of byId.values()) {
        if (indegree.get(item.id) === 0) queue.push(item.id)
    }

    const ordered: T[] = []
    const emitted = new Set<string>()
    while (queue.length > 0) {
        const id = queue.shift() as string
        const item = byId.get(id)
        if (!item || emitted.has(id)) continue
        emitted.add(id)
        ordered.push(item)
        for (const next of dependents.get(id) ?? []) {
            const deg = indegree.get(next)
            // 已被丢弃（缺失依赖）的项不再参与推进。
            if (deg === undefined || !Number.isFinite(deg)) continue
            const nd = deg - 1
            indegree.set(next, nd)
            if (nd === 0) queue.push(next)
        }
    }

    // 剩下的都是环上的（或依赖了环上项的）。逐层报出，并做一次级联说明。
    for (const item of byId.values()) {
        if (emitted.has(item.id)) continue
        if (indegree.get(item.id) === Number.POSITIVE_INFINITY) continue // 已在 dropped 里
        // 区分「自己在环里」与「被环上项拖住」，让提示可操作。
        const deps = item.dependencies ?? []
        const stuckInCycle = deps.filter((d) => !emitted.has(d) && byId.has(d))
        dropped.push({
            item,
            reason: stuckInCycle.length > 0
                ? `依赖链存在循环或依赖了未加载的扩展：${stuckInCycle.join(', ')}`
                : '依赖关系存在循环'
        })
    }

    return { ordered, dropped }
}

/**
 * 卸载顺序 = 加载顺序的逆序。
 *
 * 单独成函数是为了让「正序加载 / 逆序卸载」这条对称性在代码里显式可见 ——
 * 它与内核的 `runReady` / `runQuit` 是同一套语义，也满足「后建立的先拆」。
 */
export function reverseForUnload<T>(ordered: readonly T[]): T[] {
    return [...ordered].reverse()
}
