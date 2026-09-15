import { contextBridge, ipcRenderer } from 'electron'
import { IPC_EVENT_CHANNEL, IPC_REQUEST_CHANNEL } from '@shared/api'
import type { AppEvents, HttpMethod, IpcEvent, IpcRequest, RendererApi } from '@shared/api'

/**
 * 渲染层看到的 IPC 客户端：一个 REST 风格的门面。
 *
 * 每次调用都被打包成 `{ method, path, query?, body? }` 的请求信封，经唯一通道
 * `ipc:request` 发给主进程的路由表；主进程推送则经 `ipc:event` 回来，按事件名分发。
 *
 * ```ts
 * window.api.get('/settings')
 * window.api.put('/settings', { body: settings })
 * window.api.get('/versions/:kind', { params: { kind: 'node' } })
 * const off = window.api.on('settings:changed', (s) => { ... })
 * ```
 */

/** 路径模板里的 `:name` 占位符。 */
const PARAM_PATTERN = /:([A-Za-z0-9_]+)/g

/** 请求可选项：路径参数 / 查询参数 / 请求体。 */
interface RequestOptions {
    params?: Record<string, string>
    query?: Record<string, unknown>
    body?: unknown
}

/** 把路径模板里的 `:name` 替换成 URL 编码后的实参（`user/a.png` → `user%2Fa.png`）。 */
function buildPath(template: string, params?: Record<string, string>): string {
    if (!params) return template
    return template.replace(PARAM_PATTERN, (raw, name: string) => {
        const value = params[name]
        return value === undefined ? raw : encodeURIComponent(value)
    })
}

/** 统一发一次请求。 */
function request(method: HttpMethod, template: string, options?: RequestOptions): Promise<unknown> {
    const envelope: IpcRequest = { method, path: buildPath(template, options?.params) }
    if (options?.query) envelope.query = options.query
    if (options && 'body' in options) envelope.body = options.body
    return ipcRenderer.invoke(IPC_REQUEST_CHANNEL, envelope)
}

/** 订阅一个主进程事件，返回退订函数。 */
function on<Event extends keyof AppEvents>(event: Event, callback: (payload: AppEvents[Event]) => void): () => void {
    const listener = (_e: unknown, envelope: IpcEvent): void => {
        if (envelope && envelope.event === event) callback(envelope.payload as AppEvents[Event])
    }
    ipcRenderer.on(IPC_EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, listener)
}

const api = {
    // 本地常量：无需 IPC，直接从 preload 的进程信息里读。
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome
    },

    // ---- REST 客户端 ----
    get: (path: string, options?: RequestOptions) => request('GET', path, options),
    post: (path: string, options?: RequestOptions) => request('POST', path, options),
    put: (path: string, options?: RequestOptions) => request('PUT', path, options),
    patch: (path: string, options?: RequestOptions) => request('PATCH', path, options),
    delete: (path: string, options?: RequestOptions) => request('DELETE', path, options),

    // ---- 主进程 → 渲染层事件订阅 ----
    on
} as unknown as RendererApi

contextBridge.exposeInMainWorld('api', api)
