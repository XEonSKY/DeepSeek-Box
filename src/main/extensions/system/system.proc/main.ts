import { runProc } from '../../../dsh/proc'
import { provideActions } from '../../loader/capability'
import type { ExtContext } from '../../loader/ctx'

/**
 * 系统扩展 `system.proc` —— 把子进程执行包装成能力。
 *
 * 实现落在内核 `dsh/proc.ts` 的 `runProc`（内核自己跑 7z 之类也用同一份），
 * 本扩展只是把它**转发**到能力面。之所以这样分：
 *
 *  - 内核侧唯一的子进程入口是 `dsh/child.ts` 的 `runChild`（spawn → 登记 → 收日志 →
 *    可取消 → 只 settle 一次）。扩展若自己 `child_process.spawn`，会绕开三件事：
 *    `rememberChild` 登记（退出时清不掉的孤儿进程）、统一的取消语义、stderr 尾部收集；
 *  - 内核模块（如 `main/zip/` 跑 7z 命令行）**不该经能力槽**触达 ——
 *    那会让内核依赖一个可被用户停用的东西，方向也反了（内核 → 扩展 → 内核）。
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
    run: (exec: string, argv: string[], options?: { cwd?: string; shell?: boolean; timeoutMs?: number }) =>
        runProc(exec, argv, options)
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'proc', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info('capability provided: proc (actions: run)')
}
