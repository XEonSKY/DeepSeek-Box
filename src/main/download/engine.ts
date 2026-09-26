/**
 * 内核的**下载引擎**：分段并发、跨会话断点续传、限速、重试、校验。
 *
 * 与 `index.ts`（任务层）的分工：本文件只做「把一个 URL 变成一个落盘文件」，
 * **不认识任务表**（排队、持久化、状态机都在 index.ts）。
 *
 * ## 它从哪来
 *
 * 原先是内置扩展 `xeonsky.download` 的 `engine.ts`，经系统能力 `net.stream` 发请求。
 * 现已下沉到内核（连同任务层）—— 下载是「把文件弄到磁盘上」的基础设施，
 * 装 Node 运行时 / npm / pnpm 都指着它，不该是可被用户停用的东西。
 *
 * 下沉带来的简化：不再需要 {@link OpenStream} 那个注入点 —— 引擎直接调
 * `dsh/http.ts` 的 `httpFetch`（代理 / Cookie / UA 由 scope 决定），
 * 少一层「调用方把怎么发 HTTP 传进来」的间接。
 *
 * 断点续传的做法：`.part` 文件旁边放一个 `.part.json` 侧车，记录总大小、ETag、
 * Last-Modified 与每个分段的完成偏移。下次下载同一 URL 时先探测服务端：
 * 三个标识都没变才接着下，任一变化（服务端换了文件）就丢弃重来 ——
 * 否则会拼出一个「前半旧后半新」的脏文件，那比重新下载糟糕得多。
 */

import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import type { HttpScope } from '../dsh/http'
import { httpFetch } from '../dsh/http'
import { removeQuietly } from '../kernel/treeops'
import type { DownloadProgress, DownloadResult, ProxyScope, SegmentProgress } from './types'

// ---------------------------------------------------------------------------
// 发请求
// ---------------------------------------------------------------------------

/** 一次流式响应的形状。 */
interface OpenedStream {
    ok: boolean
    status: number
    headers: Record<string, string>
    /** 响应体（Node 可读流）；HEAD / 无体时为 null。 */
    body: Readable | null
}

/** 把 Headers 摊成小写键的普通对象（Header 名按规范已归一为小写）。 */
function headersOf(res: Response): Record<string, string> {
    const out: Record<string, string> = {}
    res.headers.forEach((value, key) => {
        out[key] = value
    })
    return out
}

/** 把 web ReadableStream 转成 Node 可读流；不兼容时退回手动拉读。 */
function toNodeReadable(res: Response): Readable | null {
    const body = res.body
    if (!body) return null
    try {
        return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0])
    } catch {
        // 极少数情况下 Chromium 的 ReadableStream 与 Node 的 fromWeb 不能互操作，
        // 退回「手动拉一块推一块」的实现，语义等价。
        const reader = body.getReader()
        return new Readable({
            read(): void {
                reader.read().then(
                    ({ done, value }) => {
                        if (done) this.push(null)
                        else this.push(Buffer.from(value))
                    },
                    (err: unknown) => this.destroy(err as Error)
                )
            },
            destroy(err: Error | null, cb: (e: Error | null) => void): void {
                void reader.cancel().catch(() => undefined)
                cb(err)
            }
        })
    }
}

/** 发一次（可带 Range 的）流式请求：经 `httpFetch`，代理按 scope 生效。 */
async function open(url: string, init: { headers?: Record<string, string>; scope?: ProxyScope; signal?: AbortSignal }): Promise<OpenedStream> {
    const res = await httpFetch((init.scope ?? 'npm') as HttpScope, url, {
        method: 'GET',
        headers: init.headers,
        signal: init.signal
    })
    return { ok: res.ok, status: res.status, headers: headersOf(res), body: toNodeReadable(res) }
}

// ---------------------------------------------------------------------------
// 限速
// ---------------------------------------------------------------------------

/** 不超过 1 秒地等一会儿（限速等待用）。 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 令牌桶限速器。
 *
 * 设计要点：
 *  - **同一个实例被一个任务的全部分段共享** —— 限速的目标是该任务的总速率，
 *    而不是每条连接各自限速（否则 N 条连接就是 N 倍速度，限速形同虚设）；
 *  - 桶容量取 `max(rate, n)`：否则一个大于 rate 的 chunk 永远攒不够令牌，会卡死；
 *  - 速率可变（用户随时改限速），不重建实例以免丢失已积累的令牌。
 */
export class RateLimiter {
    private rate: number
    private tokens: number
    private last: number

    /**
     * @param rate 初始速率（0 = 不限速）
     *
     * 桶**初始为空**而不是预装一秒的量：预装会让「开始下载的第一秒」事实上不受限
     * （实测 400KB @ 200KB/s 只用了一半时间），用户看到的是「限速没生效」。
     * 空桶起步则速率从第一块就开始守，稳定后吞吐量等于设定值。
     */
    constructor(rate = 0) {
        this.rate = Math.max(0, rate)
        this.tokens = 0
        this.last = Date.now()
    }

    /** 改速率（0 = 不限速，立即放行）。 */
    setRate(rate: number): void {
        this.rate = Math.max(0, rate)
        this.tokens = Math.min(this.tokens, this.rate)
    }

    /** 当前速率（0 = 不限）。 */
    getRate(): number {
        return this.rate
    }

    /** 消费 n 个字节的配额；不限速时立即返回。 */
    async consume(n: number): Promise<void> {
        if (this.rate <= 0 || n <= 0) return
        for (;;) {
            this.refill(n)
            if (this.tokens >= n) {
                this.tokens -= n
                return
            }
            const need = n - this.tokens
            const waitMs = Math.ceil((need / this.rate) * 1000)
            await sleep(Math.min(Math.max(waitMs, 1), 1000))
        }
    }

    /** 按经过的时间补令牌；上限保证「既能限制速率，又不会让大块永远等不到」。 */
    private refill(pending: number): void {
        const now = Date.now()
        const dt = (now - this.last) / 1000
        if (dt <= 0) return
        this.last = now
        const cap = Math.max(this.rate, pending)
        this.tokens = Math.min(cap, this.tokens + dt * this.rate)
    }
}

// ---------------------------------------------------------------------------
// 引擎入参与侧车
// ---------------------------------------------------------------------------

/** 一次下载需要的全部信息（由任务层填好）。 */
export interface EngineOptions {
    url: string
    /** 最终落盘的绝对路径。 */
    finalPath: string
    /** 分段临时文件路径（`<tmpDir>/<fileName>.part`）。 */
    tmpPath: string
    /** 侧车文件路径（`<tmpPath>.json`）。 */
    sidecarPath: string
    /** 并发连接数（已把 'auto' 解析成数字）。 */
    threads: number
    proxyScope: ProxyScope
    /** 该任务共享的限速器。 */
    limiter: RateLimiter
    /** 外部取消信号。 */
    signal?: AbortSignal
    onProgress?: (p: DownloadProgress) => void
}

/** 侧车文件的形状。 */
interface Sidecar {
    url: string
    total: number
    etag: string
    lastModified: string
    acceptRanges: boolean
    threads: number
    segments: SegmentProgress[]
    updatedAt: number
}

/** 小于该大小不值得分段（分段本身有额外请求开销）。 */
const MIN_SEGMENT_BYTES = 1024 * 1024
/** 单个分段的重试次数。 */
const MAX_RETRY = 3
/** 进度上报节流（毫秒）。 */
const EMIT_INTERVAL = 120
/** 侧车写入节流（毫秒）—— 每次写盘都有代价，但间隔太久会丢更多进度。 */
const SIDECAR_INTERVAL = 1000

/** 读侧车；不存在或损坏时返回 null（调用方按「不能续传」处理）。 */
async function readSidecar(file: string): Promise<Sidecar | null> {
    try {
        const raw = await fs.promises.readFile(file, 'utf8')
        const parsed = JSON.parse(raw) as Partial<Sidecar>
        if (typeof parsed.total !== 'number' || !Array.isArray(parsed.segments)) return null
        return {
            url: typeof parsed.url === 'string' ? parsed.url : '',
            total: parsed.total,
            etag: typeof parsed.etag === 'string' ? parsed.etag : '',
            lastModified: typeof parsed.lastModified === 'string' ? parsed.lastModified : '',
            acceptRanges: parsed.acceptRanges === true,
            threads: typeof parsed.threads === 'number' ? parsed.threads : 0,
            segments: parsed.segments,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
        }
    } catch {
        return null
    }
}

/** 写侧车（先写临时文件再改名，避免中途崩溃留下半截 JSON）。 */
async function writeSidecar(file: string, data: Sidecar): Promise<void> {
    const tmp = file + '.tmp'
    try {
        await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8')
        await fs.promises.rename(tmp, file)
    } catch {
        /* 侧车写不进去只影响续传，不该让正在进行的下载失败 */
    }
}

// ---------------------------------------------------------------------------
// 探测
// ---------------------------------------------------------------------------

/** 探测结果：总大小、是否支持 Range、以及用于续传校验的两个标识。 */
interface ProbeResult {
    total: number
    acceptRanges: boolean
    etag: string
    lastModified: string
}

/** 静默丢弃响应体（探测阶段用不到内容，不读 body 会让连接悬挂）。 */
function dropBody(res: OpenedStream): void {
    try {
        res.body?.destroy()
    } catch {
        /* 已关闭 */
    }
}

/** 先试一个 Range 请求拿到总大小；不支持 Range 时退回普通 GET 的 content-length。 */
async function probe(url: string, scope: ProxyScope, signal?: AbortSignal): Promise<ProbeResult> {
    const res = await open(url, { headers: { Range: 'bytes=0-0' }, scope, signal })
    const etag = res.headers['etag'] ?? res.headers['ETag'] ?? ''
    const lastModified = res.headers['last-modified'] ?? res.headers['Last-Modified'] ?? ''
    if (res.status === 206) {
        const total = Number((res.headers['content-range'] ?? '').split('/').pop() ?? 0)
        dropBody(res)
        return { total: Number.isFinite(total) ? total : 0, acceptRanges: total > 0, etag, lastModified }
    }
    const len = Number(res.headers['content-length'] ?? 0)
    dropBody(res)
    return { total: Number.isFinite(len) && len > 0 ? len : 0, acceptRanges: false, etag, lastModified }
}

// ---------------------------------------------------------------------------
// 分段
// ---------------------------------------------------------------------------

/** 按并发数把 [0, total) 切成若干段。 */
export function planSegments(total: number, threads: number): SegmentProgress[] {
    const n = Math.max(1, Math.min(threads, Math.max(1, Math.ceil(total / MIN_SEGMENT_BYTES) || 1)))
    const size = Math.ceil(total / n)
    const out: SegmentProgress[] = []
    for (let i = 0; i < n; i++) {
        const start = i * size
        if (start >= total) break
        const end = Math.min(start + size - 1, total - 1)
        out.push({ start, end, done: start })
    }
    return out
}

/** 已完成的字节数（[start, done) 之和）。 */
export function completedBytes(segments: SegmentProgress[]): number {
    return segments.reduce((sum, s) => sum + Math.max(0, s.done - s.start), 0)
}

/**
 * 决定能不能续传：总大小、ETag、Last-Modified 都没变，且分段表与当前并发数一致。
 *
 * 只在这三者都没变时才复用 —— 服务端换了文件而 size 恰好相同的情况靠 ETag 挡住；
 * 并发数变了会导致分段边界不同，复用旧进度会得到错误的偏移，故一并判掉。
 */
function reusable(prev: Sidecar | null, url: string, total: number, etag: string, lastModified: string, threads: number): boolean {
    if (!prev || !prev.acceptRanges || prev.total !== total || prev.threads !== threads || prev.url !== url) return false
    // 服务端没给任何校验标识时不冒险续传：无法确认文件没变。
    if (!etag && !lastModified) return false
    return prev.etag === etag && prev.lastModified === lastModified
}

// ---------------------------------------------------------------------------
// 写盘
// ---------------------------------------------------------------------------

/**
 * 预分配（或补齐）临时文件到 total 长度，供各分段按偏移随机写。
 *
 * 用 `fs.truncate(路径)` 而不是「开句柄再 ftruncate」：前者一次系统调用就够了，
 * 且不占句柄（续传判定会在下载开始前 stat 这个文件）。
 * 只**加长**不缩短：已下载的部分永远不能因为一次探测而被截掉。
 */
async function preallocate(file: string, total: number): Promise<void> {
    // 'a' 打开只为「不存在则创建」，随即关掉。
    const fh = await fs.promises.open(file, 'a')
    await fh.close()
    const st = await fs.promises.stat(file)
    if (st.size < total) await fs.promises.truncate(file, total)
}

/** 带背压地写一块；返回是否写成功（流已关闭时返回 false）。 */
async function writeChunk(ws: fs.WriteStream, chunk: Buffer): Promise<boolean> {
    if (ws.destroyed) return false
    if (ws.write(chunk)) return true
    await once(ws, 'drain')
    return !ws.destroyed
}

/** 把临时文件搬到最终位置；跨盘 rename 会失败，退回拷贝再删源。 */
async function moveFile(from: string, to: string): Promise<void> {
    try {
        await fs.promises.rename(from, to)
    } catch {
        await fs.promises.copyFile(from, to)
        await removeQuietly(from)
    }
}

// ---------------------------------------------------------------------------
// 进度
// ---------------------------------------------------------------------------

/** 进度累计状态。 */
interface ProgressState {
    total: number
    downloaded: number
    speed: number
    lastEmit: number
    lastBytes: number
    lastTime: number
}

/** 生成一个节流的进度上报函数（速度用指数滑动平均，避免数字乱跳）。 */
function makeReporter(baseBytes: number, emit: (p: DownloadProgress) => void, state: ProgressState): (force?: boolean) => void {
    return (force = false): void => {
        const now = Date.now()
        if (!force && now - state.lastEmit < EMIT_INTERVAL) return
        const dt = Math.max(1, now - state.lastTime) / 1000
        const inst = (state.downloaded - state.lastBytes) / dt
        state.speed = state.speed > 0 ? state.speed * 0.65 + inst * 0.35 : inst
        state.lastEmit = now
        state.lastBytes = state.downloaded
        state.lastTime = now
        const downloaded = baseBytes + state.downloaded
        emit({
            total: state.total,
            downloaded,
            percent: state.total > 0 ? Math.min(100, (downloaded / state.total) * 100) : 0,
            speed: Math.max(0, state.speed)
        })
    }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 下载 [start, end] 区间到临时文件的对应偏移，断流后从断点续传。
 *
 * 重试只包住「发起请求 → 写盘」这一段，且重试时从**实际写到的位置**继续
 * （`pos` 只在成功写入后前进），所以重试不会重复写、也不会漏写。
 */
async function runSegment(
    url: string,
    file: string,
    seg: SegmentProgress,
    scope: ProxyScope,
    limiter: RateLimiter,
    signal: AbortSignal | undefined,
    state: ProgressState,
    report: (force?: boolean) => void
): Promise<void> {
    let pos = seg.done
    let attempt = 0
    while (pos <= seg.end) {
        const res = await open(url, { headers: { Range: `bytes=${pos}-${seg.end}` }, scope, signal })
        if (res.status !== 206 || !res.body) {
            dropBody(res)
            throw new Error('HTTP ' + res.status)
        }
        const ws = fs.createWriteStream(file, { flags: 'r+', start: pos })
        const stop = (): void => {
            if (!ws.destroyed) ws.destroy()
            dropBody(res)
        }
        signal?.addEventListener('abort', stop, { once: true })
        try {
            for await (const chunk of res.body) {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
                await limiter.consume(buf.length)
                if (signal?.aborted) throw new Error('canceled')
                const okWrite = await writeChunk(ws, buf)
                if (!okWrite) break
                pos += buf.length
                state.downloaded += buf.length
                seg.done = pos
                report()
            }
        } finally {
            signal?.removeEventListener('abort', stop)
            dropBody(res)
            if (!ws.destroyed) {
                ws.end()
                await once(ws, 'close').catch(() => undefined)
            }
        }
        if (pos > seg.end) return
        if (signal?.aborted) throw new Error('canceled')
        attempt += 1
        if (attempt > MAX_RETRY) throw new Error('分段重试次数耗尽')
        await sleep(300 * attempt)
    }
}

/** 单流下载（服务端不支持 Range，或文件太小）；不支持续传，每次从头写。 */
async function singleStream(
    url: string,
    file: string,
    scope: ProxyScope,
    limiter: RateLimiter,
    signal: AbortSignal | undefined,
    state: ProgressState,
    report: (force?: boolean) => void
): Promise<void> {
    const res = await open(url, { scope, signal })
    if (!res.ok || !res.body) {
        dropBody(res)
        throw new Error('HTTP ' + res.status)
    }
    const len = Number(res.headers['content-length'] ?? 0)
    if (Number.isFinite(len) && len > 0) state.total = len
    const ws = fs.createWriteStream(file, { flags: 'w' })
    const stop = (): void => {
        if (!ws.destroyed) ws.destroy()
        dropBody(res)
    }
    signal?.addEventListener('abort', stop, { once: true })
    try {
        for await (const chunk of res.body) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
            await limiter.consume(buf.length)
            if (signal?.aborted) throw new Error('canceled')
            const okWrite = await writeChunk(ws, buf)
            if (!okWrite) break
            state.downloaded += buf.length
            report()
        }
    } finally {
        signal?.removeEventListener('abort', stop)
        dropBody(res)
        if (!ws.destroyed) {
            ws.end()
            await once(ws, 'close').catch(() => undefined)
        }
    }
}

/**
 * 执行一个下载（不含任务表概念）。
 *
 * 失败时**保留** `.part` 与侧车：下一次调用会接着下（断点续传的意义正在于此）。
 * 只有「服务端文件变了 / 不支持 Range」这两种情况才会丢弃重来。
 */
export async function downloadWithEngine(o: EngineOptions): Promise<DownloadResult> {
    const controller = new AbortController()
    const outer = o.signal
    if (outer) {
        if (outer.aborted) controller.abort()
        else outer.addEventListener('abort', () => controller.abort(), { once: true })
    }
    const signal = controller.signal
    const state: ProgressState = { total: 0, downloaded: 0, speed: 0, lastEmit: 0, lastBytes: 0, lastTime: Date.now() }

    try {
        await fs.promises.mkdir(path.dirname(o.tmpPath), { recursive: true })
    } catch {
        return { ok: false, message: '无法创建临时目录', file: o.finalPath }
    }

    let info: ProbeResult
    try {
        info = await probe(o.url, o.proxyScope, signal)
    } catch (err) {
        return { ok: false, canceled: signal.aborted, message: err instanceof Error ? err.message : String(err), file: o.finalPath }
    }

    const prev = await readSidecar(o.sidecarPath)
    // 侧车说能续传还不够：`.part` 必须真的在盘上且长度够 —— 否则续传只会往稀疏空洞后面
    // 追加数据，拼出一个「前面全是 0 字节」的坏文件。
    const partStat = await fs.promises.stat(o.tmpPath).catch(() => null)
    const resume = reusable(prev, o.url, info.total, info.etag, info.lastModified, o.threads) && !!partStat && partStat.size >= info.total
    const segmented = info.acceptRanges && o.threads > 1 && info.total >= MIN_SEGMENT_BYTES
    const segments = segmented ? (resume && prev ? prev.segments : planSegments(info.total, o.threads)) : []
    const baseBytes = segmented ? completedBytes(segments) : 0

    state.total = info.total

    // 侧车节流写：只在「有进度且间隔够」时落盘，中途崩溃最多丢一秒的进度。
    // 单流模式没有分段表可记（也不支持续传），所以只在分段模式下写。
    let lastSidecar = 0
    const persistSidecar = async (force = false): Promise<void> => {
        if (!segmented) return
        const now = Date.now()
        if (!force && now - lastSidecar < SIDECAR_INTERVAL) return
        lastSidecar = now
        await writeSidecar(o.sidecarPath, {
            url: o.url,
            total: info.total,
            etag: info.etag,
            lastModified: info.lastModified,
            acceptRanges: info.acceptRanges,
            threads: o.threads,
            segments,
            updatedAt: now
        })
    }

    // 每次上报进度时顺带落一次侧车（内部还有 1 秒节流）——
    // 只在收尾时写是不够的：进程被强杀 / 断电时根本没有收尾的机会，
    // 而「已经下了一半」正是断点续传要保住的东西。
    const report = makeReporter(baseBytes, (p) => {
        o.onProgress?.(p)
        void persistSidecar()
    }, state)

    try {
        if (!segmented) {
            await singleStream(o.url, o.tmpPath, o.proxyScope, o.limiter, signal, state, report)
        } else {
            if (!resume) await removeQuietly(o.tmpPath)
            await preallocate(o.tmpPath, info.total)
            await Promise.all(
                segments.map((seg) => runSegment(o.url, o.tmpPath, seg, o.proxyScope, o.limiter, signal, state, report))
            )
        }
        report(true)

        // 大小校验：服务端给了总大小却对不上，说明中途换过文件或写坏了，不能算成功。
        const st = await fs.promises.stat(o.tmpPath).catch(() => null)
        if (info.total > 0 && (!st || st.size !== info.total)) {
            throw new Error(`文件大小不符：期望 ${info.total}，实际 ${st?.size ?? 0}`)
        }

        await fs.promises.mkdir(path.dirname(o.finalPath), { recursive: true })
        await moveFile(o.tmpPath, o.finalPath)
        await removeQuietly(o.sidecarPath)
        return { ok: true, file: o.finalPath }
    } catch (err) {
        const canceled = signal.aborted || (err instanceof Error && err.message === 'canceled')
        // 取消 / 出错时也要写：**暂停本质上就是一次中止**，而暂停正是最需要留进度的时候。
        // 只在成功路径不写（那时侧车已经没用了，会被删掉）。
        await persistSidecar(true)
        return {
            ok: false,
            canceled,
            message: canceled ? '操作已取消' : err instanceof Error ? err.message : String(err),
            file: o.finalPath
        }
    }
}
