import { computed, readonly, ref } from 'vue'
import type { OperationKind, OperationProgress } from '@shared/types'

/**
 * 「正在进行的操作」在渲染层的**唯一**状态源。
 *
 * 为什么必须共享：进度此前是各个面板自己 `window.api.on(...)` 订阅、存进自己的 `ref`。
 * 面板一卸载（切到设置里的别的子页、或从初始化页跳走）订阅和状态一起没了，
 * 而主进程里的操作还在跑 —— 切回来只剩空进度条。现在改成：
 *
 *  1. 应用启动时订阅**一次**全部进度事件（{@link startOperationTracking}）；
 *  2. 任何面板随时读同一份状态（{@link useOperation}）；
 *  3. 面板重新挂载时拉一次 `GET /operations` 快照（{@link refreshOperations}），
 *     把「我离开的这段时间里已经开始 / 还在跑」的操作补回来。
 *
 * 状态由**主进程**清空（操作结束即从快照消失），所以这里不需要猜什么时候结束 ——
 * 但事件流里没有「结束」信号，因此面板重新挂载 / 操作返回后都要 `refreshOperations()`。
 */

/** 进行中的操作，按 kind 索引。 */
const running = ref<Partial<Record<OperationKind, OperationProgress>>>({})

/** 是否已启用一次订阅（幂等，多窗口 / 组件重复挂载也只订阅一次）。 */
let started = false
/** 已注册的取消订阅函数。 */
const offs: (() => void)[] = []

/** 把一条进度并入状态（同一 kind 只保留最新一条）。 */
function absorb(p: OperationProgress): void {
    running.value = { ...running.value, [p.kind]: p }
}

/** 用一个快照整体覆盖状态：快照里没有的 kind 视为已结束。 */
function replace(snapshot: OperationProgress[]): void {
    const next: Partial<Record<OperationKind, OperationProgress>> = {}
    for (const p of snapshot) next[p.kind] = p
    running.value = next
}

/**
 * 重新取一次主进程的进行中操作快照。
 *
 * 面板在 `onMounted` 调它（补回离开期间开始的操作），操作 Promise 返回后也调它
 * （把刚结束的操作从状态里摘掉 —— 事件流不含结束信号）。
 */
export async function refreshOperations(): Promise<void> {
    try {
        replace(await window.api.get('/operations'))
    } catch {
        // 主进程不可用（退出中）时保持现状，不让设置页因为一次探测失败白屏。
    }
}

/** 应用级订阅：在 `main.ts` 里调一次即可（重复调用无副作用）。 */
export function startOperationTracking(): void {
    if (started) return
    started = true
    // 三条进度频道都必须订阅 —— 载荷里带 kind，用它归位；不再靠频道名区分种类。
    for (const channel of ['nodeenv:deploy-progress', 'npmenv:progress', 'pnmenv:progress'] as const) {
        offs.push(window.api.on(channel, absorb))
    }
    void refreshOperations()
}

/** 供测试 / HMR 复位订阅（正常流程不需要调用）。 */
export function stopOperationTracking(): void {
    for (const off of offs.splice(0)) off()
    started = false
    running.value = {}
}

/**
 * 取某个种类的进行中操作（没有则 null）。
 *
 * `busy` 一并返回：它比 `op !== null` 更常用 —— 按钮的 loading、表单的禁用都靠它，
 * 而进度条只在真的有进度时显示。取消后主进程会清空，`busy` 随之变回 false
 * （但发起方自己的 Promise 通常还没返回，所以调用方自己的 in-flight 标记仍要保留）。
 */
export function useOperation(kind: OperationKind) {
    const op = computed<OperationProgress | null>(() => running.value[kind] ?? null)
    const busy = computed(() => op.value !== null)
    return { op, busy }
}

/** 只读快照（调试 / 聚合展示用）。 */
export const operationsState = readonly(running)
