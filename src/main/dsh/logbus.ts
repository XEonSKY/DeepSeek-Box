import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { LogEntry } from '@shared/types'
import { IS_WIN, broadcast } from '../kernel/runtime'

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

/**
 * 结束整个进程树（Windows 用 taskkill /T，类 Unix 先杀进程组）。
 *
 * **必须异步**：Windows 上 `taskkill /T` 经常要几百毫秒才返回（要遍历并终止子孙进程），
 * 而这是主进程 —— 同步等待会把界面冻在那几百毫秒里，正是「一些操作时整个程序会卡住」的一部分。
 * 改用 `spawn` 后主进程立即返回，回收动作在后台完成。
 *
 * 立即 `unref()`：不让这个短命进程拖住应用退出（关窗时不应该为了一次 taskkill 卡住）。
 * 返回的 Promise 只在**确实需要等它杀完**的场合 await（例如紧接着要删除被占用的目录），
 * 大量调用点（退出收尾、进程 exit 钩子）直接忽略即可 —— 忽略也只是让回收并发进行。
 *
 * 杀不掉不算错误：进程可能已经自行退出，或本就没有权限，这两种情况都不影响调用方继续。
 */
export function killTree(pid: number): Promise<void> {
    if (IS_WIN) {
        return new Promise<void>((resolve) => {
            try {
                const child = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
                child.unref()
                child.once('exit', () => resolve())
                child.once('error', () => resolve())
            } catch {
                resolve() // spawn 本身失败（taskkill 缺失）：当作已经没了
            }
        })
    }
    return new Promise<void>((resolve) => {
        try {
            process.kill(-pid, 'SIGTERM')
        } catch {
            try {
                process.kill(pid, 'SIGTERM')
            } catch {
                /* already gone */
            }
        }
        resolve()
    })
}

/** taskkill /T the tree of every still-registered child (best effort). */
export function killAllChildren(): void {
    for (const c of [...liveChildren]) {
        try {
            if (c.pid) void killTree(c.pid)
        } catch {
            /* already gone */
        }
    }
}
