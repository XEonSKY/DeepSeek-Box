/**
 * 可取消操作令牌：Node / npm / dsh 的安装（下载 + 解压 + 落盘）各自持有一个令牌，
 * 渲染层「取消」按钮经 IPC 调 `cancelActive()` 中止**当前所有**在途操作。
 *
 * 之所以用集合而不是单槽：node / npm 的部署入口之间没有互斥（见 ipc.ts 的
 * nodeenv:deploy / npmenv:update / npmenv:ensure），若只记最后一个令牌，
 * 先发的操作会失去取消能力 —— 「取消」只覆盖了一半路径。
 * 每个操作结束后由 `done()` 自行摘除，不会累积。
 */

const active = new Set<{ ctrl: AbortController }>()

export interface CancelToken {
    signal: AbortSignal
    /** 操作结束时调用；只清理属于自己的令牌，避免误清后来的操作。 */
    done(): void
}

/** 开始一个可取消操作并返回令牌。 */
export function beginCancelable(): CancelToken {
    const ctrl = new AbortController()
    const entry = { ctrl }
    active.add(entry)
    const token: CancelToken = {
        signal: ctrl.signal,
        done(): void {
            active.delete(entry)
        }
    }
    return token
}

/** 中止所有进行中的操作；没有进行中的操作时返回 false。 */
export function cancelActive(): boolean {
    if (active.size === 0) return false
    for (const entry of active) entry.ctrl.abort()
    return true
}

/** 已取消时的统一文案。 */
export const CANCELED_MESSAGE = '操作已取消'
