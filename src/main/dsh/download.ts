import path from 'node:path'
import { errorMessage } from '@shared/errors'
import { download as kernelDownload } from '../download'
import type { DownloadProgress, DownloadResult } from '../download/types'

/**
 * 内核侧的**下载门面** —— 内核所有「下一个文件到磁盘」的调用都从这里走。
 *
 * ## 为什么还要有这一层
 *
 * 下载实现已在 `src/main/download/`（引擎 + 任务层，含断点续传、限速、队列持久化、
 * 任务可见）。本文件保留为**门面**，原因是：
 *
 *  - 调用方（`dsh/nodeenv` / `npmRunner` / `pnpmRunner`）只关心「给我把文件下下来」，
 *    不该知道任务表、限速器这些概念；
 *  - **去重留在这里** —— 下载模块是任务表，一次请求就是一个任务；而内核侧的调用方
 *    天然会出现「并发请求同一个目标文件」，那会在同一个 `.part` 上打架。
 *    门面把同目标的并发请求合并成一次、后到者订阅同一份进度。
 *
 * ## 历史上的一层间接已消失
 *
 * 门面原先还要「按约定名查扩展能力槽、查不到回落内核兜底实现」（下载曾在内置扩展
 * `xeonsky.download` 里，而扩展可被用户停用）。下载下沉内核后不再有那个状态，
 * 回落分支与兜底实现（原 `dsh/downloader.ts`）一并删除 —— 现在只有一条实现路径。
 */

/** 下载进度（形状与 `download/types.ts` 的 `DownloadProgress` 一致）。 */
export type DlProgress = DownloadProgress

/** 一次阻塞式下载的入参。 */
export interface DownloadFileOpts {
    url: string
    destDir: string
    fileName?: string
    /** 临时文件目录；缺省用下载模块自己的临时目录。 */
    tmpDir?: string
    onProgress?: (p: DlProgress) => void
    /** 外部取消信号（安装流程的 CancelToken）；中止时清理临时文件并返回 canceled=true。 */
    signal?: AbortSignal
    /**
     * 走哪一档「代理范围」（见 http.ts）：Node 发行包用 'node'，npm / dsh 的包用 'npm'。
     * 缺省 'npm'（历史上下载只服务于 npm 包）。
     */
    proxyScope?: 'npm' | 'node'
}

/** 一次下载的结果。 */
export type DlResult = { ok: boolean; message?: string; canceled?: boolean }

/** 在途下载（去重）：键为最终文件的绝对路径。 */
interface InFlight {
    subscribers: Set<(p: DlProgress) => void>
    promise: Promise<DlResult>
}

const inFlight = new Map<string, InFlight>()

/** 去重键：最终文件的绝对路径（Windows 路径大小写不敏感，统一小写）。 */
function keyOf(destDir: string, fileName: string): string {
    return path.resolve(path.join(destDir, fileName)).toLowerCase()
}

/** 真正发起一次下载（已去重）。 */
async function run(o: DownloadFileOpts): Promise<DlResult> {
    try {
        const r: DownloadResult = await kernelDownload(o)
        return { ok: r.ok === true, message: r.message, canceled: r.canceled === true }
    } catch (err) {
        return { ok: false, message: errorMessage(err) }
    }
}

/**
 * 下载一个文件到 `destDir/fileName`。
 *
 * 同一目标文件的并发调用合并为一次：在途期间再次调用不会重新下载，
 * 而是订阅同一份进度并等待同一个结果。
 */
export async function downloadFile(o: DownloadFileOpts): Promise<DlResult> {
    const fileName = o.fileName ?? ''
    if (!fileName) return run(o)
    const key = keyOf(o.destDir, fileName)
    const running = inFlight.get(key)
    if (running) {
        if (o.onProgress) running.subscribers.add(o.onProgress)
        return running.promise
    }
    const subscribers = new Set<(p: DlProgress) => void>()
    if (o.onProgress) subscribers.add(o.onProgress)
    const promise = run({ ...o, onProgress: subscribers.size ? (p) => {
        for (const fn of subscribers) fn(p)
    } : undefined })
    const entry: InFlight = {
        subscribers,
        promise: promise.finally(() => {
            if (inFlight.get(key) === entry) inFlight.delete(key)
        })
    }
    inFlight.set(key, entry)
    return entry.promise
}
