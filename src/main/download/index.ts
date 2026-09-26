import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from '../kernel/logger'
import { configDir } from '../app/settings'
import { removeQuietly } from '../kernel/treeops'
import { RateLimiter, downloadWithEngine } from './engine'
import {
    DEFAULT_CONFIG,
    type CreateOptions,
    type DownloadConfig,
    type DownloadFileOptions,
    type DownloadProgress,
    type DownloadResult,
    type DownloadStatus,
    type DownloadThreads,
    type ProxyScope,
    type TaskRecord,
    type TaskStatus,
    type TaskView
} from './types'

/**
 * 内核**下载模块** —— 引擎（`engine.ts`）+ 任务层（本文件）。
 *
 * ## 它从哪来
 *
 * 原先是内置扩展 `xeonsky.download`：那时内核的 `dsh/downloader.ts` 只有「把一个 URL
 * 下到磁盘」这一件事，且是一次性的（进程重启就从头再来、不能限速、没有队列、任务不可见）。
 * 现在整块下沉到内核 —— 下载是「把文件弄到磁盘上」的基础设施，装 Node 运行时 / npm / pnpm
 * 都指着它，不该是可被用户停用、会随崩溃计数进安全模式的东西。
 *
 *  - **引擎**（分段 / 断点续传 / 限速 / 重试 / 校验）在 `engine.ts`；
 *  - **任务层**（队列调度、状态机、跨会话持久化、进度推送）在本文件；
 *  - **网络栈**同样在内核：引擎直接调 `dsh/http.ts` 的 `httpFetch`，代理 / Cookie / UA
 *    按 scope 生效。
 *
 * ## 存储布局
 *
 * 配置、任务表、分段临时文件都在 `<配置目录>/data/download/` 下 —— 与扩展数据目录
 * （`data/extensions/<id>`）分开：内核模块没有扩展生命周期，数据不该跟着扩展启停走。
 *
 * ## 任务状态机
 *
 * ```
 *   create ──▶ queued ──▶ running ──▶ done
 *                ▲           │
 *                │           ├──▶ paused   （保留 .part，可继续）
 *                │           ├──▶ error    （保留 .part，可续传重试）
 *                │           └──▶ canceled （保留 .part，可重试）
 *                └──── retry / resume ─────┘
 * ```
 *
 * 已下载的部分**一律保留**（除用户显式删除任务）：这正是断点续传的价值所在。
 * 重启后 `running` / `queued` 一律收敛成 `paused` —— 不该在用户没同意的情况下，
 * 一开机就悄悄占满带宽。
 */

const log = logger('[Download]')

/** 一个正在运行的任务的运行时状态（不持久化：进程退出即失效）。 */
interface RunState {
    controller: AbortController
    limiter: RateLimiter
    /** 阻塞式调用方（内核安装流程）挂的进度回调。 */
    onProgress?: (p: DownloadProgress) => void
    /** 完成后的 resolve；download() 与调度器都靠它收尾。 */
    finish: (r: DownloadResult) => void
    promise: Promise<DownloadResult>
    /** 中止意图：区分「暂停」与「取消」，决定中止后落到哪个状态。 */
    intent: 'pause' | 'cancel'
    speed: number
    percent: number
}

/** 并发上下限（与内核历史取值一致，避免迁移后行为突变）。 */
const THREADS_MIN = 2
const THREADS_MAX = 8
/** 硬上限：别把服务端与本机同时打爆。 */
const THREADS_LIMIT = 16
/** 进度推送节流（毫秒）—— 渲染层不需要 120ms 一次的刷新。 */
const EMIT_INTERVAL = 500

/** 从 URL 推断文件名；推断不出时用时间戳兜底。 */
function fileNameFromUrl(url: string): string {
    try {
        const last = new URL(url).pathname.split('/').filter(Boolean).pop()
        const name = last ? decodeURIComponent(last) : ''
        return name || 'download-' + Date.now()
    } catch {
        return 'download-' + Date.now()
    }
}

/** 解析并发数：'auto' 按本机算力自适应（尊重容器 CPU 配额）。 */
export function resolveThreads(threads: DownloadThreads | undefined): number {
    if (threads === 'auto' || threads === undefined || threads === null) {
        let cores: number
        try {
            cores = os.availableParallelism?.() ?? os.cpus().length
        } catch {
            return THREADS_MIN
        }
        if (!Number.isFinite(cores) || cores < 1) return THREADS_MIN
        return Math.min(THREADS_MAX, Math.max(THREADS_MIN, Math.floor(cores)))
    }
    const v = Math.floor(Number(threads))
    if (!Number.isFinite(v) || v < 1) return resolveThreads('auto')
    return Math.min(THREADS_LIMIT, v)
}

/** 默认下载目录：未配置时用系统的「下载」目录。 */
function defaultDownloadDir(): string {
    return path.join(os.homedir(), 'Downloads')
}

/** 只接受三档代理档位（其余档位不属于下载场景）。 */
function normalizeScope(scope: unknown): ProxyScope {
    return scope === 'app' || scope === 'node' ? scope : 'npm'
}

/** 下载模块的数据目录（配置 / 任务表 / 分段临时文件）。 */
function dataDir(): string {
    return path.join(configDir(), 'data', 'download')
}

// ---------------------------------------------------------------------------
// 模块级单例状态
// ---------------------------------------------------------------------------

/** 数据根（懒建）。 */
function ensureDataDir(): string {
    const dir = dataDir()
    try {
        fs.mkdirSync(dir, { recursive: true })
    } catch {
        /* 已存在 */
    }
    return dir
}

/** 任务表：id → 记录。 */
const tasks = new Map<string, TaskRecord>()
/** 在跑的任务：id → 运行时状态。 */
const running = new Map<string, RunState>()

/** 分段临时文件根目录（`.part` 与侧车都在这里，不污染用户的下载目录）。 */
let tmpRoot = ''
let initialized = false
let cfg: DownloadConfig = { ...DEFAULT_CONFIG }

/** 配置与任务表的路径（初始化后有效）。 */
function paths(): { configPath: string; tasksPath: string } {
    const dir = ensureDataDir()
    return { configPath: path.join(dir, 'config.json'), tasksPath: path.join(dir, 'tasks.json') }
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

function loadConfig(configPath: string): DownloadConfig {
    let raw: string
    try {
        raw = fs.readFileSync(configPath, 'utf8')
    } catch {
        return { ...DEFAULT_CONFIG }
    }
    try {
        const parsed = JSON.parse(raw) as Partial<DownloadConfig>
        return {
            defaultDir: typeof parsed.defaultDir === 'string' ? parsed.defaultDir : DEFAULT_CONFIG.defaultDir,
            maxConcurrent:
                typeof parsed.maxConcurrent === 'number' && parsed.maxConcurrent >= 1
                    ? Math.floor(parsed.maxConcurrent)
                    : DEFAULT_CONFIG.maxConcurrent,
            speedLimit: typeof parsed.speedLimit === 'number' && parsed.speedLimit >= 0 ? Math.floor(parsed.speedLimit) : 0,
            threads: parsed.threads ?? DEFAULT_CONFIG.threads
        }
    } catch {
        return { ...DEFAULT_CONFIG }
    }
}

function saveConfig(configPath: string, next: DownloadConfig): void {
    try {
        fs.writeFileSync(configPath, JSON.stringify(next, null, 4), 'utf8')
    } catch (err) {
        log.warn({ err }, 'failed to persist download config')
    }
}

// ---------------------------------------------------------------------------
// 任务表持久化
// ---------------------------------------------------------------------------

function persist(): void {
    const { tasksPath } = paths()
    try {
        const rows = [...tasks.values()]
        // 阻塞式下载（installer 用）不留在任务表里，理论上这里不会有临时任务；
        // 但真出现了也不该把 .part 路径写进磁盘 —— 下次启动根本无人认领它。
        fs.writeFileSync(tasksPath, JSON.stringify(rows, null, 4), 'utf8')
    } catch (err) {
        log.warn({ err }, 'failed to persist download tasks')
    }
}

/** 启动恢复：在跑的 / 排队的收敛成 paused，任务本身与已下载部分保留。 */
function restore(tasksPath: string): void {
    let raw: string
    try {
        raw = fs.readFileSync(tasksPath, 'utf8')
    } catch {
        return
    }
    let list: unknown
    try {
        list = JSON.parse(raw)
    } catch {
        return
    }
    if (!Array.isArray(list)) return
    for (const item of list) {
        const t = item as Partial<TaskRecord>
        if (typeof t.id !== 'string' || typeof t.url !== 'string') continue
        const status: TaskStatus = t.status === 'running' || t.status === 'queued' ? 'paused' : (t.status ?? 'paused')
        tasks.set(t.id, {
            id: t.id,
            url: t.url,
            fileName: typeof t.fileName === 'string' ? t.fileName : fileNameFromUrl(t.url),
            destDir: typeof t.destDir === 'string' ? t.destDir : defaultDownloadDir(),
            tmpDir: typeof t.tmpDir === 'string' ? t.tmpDir : tmpRoot,
            total: typeof t.total === 'number' ? t.total : 0,
            downloaded: typeof t.downloaded === 'number' ? t.downloaded : 0,
            acceptRanges: t.acceptRanges !== false,
            etag: typeof t.etag === 'string' ? t.etag : '',
            lastModified: typeof t.lastModified === 'string' ? t.lastModified : '',
            threads: t.threads ?? 'auto',
            proxyScope: normalizeScope(t.proxyScope),
            speedLimit: typeof t.speedLimit === 'number' ? t.speedLimit : 0,
            status,
            error: typeof t.error === 'string' ? t.error : undefined,
            createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
            updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : Date.now()
        })
    }
}

/**
 * 首次使用时初始化（配置、任务表、临时目录）。
 *
 * 做成懒初始化而不是模块加载时执行：模块可能被 import 早于 Electron `app` ready，
 * 而 `configDir()` 依赖 app 路径。任何对外函数调用前都会先走这里。
 */
function ensureInit(): void {
    if (initialized) return
    initialized = true
    const { configPath, tasksPath } = paths()
    tmpRoot = path.join(ensureDataDir(), 'tmp')
    try {
        fs.mkdirSync(tmpRoot, { recursive: true })
    } catch {
        /* 已存在 */
    }
    cfg = loadConfig(configPath)
    restore(tasksPath)
}

// ---------------------------------------------------------------------------
// 视图与推送
// ---------------------------------------------------------------------------

/** 进度推送订阅者（渲染层面板注册的转发函数）。 */
const progressSubscribers = new Set<(payload: { tasks: TaskView[]; config: DownloadConfig }) => void>()

/** 订阅进度推送；返回取消订阅的函数。 */
export function onProgress(fn: (payload: { tasks: TaskView[]; config: DownloadConfig }) => void): () => void {
    ensureInit()
    progressSubscribers.add(fn)
    return () => progressSubscribers.delete(fn)
}

function view(t: TaskRecord): TaskView {
    const st = running.get(t.id)
    const downloaded = st ? Math.max(t.downloaded, 0) : t.downloaded
    return {
        ...t,
        downloaded,
        percent: st ? st.percent : t.total > 0 ? Math.min(100, (t.downloaded / t.total) * 100) : 0,
        speed: st?.speed ?? 0
    }
}

let lastEmit = 0
/** 推一份任务快照给订阅者（节流；状态突变时 force）。 */
function emit(force = false): void {
    const now = Date.now()
    if (!force && now - lastEmit < EMIT_INTERVAL) return
    lastEmit = now
    const payload = { tasks: [...tasks.values()].map(view), config: cfg }
    for (const fn of progressSubscribers) {
        try {
            fn(payload)
        } catch {
            /* 单个订阅者出错不该影响调度循环 */
        }
    }
}

// ---------------------------------------------------------------------------
// 调度
// ---------------------------------------------------------------------------

function pump(): void {
    let active = running.size
    for (const t of tasks.values()) {
        if (active >= cfg.maxConcurrent) break
        if (t.status === 'queued' && !running.has(t.id)) {
            void startTask(t.id)
            active += 1
        }
    }
}

/** 临时文件与侧车的路径（引擎与清理共用同一套命名）。 */
function pathsOf(t: TaskRecord): { tmpPath: string; sidecarPath: string; finalPath: string } {
    const tmpPath = path.join(t.tmpDir, t.fileName + '.part')
    return { tmpPath, sidecarPath: tmpPath + '.json', finalPath: path.join(t.destDir, t.fileName) }
}

function startTask(id: string): Promise<DownloadResult> {
    ensureInit()
    const exist = running.get(id)
    if (exist) return exist.promise
    const t = tasks.get(id)
    if (!t) return Promise.resolve({ ok: false, message: '任务不存在', file: '' })

    const controller = new AbortController()
    const limiter = new RateLimiter(t.speedLimit > 0 ? t.speedLimit : cfg.speedLimit)
    let finish!: (r: DownloadResult) => void
    const promise = new Promise<DownloadResult>((resolve) => {
        finish = resolve
    })
    const state: RunState = { controller, limiter, intent: 'pause', finish, promise, speed: 0, percent: 0 }
    running.set(id, state)

    t.status = 'running'
    t.error = undefined
    t.updatedAt = Date.now()
    persist()
    emit(true)

    const { tmpPath, sidecarPath, finalPath } = pathsOf(t)
    void downloadWithEngine({
        url: t.url,
        finalPath,
        tmpPath,
        sidecarPath,
        threads: resolveThreads(t.threads),
        proxyScope: t.proxyScope,
        limiter,
        signal: controller.signal,
        onProgress: (p) => {
            t.total = p.total || t.total
            t.downloaded = p.downloaded
            state.speed = p.speed
            state.percent = p.percent
            state.onProgress?.(p)
            emit()
        }
    }).then((r) => {
        running.delete(id)
        if (r.ok) {
            t.status = 'done'
            t.downloaded = t.total || t.downloaded
            t.error = undefined
        } else if (r.canceled) {
            // 中止落到哪个状态由「谁让停的」决定：暂停还能续，取消是用户放弃。
            t.status = state.intent === 'cancel' ? 'canceled' : 'paused'
        } else {
            t.status = 'error'
            t.error = r.message
        }
        t.updatedAt = Date.now()
        persist()
        emit(true)
        finish({ ...r, file: finalPath })
        pump()
    })

    return promise
}

/** 中止一个在跑的任务（intent 决定后续状态）。 */
function stop(id: string, intent: 'pause' | 'cancel'): TaskView | null {
    ensureInit()
    const t = tasks.get(id)
    if (!t) return null
    const st = running.get(id)
    if (st) {
        st.intent = intent
        st.controller.abort()
    } else if (t.status === 'queued' || t.status === 'running') {
        t.status = intent === 'cancel' ? 'canceled' : 'paused'
        t.updatedAt = Date.now()
        persist()
        emit(true)
    }
    return view(t)
}

function enqueue(id: string): TaskView | null {
    ensureInit()
    const t = tasks.get(id)
    if (!t) return null
    if (t.status === 'done' || t.status === 'running' || t.status === 'queued') return view(t)
    t.status = 'queued'
    t.error = undefined
    t.updatedAt = Date.now()
    persist()
    pump()
    emit(true)
    return view(t)
}

// ---------------------------------------------------------------------------
// 动作实现
// ---------------------------------------------------------------------------

/** 新建一个下载任务。 */
export function create(options: CreateOptions): TaskView {
    ensureInit()
    const url = String(options.url ?? '').trim()
    if (!url) throw new Error('缺少下载 URL')
    const fileName = options.fileName?.trim() || fileNameFromUrl(url)
    const destDir = options.destDir?.trim() || cfg.defaultDir || defaultDownloadDir()
    const now = Date.now()
    const task: TaskRecord = {
        id: randomUUID(),
        url,
        fileName,
        destDir,
        tmpDir: tmpRoot,
        total: 0,
        downloaded: 0,
        acceptRanges: true,
        etag: '',
        lastModified: '',
        threads: options.threads ?? cfg.threads,
        proxyScope: normalizeScope(options.proxyScope),
        speedLimit: typeof options.speedLimit === 'number' ? Math.max(0, Math.floor(options.speedLimit)) : 0,
        status: options.start === false ? 'paused' : 'queued',
        createdAt: now,
        updatedAt: now
    }
    tasks.set(task.id, task)
    persist()
    if (task.status === 'queued') pump()
    emit(true)
    return view(task)
}

/** 列出全部任务。 */
export function list(): TaskView[] {
    ensureInit()
    return [...tasks.values()].map(view)
}

/** 取单个任务（不存在返回 null）。 */
export function get(id: string): TaskView | null {
    ensureInit()
    const t = tasks.get(id)
    return t ? view(t) : null
}

/** 手动开始一个任务。 */
export function start(id: string): TaskView | null {
    ensureInit()
    const t = tasks.get(id)
    if (!t) return null
    void startTask(id)
    return view(t)
}

/** 暂停一个任务（保留 .part，可继续）。 */
export function pause(id: string): TaskView | null {
    return stop(id, 'pause')
}

/** 继续 / 重试一个任务（排队后由调度器拉起）。 */
export function resume(id: string): TaskView | null {
    return enqueue(id)
}

/** 取消一个任务（保留已下载部分，可重试）。 */
export function cancel(id: string): TaskView | null {
    return stop(id, 'cancel')
}

/** 删除一个任务（可选一并删掉落盘文件）。 */
export async function remove(id: string, deleteFile: boolean): Promise<boolean> {
    ensureInit()
    const t = tasks.get(id)
    if (!t) return false
    // 在跑的任务先等它真正停下来再删文件：只发 abort 就删，引擎可能还在写，
    // 结果是把 .part 删掉之后又被重新创建出来，留下一个没人管的孤儿文件。
    const st = running.get(id)
    if (st) {
        st.intent = 'cancel'
        st.controller.abort()
        await st.promise.catch(() => undefined)
    } else {
        stop(id, 'cancel')
    }
    const { tmpPath, sidecarPath, finalPath } = pathsOf(t)
    void removeQuietly(tmpPath)
    void removeQuietly(sidecarPath)
    if (deleteFile) void removeQuietly(finalPath)
    tasks.delete(id)
    persist()
    emit(true)
    pump()
    return true
}

/** 更新配置（并发、限速、默认目录、默认连接数）。 */
export function setConfig(patch: Partial<DownloadConfig>): DownloadConfig {
    ensureInit()
    const { configPath } = paths()
    const next: DownloadConfig = {
        defaultDir: typeof patch.defaultDir === 'string' ? patch.defaultDir.trim() : cfg.defaultDir,
        maxConcurrent:
            typeof patch.maxConcurrent === 'number' && patch.maxConcurrent >= 1
                ? Math.min(16, Math.floor(patch.maxConcurrent))
                : cfg.maxConcurrent,
        speedLimit: typeof patch.speedLimit === 'number' && patch.speedLimit >= 0 ? Math.floor(patch.speedLimit) : cfg.speedLimit,
        threads: patch.threads ?? cfg.threads
    }
    cfg = next
    saveConfig(configPath, next)
    // 全局限速变了：正在跑的任务若跟随全局，要把新速率推给它们的限速器。
    for (const [id, st] of running) {
        const t = tasks.get(id)
        if (!t || t.speedLimit > 0) continue
        st.limiter.setRate(next.speedLimit)
    }
    pump()
    emit(true)
    return cfg
}

/** 状态快照。 */
export function status(): DownloadStatus {
    ensureInit()
    return {
        available: true,
        config: cfg,
        effectiveThreads: resolveThreads(cfg.threads),
        activeCount: running.size,
        tasks: [...tasks.values()].map(view)
    }
}

/**
 * 阻塞式下载 —— 内核的 dsh 安装流程（Node / npm / pnpm）走这条。
 *
 * 它也**进任务表**：安装时用户在下载面板里同样看得到进度。
 * 区别在于调用方会 await 到结束，并且能用自己的 AbortSignal 取消。
 */
export async function download(options: DownloadFileOptions): Promise<DownloadResult> {
    ensureInit()
    const url = String(options.url ?? '').trim()
    if (!url) return { ok: false, message: '缺少下载 URL', file: '' }
    const fileName = options.fileName?.trim() || fileNameFromUrl(url)
    const destDir = options.destDir?.trim() || cfg.defaultDir || defaultDownloadDir()
    const now = Date.now()
    const task: TaskRecord = {
        id: randomUUID(),
        url,
        fileName,
        destDir,
        tmpDir: options.tmpDir?.trim() || tmpRoot,
        total: 0,
        downloaded: 0,
        acceptRanges: true,
        etag: '',
        lastModified: '',
        threads: options.threads ?? cfg.threads,
        proxyScope: normalizeScope(options.proxyScope),
        speedLimit: 0,
        status: 'queued',
        createdAt: now,
        updatedAt: now
    }
    tasks.set(task.id, task)
    persist()
    emit(true)

    // 外部取消信号 → 落成「取消」意图（安装流程的取消按钮）。
    if (options.signal) {
        options.signal.addEventListener(
            'abort',
            () => {
                const st = running.get(task.id)
                if (st) {
                    st.intent = 'cancel'
                    st.controller.abort()
                }
            },
            { once: true }
        )
    }

    // 不进并发队列的等待位：安装流程是「现在就要」，直接开跑。
    const promise = startTask(task.id)
    const st = running.get(task.id)
    if (st && options.onProgress) st.onProgress = options.onProgress
    const r = await promise
    // 阻塞式下载**不留在任务表**：调用方自己 await 到结果，任务对它没有后续价值；
    // 跑的过程中可见（安装进度能在下载面板里看到）就够了。
    // 若留着，每次装 Node / npm / pnpm 都会往 tasks.json 里堆一条，日积月累全是噪音。
    tasks.delete(task.id)
    persist()
    emit(true)
    return { ...r, file: path.join(destDir, fileName) }
}

/**
 * 进程退出前中止全部在跑的任务。
 *
 * 不中止的话，进程退出后临时文件没人清理、也没人把状态落盘。
 * `.part` 保留，下次启动恢复成 paused 还能续。
 */
export function shutdownDownloads(): void {
    for (const st of running.values()) {
        // 用 'pause' 而不是 'cancel'：暂停态在下次启动时可以直接续传 ——
        // 取消则要用户再点一次「重试」。
        st.intent = 'pause'
        st.controller.abort()
    }
}
