import { runChild } from './child'

/**
 * 内核侧的**子进程执行**：跑一条命令并等它结束（带超时与输出收集）。
 *
 * ## 为什么单独抽出来
 *
 * 这个形状最早只出现在系统能力 `proc` 里（`main/extensions/system/system.proc/main.ts`），
 * 于是「内核自己要跑一个子进程」时面临两个都不好的选择：要么经能力槽绕一圈
 * （内核 → 能力 → 扩展 → 内核，方向反了），要么再写一份 spawn 包装
 * （绕开 `rememberChild` 登记 / 统一取消 / stderr 尾部收集 —— 那三件事恰恰是
 * `dsh/child.ts` 好不容易收敛起来的）。
 *
 * 现在它落在内核：`system.proc` 变成它的**转发**（能力面只多一层参数校验），
 * 内核模块（如 `main/zip/` 跑 7z）直接用 —— 两条路径共用同一份实现，行为不可能分叉。
 *
 * 只有「跑一条命令拿结果」这一种形态，刻意不给写管道 / 拿句柄的接口：
 * 那等于把进程管理又打开一个口子。
 */

/** 一次子进程执行的结果。 */
export interface ProcResult {
    ok: boolean
    code: number | null
    canceled: boolean
    /** stdout 全量（按行拼接）。 */
    stdout: string
    /** stderr 尾部（受 `stderrTailLimit` 限制）。 */
    stderrTail: string
}

/** 执行选项。 */
export interface RunProcOptions {
    cwd?: string
    shell?: boolean
    /** 超时毫秒数；到时中止子进程（`canceled` 为 true）。 */
    timeoutMs?: number
}

/** stdout 累积行数上限：跑一条 `--help` 之类的命令不该把内存撑起来。 */
const MAX_STDOUT_LINES = 5000
/** stderr 尾部字符上限（诊断够用即可）。 */
const STDERR_TAIL_LIMIT = 4000

/**
 * 跑一条命令并等它结束。
 *
 * @returns 退出码、是否成功、stdout 全量、stderr 尾部
 */
export async function runProc(exec: string, argv: string[], options?: RunProcOptions): Promise<ProcResult> {
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
                    if (lines.length < MAX_STDOUT_LINES) lines.push(line)
                },
                stderrTailLimit: STDERR_TAIL_LIMIT
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
