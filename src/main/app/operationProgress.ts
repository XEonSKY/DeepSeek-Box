/**
 * 「正在进行中的操作」注册表 —— **纯逻辑**，不 import electron，便于单测。
 *
 * 解决两个真实问题：
 *
 * 1. **切页回来看不到进度**：进度此前是「渲染层的面板组件自己订阅广播、把状态存在自己的
 *    ref 里」。面板一卸载（切到别的设置子页 / 从初始化页跳走）状态就没了，而主进程里的
 *    操作还在跑 —— 切回来只能看到空进度条。所以主进程要**记住**进行中的操作，让任何页面
 *    随时能重新取到当前状态（`GET /operations` 快照），并在结束时**清空**。
 * 2. **同一个通道上串台**：npm 与 pnpm 的下载都用 `npmenv:progress` 广播，渲染层两个订阅
 *    各自收到同一条消息 —— 下载 pnpm 会同时点亮 npm 的进度条。所以每条进度都带上 `kind`。
 *
 * 另外这里做**节流**：下载进度是每个数据块回调一次，直接转发会给渲染层灌几千条 IPC 消息
 * （界面发卡的来源之一）。同一操作在 `MIN_INTERVAL_MS` 内的重复进度只保留最后一条，
 * 但**阶段变化**（下载 → 解压）与最后一次进度一定送出，否则进度条会停在半路。
 */

import type { NodeDeployProgress, OperationKind, OperationProgress } from '@shared/types'

/** 同一操作两次进度广播之间的最小间隔（毫秒）。 */
export const MIN_INTERVAL_MS = 80

interface Tracked {
    latest: OperationProgress
    /** 上一次真正广播的时间；0 表示还没广播过。 */
    emittedAt: number
    /** 上一次广播出去的阶段，用于「阶段变化必须放行」。 */
    emittedPhase: OperationProgress['phase'] | null
    /** 已广播的进度值，避免同一百分比重复广播。 */
    emittedPercent: number
}

const running = new Map<OperationKind, Tracked>()

/** 取快照（进行中的操作，按开始时间排序）。 */
export function operationsSnapshot(): OperationProgress[] {
    return [...running.values()].map((t) => t.latest).sort((a, b) => a.startedAt - b.startedAt)
}

/** 某个操作是否正在进行。 */
export function isOperationRunning(kind: OperationKind): boolean {
    return running.has(kind)
}

/**
 * 开始一个操作（清掉同 kind 的旧记录）。
 *
 * 同一个 kind 不可能真正并行（主进程各链路都自己串行化），若旧记录还在，说明上一次的
 * `finally` 没走到 —— 直接覆盖，避免界面上永远留着一条「假的进行中」。
 */
export function beginOperation(kind: OperationKind, now = Date.now()): OperationProgress {
    const op: OperationProgress = { kind, phase: 'download', percent: 0, downloaded: 0, total: 0, speed: 0, startedAt: now }
    running.set(kind, { latest: op, emittedAt: 0, emittedPhase: null, emittedPercent: -1 })
    return op
}

/**
 * 记录一条进度，并回答**这次是否需要广播**。
 *
 * @returns true 表示调用方应当把 `latest` 广播出去。
 */
export function pushProgress(kind: OperationKind, p: NodeDeployProgress, now = Date.now()): boolean {
    const tracked = running.get(kind)
    if (!tracked) return false // 没登记过的进度一律丢弃：避免半路的残留进度点亮进度条
    tracked.latest = { kind, ...p, startedAt: tracked.latest.startedAt }
    // 阶段变化 / 首次 / 进度值前进并且过了节流窗口 → 放行。
    const phaseChanged = tracked.emittedPhase !== p.phase
    const percentAdvanced = p.percent !== tracked.emittedPercent
    const cooled = now - tracked.emittedAt >= MIN_INTERVAL_MS
    if (!phaseChanged && !cooled) return false
    if (!phaseChanged && !percentAdvanced && tracked.emittedPhase !== null) return false
    tracked.emittedAt = now
    tracked.emittedPhase = p.phase
    tracked.emittedPercent = p.percent
    return true
}

/** 取当前最新进度（广播用；没有则 null）。 */
export function currentProgress(kind: OperationKind): OperationProgress | null {
    return running.get(kind)?.latest ?? null
}

/** 结束一个操作（成功 / 失败 / 取消都走这里），返回是否真的清掉了一条记录。 */
export function endOperation(kind: OperationKind): boolean {
    return running.delete(kind)
}

/** 清空全部记录（测试用）。 */
export function resetOperations(): void {
    running.clear()
}
