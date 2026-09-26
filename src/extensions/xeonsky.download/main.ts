import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExtContext } from '@main/extensions/loader/ctx'
import { RateLimiter, downloadWithEngine, type OpenStream, type OpenedStream } from './engine'
import {
    CAPABILITY_ACTIONS,
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
 * 内置扩展 `xeonsky.download` 的主进程实现 —— 下载的任务层。
 *
 * ## 它承担了什么
 *
 * 内核曾经的 `dsh/downloader.ts` 只有「把一个 URL 下到磁盘」这一件事，且是一次性的：
 * 进程重启就从头再来、不能限速、没有队列、任务不可见。迁移到这里之后：
 *  - **引擎**（分段 / 断点续传 / 限速 / 重试 / 校验）在 `engine.ts`；
 *  - **任务层**（队列调度、状态机、跨会话持久化、进度推送）在本文件；
 *  - **网络栈仍在内核**：本扩展只经系统能力 `net.stream` 发请求，代理 / Cookie / UA
 *    由内核的 session 决定 —— 扩展不该、也不能自己决定走哪个出口。
 *
 * ## 为什么这样分层
 *
 * 扩展**不 import 任何内核模块**（除 `ExtContext` 类型）：所有 I/O 经 ctx 取用。
 * 唯一例外是 `engine.ts` 直接用 `node:fs` 做按偏移的流式写 —— 理由写在那个文件的顶部
 * （系统能力 `fs` 没有流式写口子，而为此开一个等于把下载算法搬回内核）。
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

export function activate(ctx: ExtContext): void {
    // ---- 能力取用口（全部经 ctx） -------------------------------------------

    const fsCall = <T,>(action: string, ...args: unknown[]): T => ctx.capabilities.call<T>('fs', action, ...args)

    /**
     * 发一次（可带 Range 的）流式请求。
     *
     * 经系统能力 `net.stream` —— 它内部走 `dsh/http.ts` 的 session，
     * 于是「设置 → 网络 → 代理」对下载照样生效，而扩展拿不到 session 本体。
     */
    const open: OpenStream = (url, init) =>
        ctx.capabilities.call<Promise<OpenedStream>>('net', 'stream', url, { ...init, signal: init?.signal })

    // ---- 存储布局 ------------------------------------------------------------

    const configPath = path.join(ctx.dataDir, 'config.json')
    const tasksPath = path.join(ctx.dataDir, 'tasks.json')
    /** 分段临时文件根目录（`.part` 与侧车都在这里，不污染用户的下载目录）。 */
    const tmpRoot = path.join(ctx.dataDir, 'tmp')
    fsCall('mkdir', tmpRoot)

    // ---- 配置 ----------------------------------------------------------------

    function loadConfig(): DownloadConfig {
        const raw = fsCall<string | null>('readIfExists', configPath)
        if (!raw) return { ...DEFAULT_CONFIG }
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

    function saveConfig(next: DownloadConfig): void {
        fsCall('write', configPath, JSON.stringify(next, null, 4))
    }

    let cfg = loadConfig()

    // ---- 任务表 --------------------------------------------------------------

    const tasks = new Map<string, TaskRecord>()
    const running = new Map<string, RunState>()

    function persist(): void {
        fsCall('write', tasksPath, JSON.stringify([...tasks.values()], null, 4))
    }

    /** 启动恢复：在跑的 / 排队的收敛成 paused，任务本身与已下载部分保留。 */
    function restore(): void {
        const raw = fsCall<string | null>('readIfExists', tasksPath)
        if (!raw) return
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

    restore()

    // ---- 视图与推送 ----------------------------------------------------------

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
    /** 推一份任务快照给渲染层（节流；状态突变时 force）。 */
    function emit(force = false): void {
        const now = Date.now()
        if (!force && now - lastEmit < EMIT_INTERVAL) return
        lastEmit = now
        ctx.ipc.emit('progress', { tasks: [...tasks.values()].map(view), config: cfg })
    }

    // ---- 调度 ----------------------------------------------------------------

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
        void downloadWithEngine(open, {
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

    // ---- 动作实现 ------------------------------------------------------------

    function create(options: CreateOptions): TaskView {
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

    async function remove(id: string, deleteFile: boolean): Promise<boolean> {
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
        // 目录级清理走 fs 能力：整目录删除的「不跟符号链接」语义由内核统一保证。
        void fsCall<Promise<void>>('removeQuietly', tmpPath)
        void fsCall<Promise<void>>('removeQuietly', sidecarPath)
        if (deleteFile) void fsCall<Promise<void>>('removeQuietly', finalPath)
        tasks.delete(id)
        persist()
        emit(true)
        pump()
        return true
    }

    function setConfig(patch: Partial<DownloadConfig>): DownloadConfig {
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
        saveConfig(next)
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

    function status(): DownloadStatus {
        return {
            available: ctx.capabilities.has('net'),
            config: cfg,
            effectiveThreads: resolveThreads(cfg.threads),
            activeCount: running.size,
            tasks: [...tasks.values()].map(view)
        }
    }

    /**
     * 阻塞式下载 —— 供内核的 dsh 安装流程使用（形状与旧 `downloadFile` 一致）。
     *
     * 它也**进任务表**：安装 Node / pnpm 时用户在下载面板里同样看得到进度。
     * 区别在于调用方会 await 到结束，并且能用自己的 AbortSignal 取消。
     */
    async function download(options: DownloadFileOptions): Promise<DownloadResult> {
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

    // ---- 对外提供能力 --------------------------------------------------------

    const actions: Record<string, (...args: never[]) => unknown> = {
        status: () => status(),
        list: () => [...tasks.values()].map(view),
        get: (id: unknown) => {
            const t = typeof id === 'string' ? tasks.get(id) : undefined
            return t ? view(t) : null
        },
        create: (options: unknown) => create((options ?? {}) as CreateOptions),
        start: (id: unknown) => {
            const key = String(id ?? '')
            const t = tasks.get(key)
            if (!t) return null
            void startTask(key)
            return view(t)
        },
        pause: (id: unknown) => stop(String(id ?? ''), 'pause'),
        resume: (id: unknown) => enqueue(String(id ?? '')),
        retry: (id: unknown) => enqueue(String(id ?? '')),
        cancel: (id: unknown) => stop(String(id ?? ''), 'cancel'),
        remove: (id: unknown, deleteFile: unknown) => remove(String(id ?? ''), deleteFile === true),
        setConfig: (patch: unknown) => setConfig((patch ?? {}) as Partial<DownloadConfig>),
        download: (options: unknown) => download((options ?? {}) as DownloadFileOptions)
    }

    ctx.provides.register('xeonsky.download', actions)

    // ---- 面板用的 IPC（与对外能力同源） --------------------------------------

    // handler 的入参是**上下文对象** `{ event, params, query, body }`：
    // 渲染层 `ext.invoke(channel, payload)` 把 payload 放在 `body` 里（见 preload/index.ts）。
    const bodyOf = (c: unknown): Record<string, unknown> => {
        const o = c as { body?: unknown } | null
        return o && typeof o.body === 'object' && o.body !== null ? (o.body as Record<string, unknown>) : {}
    }

    ctx.ipc.handle('status', () => status())
    ctx.ipc.handle('list', () => [...tasks.values()].map(view))
    ctx.ipc.handle('create', (c) => create(bodyOf(c) as unknown as CreateOptions))
    ctx.ipc.handle('start', (c) => {
        const id = String(bodyOf(c)['id'] ?? '')
        const t = tasks.get(id)
        if (!t) return null
        void startTask(id)
        return view(t)
    })
    ctx.ipc.handle('pause', (c) => stop(String(bodyOf(c)['id'] ?? ''), 'pause'))
    ctx.ipc.handle('resume', (c) => enqueue(String(bodyOf(c)['id'] ?? '')))
    ctx.ipc.handle('retry', (c) => enqueue(String(bodyOf(c)['id'] ?? '')))
    ctx.ipc.handle('cancel', (c) => stop(String(bodyOf(c)['id'] ?? ''), 'cancel'))
    ctx.ipc.handle('remove', (c) => {
        const b = bodyOf(c)
        return remove(String(b['id'] ?? ''), b['deleteFile'] === true)
    })
    ctx.ipc.handle('setConfig', (c) => setConfig(bodyOf(c) as unknown as Partial<DownloadConfig>))

    // ---- 收尾 ----------------------------------------------------------------

    // 卸载时把在跑的任务全部中止：不中止的话，扩展没了而下载还挂在内核 session 上，
    // 临时文件也没人清理。.part 保留，下次启用还能续。
    ctx.disposables.add(() => {
        // 用 'pause' 而不是 'cancel'：中止意图决定引擎收尾时落到哪个状态，
        // 而暂停态在用户下次启用本扩展时可以直接续传 —— 取消则要用户再点一次「重试」。
        for (const st of running.values()) {
            st.intent = 'pause'
            st.controller.abort()
        }
    })

    ctx.log.info(`builtin extension xeonsky.download activated (actions: ${CAPABILITY_ACTIONS.join(', ')})`)
}
