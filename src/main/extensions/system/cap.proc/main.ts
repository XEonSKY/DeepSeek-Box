import { runChild } from '../../../dsh/child'
import { provideActions } from '../../loader/capability'
import type { ExtContext } from '../../loader/ctx'

/**
 * 系统扩展 `cap.proc` —— 把子进程执行包装成能力。
 *
 * 内核侧唯一的子进程入口是 `dsh/child.ts` 的 `runChild`（spawn → 登记 → 收日志 →
 * 可取消 → 只 settle 一次）。扩展若自己 `child_process.spawn`，会绕开三件事：
 *
 *   1. `rememberChild` 登记 —— 退出时清不掉的孤儿进程；
 *   2. 统一的取消语义（AbortSignal → SIGKILL）；
 *   3. stderr 尾部收集（失败诊断）。
 *
 * 所以能力面只暴露「跑一条命令拿结果」，不暴露裸 spawn：写管道、拿句柄都不给，
 * 那样等于把内核好不容易收敛的进程管理又打开一个口子。
 */

/** 允许的动作。 */
const actions = {
    /**
     * 跑一条命令并等它结束。
     *
     * @returns 退出码、是否成功、stdout 全量、stderr 尾部
     */
    run: async (
        exec: string,
        argv: string[],
        options?: { cwd?: string; shell?: boolean; timeoutMs?: number }
    ): Promise<{ ok: boolean; code: number | null; canceled: boolean; stdout: string; stderrTail: string }> => {
        const lines: string[] = []
        const ctrl = new AbortController()
        let timer: ReturnType<typeof setTimeout> | null = null
        if (options?.timeoutMs && options.timeoutMs > 0) {
            timer = setTimeout(() => ctrl.abort(), options.timeoutMs)
        }
        try {
            const outcome = await runChild(
                exec,
                {
                    argv,
                    cwd: options?.cwd,
                    shell: options?.shell,
                    onStdoutLine: (line) => {
                        // 限制累积量：扩展跑一条 `--help` 之类的命令不该把内存撑起来。
                        if (lines.length < 5000) lines.push(line)
                    },
                    stderrTailLimit: 4000
                },
                ctrl.signal
            )
            return {
                ok: outcome.ok,
                code: outcome.code,
                canceled: outcome.canceled,
                stdout: lines.join('\n'),
                stderrTail: outcome.stderrTail
            }
        } finally {
            if (timer) clearTimeout(timer)
        }
    }
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'proc', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info('已提供能力 proc（动作：run）')
}
