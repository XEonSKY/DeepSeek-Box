import path from 'node:path'
import { mergePatchEntryConfig } from './cordisPatch'

/**
 * 给 dsh 的 PTC（run_code）worker 指定一个**真正的 node 可执行文件**。
 *
 * 背景（详见 docs/zh/dev/run-code-worker-exit-diagnosis.md）：
 * 早期 Box 用 electron.exe 冒充 Node 跑 dsh，靠环境变量 `ELECTRON_RUN_AS_NODE=1`
 * 才进 Node 模式；而 dsh 的 PTC worker 启动时**会清空几乎全部环境变量**
 * （只留 PATH / PATHEXT / SYSTEMROOT / WINDIR / TEMP / TMP 六项），
 * 于是 worker 拿到 electron.exe 却丢了那个开关，被当成 GUI 程序启动、立刻退出，
 * 报 `Node process exited before completing (0)`。
 *
 * 「用 Electron 自带 Node」的能力已移除，dsh 一律由真 node 启动；这里再把
 * `nodeExecutable` 通过 dsh 的 patch 层显式写死一层，保证 worker 永远用真 node，
 * 不依赖任何环境变量。
 *
 * 本模块只放**纯逻辑**（挑哪个可执行文件、patch 文本怎么生成），
 * 读写文件 / 查设置的部分在 ptcNodeSync.ts。
 */

/** 合法的 Node 可执行文件候选（按优先级）。 */
export interface NodeCandidate {
    /** 来源标签，用于诊断文案。 */
    from: 'DSH_NODE' | 'runtime-system' | 'runtime-local' | 'deployed'
    /** 可执行文件绝对路径。 */
    exec: string
}

/**
 * 从候选里挑出交给 PTC worker 的那个。
 *
 * 候选由调用方按优先级排好，取第一个即可；空候选返回 null。
 * 纯函数：不读盘、不看环境。
 */
export function pickPtcNode(candidates: NodeCandidate[]): NodeCandidate | null {
    return candidates[0] ?? null
}

/**
 * 判断一个 `nodeExecutable` 值是否可用于 dsh 的 patch。
 *
 * dsh 侧会在构造时校验非空（index.js:806），并且要求 bootstrapPath 为绝对路径；
 * 这里只做我们能提前发现的那部分：非空 + 绝对路径。
 */
export function isValidNodeExecutable(value: string | null | undefined): value is string {
    if (typeof value !== 'string' || value.length === 0) return false
    return path.isAbsolute(value)
}

/**
 * 把 `nodeExecutable` 合并进 patch 文本（纯函数）。
 *
 * 为什么是「合并」而不是整文件重写：这些 patch 文件是**用户自己的**层，里面有他们的
 * 条目与注释。dsh 的 patch 语义是按 id 替换目标行的 config，所以我们只动 `ptc-runtime`
 * 这一行 —— 已有该行只 set `config.nodeExecutable`（同行的其它字段如 `timeoutMs` 保留），
 * 没有就追加，空文件 / 非序列则退化成只含这一条的 patch。
 *
 * 通用的 patch 文本处理在 `cordisPatch.ts`，这里只固定「改哪条、改哪个字段」。
 */
export function mergePtcNodePatch(text: string, exec: string): string {
    return mergePatchEntryConfig(text, 'ptc-runtime', { nodeExecutable: exec })
}
