import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ConfigMigrationPlan } from '@shared/types'
import writeFileAtomic from 'write-file-atomic'
import { logger } from '../kernel/logger'

const log = logger('[Manager]')

/**
 * 配置目录迁移：计划持久化 + 目录树逐项搬迁（支持取消回滚）。
 *
 * 迁移安排在重启后的引导阶段：先把旧目录内容搬到新目录，成功后才把“当前配置目录”
 * 指向新位置。搬迁优先整目录 rename（同盘近乎瞬时），跨盘或目标已存在时退回逐文件
 * 移动（copy + unlink），并记录搬迁日志，取消时逆序搬回。
 *
 * 搬迁过程按时间片让出事件循环，好让主进程把进度事件送出去、渲染层能实时画出
 * 进度条与当前文件。
 */

/** 迁移计划文件（放 userData，与 configDir 解耦，保证先于 settings.json 可读）。 */
export function migrationPlanFile(): string {
    return path.join(app.getPath('userData'), 'config-migration.json')
}

/** 读取迁移计划；文件不存在 / 损坏 / 非法时返回 null。 */
export function readMigrationPlan(): ConfigMigrationPlan | null {
    try {
        const raw = JSON.parse(fs.readFileSync(migrationPlanFile(), 'utf8')) as Partial<ConfigMigrationPlan>
        const from = typeof raw?.from === 'string' ? raw.from : ''
        const to = typeof raw?.to === 'string' ? raw.to : ''
        if (from && to && from !== to) return { from, to, override: raw.override === true }
    } catch {
        /* 不存在或不可读 */
    }
    return null
}

/** 写入迁移计划（原子写交给 write-file-atomic）。 */
export function writeMigrationPlan(plan: ConfigMigrationPlan): void {
    try {
        const file = migrationPlanFile()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        writeFileAtomic.sync(file, JSON.stringify(plan, null, 2), 'utf8')
    } catch (err) {
        log.error({ err }, 'failed to persist config migration plan')
    }
}

/** 清除迁移计划（不存在时静默）。 */
export function clearMigrationPlan(): void {
    try {
        fs.unlinkSync(migrationPlanFile())
    } catch {
        /* 本就不存在 */
    }
}

/** 目录树扫描结果：总文件数 + 每个目录的递归文件数（整目录 rename 时按此推进度）。 */
export interface TreeScan {
    total: number
    dirCounts: Map<string, number>
}

/**
 * 递归统计 root 下的文件数；目录记入 dirCounts，符号链接按 1 个叶子计。
 *
 * **为什么是 async**：配置目录里带着 dsh / npm 的安装目录，动辄几万个小文件。同步递归
 * 会把主进程**独占地**占住几百毫秒到几秒，期间界面完全没响应 —— 正是「一些操作时整个
 * 程序会卡住」的成因之一。改成 promise 版后每进一个目录就让出事件循环一次
 *（`setImmediate`），IPC 与界面动画都能继续跑。
 */
export async function scanTree(root: string): Promise<TreeScan> {
    const dirCounts = new Map<string, number>()
    const count = async (p: string): Promise<number> => {
        let st: fs.Stats
        try {
            st = await fs.promises.lstat(p)
        } catch {
            return 0
        }
        if (!st.isDirectory()) return 1
        let names: string[]
        try {
            names = await fs.promises.readdir(p)
        } catch {
            return 0
        }
        let n = 0
        for (const name of names) n += await count(path.join(p, name))
        dirCounts.set(p, n)
        // 每处理完一个目录让出一次事件循环，避免深层大目录一次性霸占主线程。
        await new Promise<void>((resolve) => setImmediate(resolve))
        return n
    }
    return { total: await count(root), dirCounts }
}

/** 单条搬迁记录：整目录或单文件，回滚时逆序搬回。 */
interface MoveRecord {
    src: string
    dst: string
}

/** 迁移过程中的回调。 */
export interface MigrateHooks {
    /** 预扫描结果，提供整目录搬迁时的文件数。 */
    scan: TreeScan
    /** 每处理完一项（current 及其包含的文件数 n）回调一次，用于推进度。 */
    onAdvance: (current: string, n: number) => void
    /** 返回 true 时尽快停止后续搬迁（已搬内容由调用方回滚）。 */
    shouldStop: () => boolean
}

/** 迁移结果：搬迁日志 + 是否被中断。 */
export interface MigrateResult {
    journal: MoveRecord[]
    stopped: boolean
}

/** 让出事件循环的时间片阈值（毫秒）。 */
const YIELD_MS = 24

/** 到点就让出一次事件循环，好让进度事件真正送达渲染层。 */
async function yieldIfDue(state: { last: number }): Promise<void> {
    const now = Date.now()
    if (now - state.last < YIELD_MS) return
    state.last = now
    await new Promise<void>((resolve) => setImmediate(resolve))
}

/** 确保文件父目录存在（异步：大目录树上同步建目录会卡主进程）。 */
async function ensureParent(file: string): Promise<void> {
    try {
        await fs.promises.mkdir(path.dirname(file), { recursive: true })
    } catch {
        /* 交由后续写入报错 */
    }
}

/** 把 source 整体搬到 target；同盘用 rename，跨盘退回复制 + 删除，并记入 journal。 */
async function moveEntry(src: string, dst: string, journal: MoveRecord[], state: { last: number }): Promise<void> {
    await ensureParent(dst)
    try {
        await fs.promises.rename(src, dst)
        journal.push({ src, dst })
        return
    } catch {
        /* 跨盘或目标被占用：回退到复制 */
    }
    const st = await fs.promises.lstat(src)
    if (st.isDirectory()) {
        await fs.promises.mkdir(dst, { recursive: true })
        for (const name of await fs.promises.readdir(src)) {
            await moveEntry(path.join(src, name), path.join(dst, name), journal, state)
        }
        try {
            await fs.promises.rmdir(src)
        } catch {
            /* 非空或占用则保留 */
        }
        return
    }
    if (st.isSymbolicLink()) {
        await fs.promises.symlink(await fs.promises.readlink(src), dst)
        await fs.promises.unlink(src)
    } else {
        await fs.promises.copyFile(src, dst)
        await fs.promises.unlink(src)
    }
    journal.push({ src, dst })
}

/** 递归把 from 的内容并入 to：目标已有同名项时保留目标、丢弃源。 */
async function mergeInto(from: string, to: string, hooks: MigrateHooks, journal: MoveRecord[], state: { last: number }): Promise<void> {
    if (hooks.shouldStop()) return
    let names: string[]
    try {
        names = await fs.promises.readdir(from)
    } catch {
        return
    }
    for (const name of names) {
        if (hooks.shouldStop()) return
        const src = path.join(from, name)
        const dst = path.join(to, name)
        if (!(await pathExists(dst))) {
            try {
                await moveEntry(src, dst, journal, state)
                hooks.onAdvance(src, Math.max(1, hooks.scan.dirCounts.get(src) ?? 1))
                await yieldIfDue(state)
                continue
            } catch (err) {
                log.error({ err, src }, 'failed to move')
            }
        }
        let st: fs.Stats
        try {
            st = await fs.promises.lstat(src)
        } catch {
            continue
        }
        if (st.isDirectory()) {
            try {
                await fs.promises.mkdir(dst, { recursive: true })
            } catch {
                /* ignore */
            }
            await mergeInto(src, dst, hooks, journal, state)
        } else {
            // 只有目标确实存在时才丢弃源：moveEntry 失败（如文件被占用）时目标可能并不存在，
            // 此时删源会把唯一一份拷贝也弄丢。
            hooks.onAdvance(src, 1)
            if (!(await pathExists(dst))) continue
            try {
                await fs.promises.unlink(src)
            } catch {
                /* 删除失败（被占用）则保留，后续人工处理 */
            }
        }
    }
    try {
        if ((await fs.promises.readdir(from)).length === 0) await fs.promises.rmdir(from)
    } catch {
        /* 非空或占用则保留 */
    }
}

/** 异步判断路径是否存在（`fs.promises.access` 无 exists 版）。 */
async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.promises.access(p)
        return true
    } catch {
        return false
    }
}

/** 执行搬迁：尽量跳过失败项，不抛出异常。 */
export async function migrateTree(plan: ConfigMigrationPlan, hooks: MigrateHooks): Promise<MigrateResult> {
    const journal: MoveRecord[] = []
    try {
        await fs.promises.mkdir(plan.to, { recursive: true })
    } catch (err) {
        log.error({ err }, 'failed to create target config dir')
    }
    await mergeInto(plan.from, plan.to, hooks, journal, { last: 0 })
    return { journal, stopped: hooks.shouldStop() }
}

/** 取消迁移：把已搬走的项逆序搬回原处（best effort）。 */
export async function rollbackMoves(journal: MoveRecord[]): Promise<void> {
    for (let i = journal.length - 1; i >= 0; i--) {
        const { src, dst } = journal[i]
        try {
            if ((await pathExists(src)) || !(await pathExists(dst))) continue
            await fs.promises.mkdir(path.dirname(src), { recursive: true })
            await fs.promises.rename(dst, src)
        } catch (err) {
            log.error({ err, dst, src }, 'failed to roll back')
        }
    }
}
