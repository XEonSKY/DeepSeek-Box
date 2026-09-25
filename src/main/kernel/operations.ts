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
 *
 * 本文件同时收纳「可取消令牌」（同类：在途操作的机制），以及把长耗时操作包成
 * 「可被任意页面重新取回」的 `trackedOperation`（见文件末尾）。三者都属于 kernel 机制，
 * 因此各功能模块共用它们，无需互相 import。
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

// ---------------------------------------------------------------------------
// 可取消操作令牌（与上面的进度注册表同属「在途操作」机制，故并入 kernel）
// ---------------------------------------------------------------------------

/**
 * Node / npm / pnpm / dsh 的安装（下载 + 解压 + 落盘）各自持有一个令牌，
 * 渲染层「取消」按钮经 IPC 调 `cancelActive()` 中止**当前所有**在途操作。
 *
 * 之所以用集合而不是单槽：node / npm / pnpm 的部署入口之间没有互斥（见 modules/env.ts
 * 的 `/node/deploy`、`/npm/update`、`/npm/ensure`），若只记最后一个令牌，先发的操作会
 * 失去取消能力 —— 「取消」只覆盖了一半路径。每个操作结束后由 `done()` 自行摘除。
 */
const activeCancels = new Set<{ ctrl: AbortController }>()

export interface CancelToken {
    signal: AbortSignal
    /** 操作结束时调用；只清理属于自己的令牌，避免误清后来的操作。 */
    done(): void
}

/** 开始一个可取消操作并返回令牌。 */
export function beginCancelable(): CancelToken {
    const ctrl = new AbortController()
    const entry = { ctrl }
    activeCancels.add(entry)
    const token: CancelToken = {
        signal: ctrl.signal,
        done(): void {
            activeCancels.delete(entry)
        }
    }
    return token
}

/** 中止所有进行中的操作；没有进行中的操作时返回 false。 */
export function cancelActive(): boolean {
    if (activeCancels.size === 0) return false
    for (const entry of activeCancels) entry.ctrl.abort()
    return true
}

/** 已取消时的统一文案。 */
export const CANCELED_MESSAGE = '操作已取消'

// ---------------------------------------------------------------------------
// 可持久化的「长耗时操作」包装（进度注册表 + 广播节流的统一入口）
// ---------------------------------------------------------------------------

/** 各操作种类对应的广播频道。 */
const CHANNEL_OF: Record<OperationKind, string> = {
    'node': 'nodeenv:deploy-progress',
    'npm': 'npmenv:progress',
    'pnpm': 'pnmenv:progress',
    'dsh-plugin': 'pnmenv:progress'
}

/** 安装进度统一整形：解压阶段百分比无意义，仅保留 phase 供前端切动画。 */
function tidyProgress(p: NodeDeployProgress): NodeDeployProgress {
    return {
        phase: p.phase,
        percent: Math.max(0, Math.min(100, Math.round(p.percent))),
        downloaded: p.downloaded,
        total: p.total,
        speed: p.speed
    }
}

/**
 * 把「下载 / 安装」这类长耗时操作包成**可被任意页面重新取回**的操作。
 *
 * 解决的正是这批 bug 的根因，所以放在 kernel（各模块共用，不必互相 import）：
 *
 *  1. 在进度注册表里登记 / 更新 / 结束 → 切页回来的面板能靠 `GET /operations` 快照
 *     把进度找回来（此前进度只活在面板 ref 里，卸载即丢）；
 *  2. 按注册表的节流判定决定是否真的广播 —— 下载是每个数据块回调一次，全转发会给
 *     渲染层灌几千条 IPC；
 *  3. 每条进度都带 `kind`，渲染层据此区分，npm / pnpm 不再串台。
 *
 * `emit` 由调用方注入（kernel 不认识 Electron，不能直接 broadcast），因此本模块保持纯逻辑、可单测。
 */
export async function trackedOperation<T>(
    kind: OperationKind,
    emit: (channel: string, payload: OperationProgress) => void,
    run: (onProgress: (p: NodeDeployProgress) => void) => Promise<T>
): Promise<T> {
    beginOperation(kind)
    try {
        return await run((p) => {
            if (pushProgress(kind, tidyProgress(p))) {
                const current = currentProgress(kind)
                if (current) emit(CHANNEL_OF[kind], current)
            }
        })
    } finally {
        // 成功 / 失败 / 取消都要清空：否则快照里会永远留着一条「假的进行中」。
        endOperation(kind)
    }
}
