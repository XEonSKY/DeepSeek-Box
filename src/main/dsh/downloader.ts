import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import type { DownloadThreads } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { removeQuietly } from '../kernel/treeops'
import { httpFetch } from './http'
import type { HttpScope } from './http'

/**
 * 统一文件下载器：默认多线程（HTTP Range 分段并发）。
 *
 * 先探测服务端是否支持 Range：支持且文件不小于 1MB 时按并发数把文件切成若干段并行
 * 下载（每段直接写目标文件的对应偏移，省掉合并拷贝），否则退回单流下载。无论哪条路径，
 * 进度回调都给出总大小、已下载、百分比与瞬时下载速度（供进度条展示速度与文件大小）。
 *
 * 并发数来自设置 `downloadThreads`：'auto'（默认）按本机 CPU 核心数自适应，见
 * autoDownloadThreads()；用户也可手动钉一个 1–16 的值。
 *
 * 临时文件先写到 opts.tmpDir（应用侧统一传「工作目录/temp/download」），成功后再搬到
 * 目标位置；临时目录与目标目录可能不同盘，此时 rename 会失败，由 moveFile 拷贝兜底。
 *
 * 同一目标文件的重复请求会合并到同一个在途任务：后到的调用共享结果并订阅同一份进度，
 * 不会重复发起下载（见 downloadFile）。
 */

interface DlProgress {
    total: number
    downloaded: number
    /** 0-100 */
    percent: number
    /** bytes/s */
    speed: number
}

interface DownloadFileOpts {
    url: string
    destDir: string
    fileName?: string
    /** 临时文件目录；默认与目标目录相同（应用侧统一传「工作目录/temp/download」）。 */
    tmpDir?: string
    onProgress?: (p: DlProgress) => void
    /** 并发连接数（1 = 单线程）；'auto' / 非法值按本机核心数自适应。 */
    threads?: DownloadThreads
    /** 外部取消信号（安装流程的 CancelToken）；中止时清理临时文件并返回 canceled=true。 */
    signal?: AbortSignal
    /**
     * 走哪一档「代理范围」（见 http.ts）：Node 发行包用 'node'，npm / dsh 的包用 'npm'。
     * 缺省 'npm'（历史上下载只服务于 npm 包）。
     */
    proxyScope?: Extract<HttpScope, 'npm' | 'node'>
}

/** 一次下载的结果。 */
type DlResult = { ok: boolean; message?: string; canceled?: boolean }

/** 同一目标文件的在途下载任务（用于去重合并）。 */
interface InFlight {
    subscribers: Set<(p: DlProgress) => void>
    promise: Promise<DlResult>
}

/** 在途下载表：键为最终文件的绝对路径（小写，Windows 大小写不敏感）。 */
const inFlightDownloads = new Map<string, InFlight>()

/** 并发上限：别把服务端与本机同时打爆。 */
const MAX_DOWNLOAD_THREADS = 16
/** 自动档的上下限：下限 2 才有分段意义，上限避免在只开代理的小带宽上抢满连接。 */
const AUTO_DOWNLOAD_THREADS_MIN = 2
const AUTO_DOWNLOAD_THREADS_MAX = 8
/** 小于该大小不值得分段（分段本身有额外请求开销）。 */
const MIN_SEGMENT_BYTES = 1024 * 1024
/** 单个请求的最大重试次数。 */
const MAX_RETRY = 3
/** 进度事件节流（毫秒）。 */
const EMIT_INTERVAL = 120

/**
 * 自动档并发数：按本机 CPU 核心数取，钳在 [2, 8]。
 *
 * 用 `availableParallelism()` 而不是 `cpus().length`：前者尊重容器的 CPU 配额，
 * 在受限环境里不会一口气开出远超实际算力的连接数。老运行时不提供它时回落 `cpus()`。
 */
function autoDownloadThreads(): number {
    let cores: number
    try {
        cores = os.availableParallelism?.() ?? os.cpus().length
    } catch {
        return AUTO_DOWNLOAD_THREADS_MIN
    }
    if (!Number.isFinite(cores) || cores < 1) return AUTO_DOWNLOAD_THREADS_MIN
    return Math.min(AUTO_DOWNLOAD_THREADS_MAX, Math.max(AUTO_DOWNLOAD_THREADS_MIN, Math.floor(cores)))
}

/**
 * 归一化并发数：
 *  - 'auto' / 缺省 → 按核心数自适应；
 *  - 非法数字（非有限值、小于 1）→ 同 'auto'（设置里手滑也不至于退化成 0 并发）；
 *  - 合法数字 → 上限 MAX。
 */
function normalizeDownloadThreads(n: unknown): number {
    if (n === 'auto' || n === undefined || n === null || n === '') return autoDownloadThreads()
    const v = Math.floor(Number(n))
    if (!Number.isFinite(v) || v < 1) return autoDownloadThreads()
    return Math.min(MAX_DOWNLOAD_THREADS, v)
}

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

/** node:stream 的 web ReadableStream 参数类型（避免 any）。 */
type WebBody = Parameters<typeof Readable.fromWeb>[0]

/** 静默关闭响应体（探测阶段用不到内容）。 */
async function cancelBody(res: Response): Promise<void> {
    try {
        await res.body?.cancel()
    } catch {
        /* 已关闭 / 已锁定 */
    }
}

/**
 * 把响应体写进文件，并按块回报字节数。
 *
 * 这里显式监听取消信号并在中止时 `destroy()` 读流：不能只依赖网络层是否响应 AbortSignal，
 * 否则一旦底层不理会 signal，取消就会挂住直到整段下载完。
 */
async function pumpBody(
    body: unknown,
    signal: AbortSignal,
    write: NodeJS.WritableStream,
    onChunk: (len: number) => void
): Promise<void> {
    const src = Readable.fromWeb(body as WebBody)
    const onAbort = (): void => {
        src.destroy(new Error('canceled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    src.on('data', (chunk: Buffer) => onChunk(chunk.length))
    try {
        await pipeline(src, write)
    } finally {
        signal.removeEventListener('abort', onAbort)
    }
}

/** 探测总大小与是否支持 Range。 */
async function probe(scope: HttpScope, url: string, signal: AbortSignal): Promise<{ total: number; ranges: boolean }> {
    const res = await httpFetch(scope, url, { headers: { Range: 'bytes=0-0' }, signal })
    if (res.status === 206) {
        const total = Number((res.headers.get('content-range') ?? '').split('/').pop() ?? 0)
        await cancelBody(res)
        return { total, ranges: total > 0 }
    }
    const len = Number(res.headers.get('content-length') ?? 0)
    await cancelBody(res)
    return { total: Number.isFinite(len) && len > 0 ? len : 0, ranges: false }
}

/** 下载过程中的累计状态与速度平滑参数。 */
interface DlState {
    total: number
    downloaded: number
    speed: number
    lastEmit: number
    lastBytes: number
    lastTime: number
}

/** 生成节流的进度上报函数（速度用指数滑动平均，避免进度条数字乱跳）。 */
function makeReporter(emit: (p: DlProgress) => void, state: DlState): (force?: boolean) => void {
    return (force = false): void => {
        const now = Date.now()
        if (!force && now - state.lastEmit < EMIT_INTERVAL) return
        const dt = Math.max(1, now - state.lastTime) / 1000
        const inst = (state.downloaded - state.lastBytes) / dt
        state.speed = state.speed > 0 ? state.speed * 0.65 + inst * 0.35 : inst
        state.lastEmit = now
        state.lastBytes = state.downloaded
        state.lastTime = now
        emit({
            total: state.total,
            downloaded: state.downloaded,
            percent: state.total > 0 ? Math.min(100, (state.downloaded / state.total) * 100) : 0,
            speed: Math.max(0, state.speed)
        })
    }
}

/** 通用重试：失败后退避重试若干次（信号已中止则不再重试）。 */
async function withRetry<T>(fn: () => Promise<T>, attempts: number, signal: AbortSignal): Promise<T> {
    let last: unknown
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn()
        } catch (err) {
            last = err
            if (signal.aborted || i === attempts) break
            await delay(400 * i)
        }
    }
    throw last
}

/** 单流下载到目标文件（服务器不支持 Range / 文件较小 / 并发=1 时使用）。 */
async function singleStream(
    scope: HttpScope,
    url: string,
    file: string,
    signal: AbortSignal,
    state: DlState,
    report: (force?: boolean) => void
): Promise<void> {
    const res = await httpFetch(scope, url, { signal })
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
    const len = Number(res.headers.get('content-length') ?? 0)
    if (Number.isFinite(len) && len > 0) state.total = len
    await pumpBody(res.body, signal, fs.createWriteStream(file, { flags: 'w' }), (n) => {
        state.downloaded += n
        report()
    })
}

/** 下载 [start, end] 区间到目标文件的对应偏移；断流后从断点续传。 */
async function rangeStream(
    scope: HttpScope,
    url: string,
    file: string,
    start: number,
    end: number,
    signal: AbortSignal,
    state: DlState,
    report: (force?: boolean) => void
): Promise<void> {
    let pos = start
    let attempt = 0
    while (pos <= end) {
        try {
            const res = await httpFetch(scope, url, { headers: { Range: 'bytes=' + pos + '-' + end }, signal })
            if (res.status !== 206 || !res.body) {
                await cancelBody(res)
                throw new Error('HTTP ' + res.status)
            }
            let written = pos
            await pumpBody(res.body, signal, fs.createWriteStream(file, { flags: 'r+', start: pos }), (n) => {
                written += n
                state.downloaded += n
                report()
            })
            pos = written
        } catch (err) {
            if (signal.aborted) throw err
            attempt += 1
            if (attempt > MAX_RETRY) throw err
            await delay(300 * attempt)
        }
    }
}

/** 预分配目标文件（分段写入需要文件已存在且长度足够）。 */
function preallocate(file: string, size: number): void {
    const fd = fs.openSync(file, 'w')
    try {
        fs.ftruncateSync(fd, size)
    } finally {
        fs.closeSync(fd)
    }
}

/** 把临时文件搬到最终位置；跨盘时 rename 会失败，退回拷贝再删源。 */
async function moveFile(from: string, to: string): Promise<void> {
    try {
        fs.renameSync(from, to)
    } catch {
        // 跨盘退回拷贝：用 promise 版，避免大安装包同步拷把主进程独占住。
        await fs.promises.copyFile(from, to)
        await removeQuietly(from)
    }
}

/** 执行一次真实下载（不做去重）；进度同时派发给所有订阅者。 */
async function runDownload(
    o: DownloadFileOpts,
    fileName: string,
    finalPath: string,
    subscribers: Set<(p: DlProgress) => void>
): Promise<DlResult> {
    // 临时文件独立存放，避免在目标目录留下半成品；下载完成再搬到最终位置。
    const tmpDir = o.tmpDir ?? o.destDir
    const tmpPath = path.join(tmpDir, fileName + '.download')
    const threads = normalizeDownloadThreads(o.threads)
    /** 代理范围：Node 发行包与 npm/dsh 包分属两档（见 http.ts）。 */
    const scope: HttpScope = o.proxyScope ?? 'npm'
    const ctrl = new AbortController()
    // 外部的取消信号（取消按钮）联动到本地控制器；已取消则立即中止。
    if (o.signal) {
        if (o.signal.aborted) ctrl.abort()
        else o.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
    }
    const state: DlState = { total: 0, downloaded: 0, speed: 0, lastEmit: 0, lastBytes: 0, lastTime: Date.now() }
    const report = makeReporter((p) => {
        for (const fn of subscribers) fn(p)
    }, state)

    try {
        await fs.promises.mkdir(o.destDir, { recursive: true })
        await fs.promises.mkdir(tmpDir, { recursive: true })
        await removeQuietly(tmpPath)
        await removeQuietly(finalPath)

        const { total, ranges } = await withRetry(() => probe(scope, o.url, ctrl.signal), MAX_RETRY, ctrl.signal)
        state.total = total
        const segmented = ranges && threads > 1 && total >= MIN_SEGMENT_BYTES

        if (!segmented) {
            await withRetry(
                () => {
                    state.downloaded = 0
                    return singleStream(scope, o.url, tmpPath, ctrl.signal, state, report)
                },
                MAX_RETRY,
                ctrl.signal
            )
        } else {
            preallocate(tmpPath, total)
            const chunkSize = Math.ceil(total / threads)
            const jobs: Array<Promise<void>> = []
            for (let i = 0; i < threads; i++) {
                const start = i * chunkSize
                if (start >= total) break
                const end = Math.min(start + chunkSize - 1, total - 1)
                jobs.push(rangeStream(scope, o.url, tmpPath, start, end, ctrl.signal, state, report))
            }
            await Promise.all(jobs)
        }

        report(true)
        await moveFile(tmpPath, finalPath)
        return { ok: true }
    } catch (err) {
        await removeQuietly(tmpPath)
        await removeQuietly(finalPath)
        if (ctrl.signal.aborted) return { ok: false, canceled: true, message: '操作已取消' }
        return { ok: false, message: errorMessage(err) }
    }
}

/**
 * 下载一个文件到 destDir/fileName（默认多线程）。
 *
 * 同一目标文件的重复请求会合并：在途期间再次调用不会重新下载，而是订阅同一份进度并等待
 * 同一个结果。成功返回 ok=true；失败会清理临时文件并返回 ok=false 与错误信息。
 */
export async function downloadFile(o: DownloadFileOpts): Promise<DlResult> {
    const fileName = o.fileName ?? fileNameFromUrl(o.url)
    const finalPath = path.join(o.destDir, fileName)
    const key = downloadKey(o.destDir, fileName)
    const running = inFlightDownloads.get(key)
    if (running) {
        if (o.onProgress) running.subscribers.add(o.onProgress)
        return running.promise
    }
    const subscribers = new Set<(p: DlProgress) => void>()
    if (o.onProgress) subscribers.add(o.onProgress)
    const promise = runDownload(o, fileName, finalPath, subscribers)
    const entry: InFlight = {
        subscribers,
        promise: promise.finally(() => {
            if (inFlightDownloads.get(key) === entry) inFlightDownloads.delete(key)
        })
    }
    inFlightDownloads.set(key, entry)
    return entry.promise
}

/** 去重键：最终文件的绝对路径小写（Windows 大小写不敏感）。 */
function downloadKey(destDir: string, fileName: string): string {
    return path.resolve(path.join(destDir, fileName)).toLowerCase()
}
