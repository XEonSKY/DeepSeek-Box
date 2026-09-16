import { spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { LogEntry } from '@shared/types'
import { IS_WIN, broadcast } from '../app/runtime'

/**
 * 日志环形缓冲 + 子进程登记表。
 *
 * 从 dsh.ts 抽出：这两件事都**不依赖 dsh 服务状态**，却被 dsh 链路的所有模块
 * （npmRunner / nodeenv / manage / dsh 自身）共用。留在 dsh.ts 里会让底层工具
 * （如 child.ts 的 runChild）为了登记子进程而反向依赖 dsh.ts，形成循环引用。
 */

const logBuf: LogEntry[] = []
const LOG_CAP = 5000

export function getLogHistory(): LogEntry[] {
    return logBuf.slice()
}

/** 追加一条日志并广播给渲染层（空内容直接忽略）。 */
export function pushLog(k: LogEntry['k'], s: string): void {
    if (!s) return
    logBuf.push({ k, s })
    if (logBuf.length > LOG_CAP) logBuf.splice(0, logBuf.length - LOG_CAP)
    broadcast('dsh:log', { k, s })
}

/**
 * Every child this process spawns (the watchdog node, and any in-flight npm)
 * is registered here so a real quit / force-exit can kill the whole batch —
 * not just the latest watchdog. This prevents orphaned node/npm processes from
 * piling up (e.g. an npm install that was still running when the app closed).
 */
const liveChildren = new Set<ChildProcess>()
export function rememberChild(child: ChildProcess): ChildProcess {
    liveChildren.add(child)
    const drop = (): void => {
        liveChildren.delete(child)
    }
    child.once('exit', drop)
    child.once('error', drop)
    return child
}

/** 结束整个进程树（Windows 用 taskkill /T，类 Unix 先杀进程组）。 */
export function killTree(pid: number): void {
    try {
        if (IS_WIN) spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
        else {
            try {
                process.kill(-pid, 'SIGTERM')
            } catch {
                process.kill(pid, 'SIGTERM')
            }
        }
    } catch {
        /* already gone */
    }
}

/** taskkill /T the tree of every still-registered child (best effort). */
export function killAllChildren(): void {
    for (const c of [...liveChildren]) {
        try {
            if (c.pid) killTree(c.pid)
        } catch {
            /* already gone */
        }
    }
}
