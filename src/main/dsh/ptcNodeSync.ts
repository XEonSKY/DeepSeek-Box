import fs from 'node:fs'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { NodeRuntimeKind } from '@shared/types'
import { findSystemNode, localNodeExecPath } from './tools'
import { homePatchFile } from './dshHome'
import { isValidNodeExecutable, mergePtcNodePatch, pickPtcNode } from './ptcNode'
import type { NodeCandidate } from './ptcNode'
import { logger } from '../kernel/logger'

const log = logger('[Manager]')

/**
 * 把 `nodeExecutable` 写进 dsh 的 **home 级 patch 层**，修复 PTC（run_code）worker 崩溃。
 *
 * 为什么是 home 级 patch（`$DSH_HOME/cordis.patch.yml`）而不是改 profile：
 * 该层由 dsh 应用在**每个 profile 之上**（profile-boot 里文档化），
 * 因此对 web / headless / 任何自定义 profile 一并生效，且不碰用户的 profile 文件。
 *
 * 为什么不写 profile 的 `cordis.patch.yml`：nodeExecutable 是「本机装在哪」这种
 * 机器级事实，跟用户在哪个 profile 里工作无关；而且 home 层优先级更高，能压过
 * 任何 profile 层里被带过来的旧路径。
 *
 * 诊断背景见 ptcNode.ts 头注释：dsh 的 PTC worker 启动时会清空几乎全部环境变量，
 * electron.exe 冒充 Node 的方案因此崩溃；现在 dsh 一律由真 node 启动。
 */

/** 一个真正存在的文件才算可用候选。 */
function exists(p: string | null | undefined): p is string {
    return !!p && fs.existsSync(p)
}

/**
 * 按优先级收集可用于 PTC worker 的 Node。
 *
 * 顺序即优先级：
 *  1. `DSH_NODE` —— 用户显式指定，最高优先级（与 tools.ts 的语义一致）；
 *  2. 当前 nodeRuntime 档位解析出的 Node（system / local）；
 *  3. 配置目录里已部署的任意 Node（即便当前档位是 system，它也能跑 worker）。
 *
 * 没有可用的真 Node 时返回空列表：此时 dsh 本身也起不来（nodeRuntimeFor 会抛错）。
 */
export function collectCandidates(runtimeKind: NodeRuntimeKind): NodeCandidate[] {
    const out: NodeCandidate[] = []

    const override = process.env.DSH_NODE
    if (exists(override)) out.push({ from: 'DSH_NODE', exec: override })

    if (runtimeKind === 'system') {
        const p = findSystemNode()
        if (exists(p)) out.push({ from: 'runtime-system', exec: p })
    } else if (runtimeKind === 'local') {
        const p = localNodeExecPath()
        if (exists(p)) out.push({ from: 'runtime-local', exec: p })
    }

    // 即便当前档位是 system，只要配置目录里部署过 Node，也应视为可用候选。
    const deployed = localNodeExecPath()
    if (exists(deployed)) out.push({ from: 'deployed', exec: deployed })

    return out
}

/** 去重：同一路径只保留优先级最高的那次出现。 */
function dedupe(candidates: NodeCandidate[]): NodeCandidate[] {
    const seen = new Set<string>()
    const out: NodeCandidate[] = []
    for (const c of candidates) {
        const key = path.normalize(c.exec).toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(c)
    }
    return out
}

/** 解析结果：选中的可执行文件（null = 没找到可用的真 Node）。 */
export interface PtcNodeResolution {
    exec: string | null
    from: NodeCandidate['from'] | null
}

/** 纯解析：给定档位，算出该写哪个可执行文件给 PTC。 */
export function resolvePtcNode(runtimeKind: NodeRuntimeKind): PtcNodeResolution {
    const picked = pickPtcNode(dedupe(collectCandidates(runtimeKind)))
    if (!picked || !isValidNodeExecutable(picked.exec)) {
        return { exec: null, from: null }
    }
    return { exec: picked.exec, from: picked.from }
}

/** 同步结果，供调用方打日志 / 上报。 */
export interface PtcNodeSyncResult extends PtcNodeResolution {
    /** 是否真的写了文件（内容没变时跳过写）。 */
    written: boolean
}

/**
 * 把解析结果合并进 home 级 patch 文件（幂等：内容一致就不写，避免触发 dsh 的文件监听）。
 *
 * 两条底线：
 *  1. `$DSH_HOME/cordis.patch.yml` 是用户自己的 patch 层 —— 只合并 `ptc-runtime`
 *     这一行，其余条目 / 注释原样保留（见 `mergePtcNodePatch`）；
 *  2. 没有可用真 node 时不落盘（此时 dsh 本身也起不来）。
 *
 * 失败不抛：这是**尽力而为的修复**，坏了不该把 dsh 启动流程带崩。
 */
export function syncPtcNode(runtimeKind: NodeRuntimeKind): PtcNodeSyncResult {
    const res = resolvePtcNode(runtimeKind)
    if (!res.exec) return { ...res, written: false }

    const file = homePatchFile()
    try {
        let cur = ''
        try {
            cur = fs.readFileSync(file, 'utf8')
        } catch {
            /* 还没有该文件 */
        }
        const next = mergePtcNodePatch(cur, res.exec)
        if (cur === next) return { ...res, written: false }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        writeFileAtomic.sync(file, next, 'utf8')
        return { ...res, written: true }
    } catch (err) {
        log.error({ err }, 'failed to write dsh home patch (ptc nodeExecutable)')
        return { ...res, written: false }
    }
}

/** 供日志/诊断：一句话描述当前 PTC node 的解析结果。 */
export function describePtcNode(res: PtcNodeResolution): string {
    if (!res.exec) return 'PTC node: no usable executable found'
    return `PTC node: ${res.exec} (from=${res.from})`
}
