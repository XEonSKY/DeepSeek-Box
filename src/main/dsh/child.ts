import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { rememberChild } from './logbus'

/**
 * 跑子进程的共同流程：spawn → 登记 → 收日志 → 可取消 → 只 settle 一次。
 *
 * 此前这段模板在三个地方各写了一遍（npm / 工具的 runTool、Node 压缩包解压、
 * npm tarball 解压）：settle 标志、AbortSignal 监听、abort 时 SIGKILL、
 * rememberChild 登记，任何一处漏了都会留下孤儿进程或双次 resolve。收敛到这里后，
 * 各调用点只保留「跑什么命令 + 日志怎么记」的差异。
 */

export interface ChildOutcome {
    /** 退出码为 0 且未被取消。 */
    ok: boolean
    /** 退出码；被信号杀死或 spawn 失败时为 null。 */
    code: number | null
    /** 是否因 AbortSignal 被取消（此时子进程已被强杀）。 */
    canceled: boolean
    /** stderr 尾部（设置了 stderrTailLimit 时才有内容，用于失败诊断）。 */
    stderrTail: string
}

export interface RunChildOptions {
    argv: string[]
    cwd?: string
    env?: NodeJS.ProcessEnv
    /** Windows 上运行 .cmd/.bat 需要经 shell。 */
    shell?: boolean
    /** stdout 每行回调（内部用 readline 切行）。 */
    onStdoutLine?: (line: string) => void
    /** stderr 原始分片回调。 */
    onStderr?: (chunk: string) => void
    /** 需要 stderr 尾部时给一个字符上限（如 3000）。 */
    stderrTailLimit?: number
}

export function runChild(exec: string, opts: RunChildOptions, signal?: AbortSignal): Promise<ChildOutcome> {
    return new Promise((resolve) => {
        const child = rememberChild(
            spawn(exec, opts.argv, {
                shell: opts.shell,
                windowsHide: true,
                cwd: opts.cwd,
                env: opts.env ?? process.env,
                stdio: ['ignore', 'pipe', 'pipe']
            })
        )
        let settled = false
        let canceled = false
        let stderrTail = ''
        const limit = opts.stderrTailLimit

        const finish = (code: number | null): void => {
            if (settled) return
            settled = true
            signal?.removeEventListener('abort', onAbort)
            resolve({ ok: !canceled && code === 0, code, canceled, stderrTail })
        }
        const onAbort = (): void => {
            canceled = true
            try {
                child.kill('SIGKILL')
            } catch {
                /* 已经退出 */
            }
            finish(null)
        }

        if (signal) {
            if (signal.aborted) {
                onAbort()
                return
            }
            signal.addEventListener('abort', onAbort, { once: true })
        }

        if (opts.onStdoutLine) createInterface({ input: child.stdout! }).on('line', opts.onStdoutLine)
        if (opts.onStderr) {
            child.stderr!.on('data', (d: Buffer) => {
                const s = d.toString()
                if (limit) stderrTail = (stderrTail + s).slice(-limit)
                opts.onStderr!(s)
            })
        } else if (limit) {
            child.stderr!.on('data', (d: Buffer) => {
                stderrTail = (stderrTail + d.toString()).slice(-limit)
            })
        }
        child.on('error', () => finish(null))
        child.on('exit', (code) => finish(code))
    })
}

/**
 * 静默跑一次命令取版本号（`node --version` / `npm --version`）：不写日志视图，
 * 拿不到或非 0 退出返回 null。
 *
 * 环境页每次进入都要问版本，绝不能走 runTool —— 那会把输出推进终端日志刷屏。
 * 这里也刻意不 rememberChild：探针是毫秒级短命进程，不需要纳入退出清理。
 */
export function probeVersion(exec: string, argv: string[] = ['--version'], env?: NodeJS.ProcessEnv, shell = false): Promise<string | null> {
    return new Promise((resolve) => {
        let out = ''
        try {
            const p = spawn(exec, argv, { shell, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: env ?? process.env })
            p.stdout!.on('data', (d: Buffer) => {
                // 只认版本号这种短输出，避免异常输出把内存撑起来
                if (out.length < 64) out += d.toString()
            })
            p.on('error', () => resolve(null))
            p.on('exit', (code) => resolve(code === 0 && out.trim() ? out.trim() : null))
        } catch {
            resolve(null)
        }
    })
}
