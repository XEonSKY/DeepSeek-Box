import path from 'node:path'
import { errorMessage } from '@shared/errors'
import { logger } from '../kernel/logger'
import { actionsOf } from '../extensions/loader/capability'
import { downloadFile as fallbackDownloadFile, type DownloadFileOpts, type DlProgress, type DlResult } from './downloader'

/**
 * 内核侧的**下载门面** —— 内核所有「下一个文件到磁盘」的调用都从这里走。
 *
 * ## 为什么要有这一层
 *
 * 下载能力已经迁到内置扩展 `xeonsky.download`（断点续传、限速、队列持久化、任务可见）。
 * 但内核不能直接 `import` 一个扩展 —— 那等于内核依赖一个**可被用户停用**的东西，
 * 且方向与「扩展依赖内核」相反。
 *
 * 于是按加载器已有的惯例（见 `extensions/loader/index.ts` 里查 `ext:xeonsky.extm`）：
 * 内核不 import 扩展，而是**按约定名查能力槽**。查到就用扩展，查不到就回落到
 * `downloader.ts` 的内核实现。这样两边都不必知道对方的代码，装配关系在能力槽里。
 *
 * ## 为什么保留回落
 *
 * `dsh/nodeenv` 装 Node 运行时是应用的**核心路径**，而内置扩展是可以被停用的
 * （也受崩溃计数与安全模式影响）。若扩展一停用就整体失效，用户等于进了死路。
 * 回落是「缺失即降级」这条策略在下载上的体现 —— 代价是少了续传与限速，
 * 但核心功能不中断，且回落时会打一条 warn 让问题在开发期暴露。
 *
 * ## 去重
 *
 * 与旧的 `downloader.ts` 一样：同一目标文件的并发请求合并成一次下载，
 * 后到者订阅同一份进度。扩展侧不去重（它是任务表，一次请求就是一个任务），
 * 所以去重留在这一层 —— 否则两个并发请求会写同一个 `.part`。
 */

const log = logger('[Download]')

/** 下载能力的约定名（由内置扩展 `xeonsky.download` 提供）。 */
const DOWNLOAD_CAPABILITY = 'ext:xeonsky.download'

/** 扩展 `download` 动作的形状（与 `xeonsky.download` 的 DownloadFileOptions 对齐）。 */
type ExtDownload = (o: DownloadFileOpts) => Promise<DlResult>

/** 在途下载（去重）：键为最终文件的绝对路径。 */
interface InFlight {
    subscribers: Set<(p: DlProgress) => void>
    promise: Promise<DlResult>
}

const inFlight = new Map<string, InFlight>()

/** 取扩展的下载动作；不可用返回 null。 */
function extDownload(): ExtDownload | null {
    const table = actionsOf(DOWNLOAD_CAPABILITY)
    const fn = table?.['download']
    return typeof fn === 'function' ? (fn as unknown as ExtDownload) : null
}

/** 去重键：最终文件的绝对路径（Windows 路径大小写不敏感，统一小写）。 */
function keyOf(destDir: string, fileName: string): string {
    return path.resolve(path.join(destDir, fileName)).toLowerCase()
}

/** 真正发起一次下载（已去重）。 */
async function run(o: DownloadFileOpts): Promise<DlResult> {
    const ext = extDownload()
    if (!ext) {
        log.warn('download extension unavailable, falling back to kernel downloader')
        return fallbackDownloadFile(o)
    }
    try {
        const r = await ext(o)
        // 扩展的返回可能带 `file`，内核契约不需要它；这里只保留三个已知字段，
        // 避免把扩展的内部形状继续往下传。
        return { ok: r.ok === true, message: r.message, canceled: r.canceled === true }
    } catch (err) {
        return { ok: false, message: errorMessage(err) }
    }
}

/**
 * 下载一个文件到 `destDir/fileName`。
 *
 * 优先经 `ext:xeonsky.download`（可续传、可限速、在下载面板里可见），
 * 扩展不可用时回落到内核下载器。同一目标文件的并发调用合并为一次。
 */
export async function downloadFile(o: DownloadFileOpts): Promise<DlResult> {
    const fileName = o.fileName ?? ''
    if (!fileName) return fallbackDownloadFile(o)
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
