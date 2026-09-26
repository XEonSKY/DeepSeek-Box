import { defineModule } from '../kernel/module'
import { logger } from '../kernel/logger'
import { broadcast } from '../kernel/runtime'
import { cancel, create, download, list, onProgress, pause, remove, resume, setConfig, shutdownDownloads, start, status } from '../download'
import type { DownloadConfig } from '../download/types'
import type { CreateDownloadOptions } from '@shared/download'

/**
 * 「下载」内核模块 —— 把下载模块（`main/download/`）的端点面接进 IPC。
 *
 * ## 为什么下载有内核端点
 *
 * 下载曾是内置扩展 `xeonsky.download`，那时它用**扩展自己的 DIY 通道**
 * （`ext:xeonsky.download:*`）与面板通信 —— 扩展端点不占 `ApiRoutes` 契约，正是那种场景的用途。
 *
 * 下载下沉内核后情况反过来了：它是内核的一部分，它的端点就是**内核内置端点**，
 * 该进 `shared/api.ts` 的契约表（类型检查、渲染层的 `api.get/post` 都跟着走）。
 * 于是这里用的是与其它模块相同的 `defineModule` 形状，而不是扩展的 `ctx.ipc`。
 *
 * ## 进度推送
 *
 * 任务进度经 `download:progress` 事件推给全部窗口（内核对渲染层的统一推送方式）。
 * 下载模块自己不 import electron，推送出口在这里注入 —— 与日志出口同一种做法。
 */

const log = logger('[Download]')

/** 进程退出前把在跑的任务落成 paused，并中止它们。 */
export default defineModule({
    id: 'download',
    routes: {
        GET: {
            '/download': () => status()
        },
        POST: {
            '/download/tasks': ({ body }) => create((body ?? {}) as CreateDownloadOptions),
            '/download/tasks/:id/start': ({ params }) => start(params.id),
            '/download/tasks/:id/pause': ({ params }) => pause(params.id),
            '/download/tasks/:id/resume': ({ params }) => resume(params.id),
            '/download/tasks/:id/cancel': ({ params }) => cancel(params.id)
        },
        PUT: {
            '/download/config': ({ body }) => setConfig((body ?? {}) as Partial<DownloadConfig>)
        },
        DELETE: {
            '/download/tasks/:id': ({ params, query }) => remove(params.id, query?.['deleteFile'] === true)
        }
    },
    onReady() {
        // 下载模块不 import electron（保持可独立测试），推送出口在这里注入。
        onProgress((payload) => {
            broadcast('download:progress', payload)
        })
        log.info('download module ready')
    },
    onQuit() {
        // 中止在跑任务：不中止的话进程退出后临时文件没人接手。
        // `.part` 保留，下次启动会恢复成 paused 还能续。
        try {
            shutdownDownloads()
        } catch (err) {
            log.warn({ err }, 'failed to shut down downloads')
        }
    }
})

/** 供其它内核模块直接调用（不经 IPC）：阻塞式下载。 */
export { download, list }
