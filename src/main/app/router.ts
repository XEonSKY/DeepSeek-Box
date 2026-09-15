import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
    IPC_REQUEST_CHANNEL,
    type BodyOfRoute,
    type HttpMethod,
    type IpcRequest,
    type PathParams,
    type PathOf,
    type QueryOfRoute,
    type ResultOfRoute,
    type RouteAt,
    type RouteKey,
    type RoutesByPath
} from '@shared/api'

/**
 * 极简的 Elysia 风格路由引擎：把 IPC 当成一个 REST 服务。
 *
 * ```ts
 * router
 *     .get('/settings', () => loadSettings())
 *     .put('/settings', ({ body }) => saveSettings(body))
 *     .delete('/versions/:kind/:version', ({ params }) => remove(params.kind, params.version))
 * ```
 *
 * - 方法 + 路径（含 `:name` 路径参数）匹配；路径参数由客户端 URL 编码、这里解码。
 * - 全部路由经由唯一通道 `ipc:request` 进来（`ipcRenderer.invoke`），返回 Promise。
 * - 入参 / 出参类型来自 `@shared/api` 的 `ApiRoutes`：调用点写错路径、传错 body、
 *   返回类型对不上都会在编译期报错。
 */

/** 一次请求的上下文。 */
export interface RouteContext<Key extends RouteKey> {
    /** 发起请求的 IPC 事件，用 `event.sender.id` 可定位「哪个壳窗口」发起的。 */
    event: IpcMainInvokeEvent
    /** 路径参数（已解码），如 `/versions/:kind` 的 `{ kind }`。 */
    params: Record<PathParams<PathOf<Key>>, string>
    /** 查询参数。 */
    query: QueryOfRoute<Key>
    /** 请求体。 */
    body: BodyOfRoute<Key>
}

/** 路由处理函数：同步或异步均可，返回值即响应。 */
export type RouteHandler<Key extends RouteKey> =
    (context: RouteContext<Key>) => ResultOfRoute<Key> | Promise<ResultOfRoute<Key>>

/** 内部登记项（对外只暴露强类型的链式方法）。 */
interface RouteEntry {
    segments: string[]
    handler: (context: RouteContext<RouteKey>) => unknown
}

/** 把路径拆成非空段：`/a/b` → `['a', 'b']`。 */
function splitPath(path: string): string[] {
    return path.split('/').filter((segment) => segment.length > 0)
}

/** 解码路径参数；非法转义时退回原串（不因为一个坏参数让整条请求 500）。 */
function decodeParam(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

export class Router {
    private readonly table: Record<HttpMethod, RouteEntry[]> = {
        GET: [],
        POST: [],
        PUT: [],
        PATCH: [],
        DELETE: []
    }

    get<Path extends keyof RoutesByPath<'GET'>>(path: Path, handler: RouteHandler<RouteAt<'GET', Path>>): this {
        return this.add('GET', path, handler)
    }

    post<Path extends keyof RoutesByPath<'POST'>>(path: Path, handler: RouteHandler<RouteAt<'POST', Path>>): this {
        return this.add('POST', path, handler)
    }

    put<Path extends keyof RoutesByPath<'PUT'>>(path: Path, handler: RouteHandler<RouteAt<'PUT', Path>>): this {
        return this.add('PUT', path, handler)
    }

    patch<Path extends keyof RoutesByPath<'PATCH'>>(path: Path, handler: RouteHandler<RouteAt<'PATCH', Path>>): this {
        return this.add('PATCH', path, handler)
    }

    delete<Path extends keyof RoutesByPath<'DELETE'>>(path: Path, handler: RouteHandler<RouteAt<'DELETE', Path>>): this {
        return this.add('DELETE', path, handler)
    }

    /** 在唯一通道上开始接收请求（`ipcRenderer.invoke` 对应 `ipcMain.handle`）。 */
    listen(channel: string = IPC_REQUEST_CHANNEL): void {
        ipcMain.handle(channel, (event, request: unknown) => this.handle(event, request as IpcRequest))
    }

    /** 分发一次请求：找到路由就执行，找不到就抛错（渲染层的 Promise 会 reject）。 */
    async handle(event: IpcMainInvokeEvent, request: IpcRequest): Promise<unknown> {
        const method = request?.method
        const path = typeof request?.path === 'string' ? request.path : ''
        const found = this.match(method, path)
        if (!found) throw new Error(`未知的 IPC 路由：${String(method)} ${path}`)
        return found.handler({
            event,
            params: found.params as never,
            query: (request.query ?? {}) as never,
            body: request.body as never
        })
    }

    private add(method: HttpMethod, path: string, handler: unknown): this {
        this.table[method].push({
            segments: splitPath(path),
            handler: handler as (context: RouteContext<RouteKey>) => unknown
        })
        return this
    }

    /** 先找「全字面量」匹配，再找带参数的匹配，避免 `/icons/current` 被 `/icons/:id` 抢走。 */
    private match(method: HttpMethod, path: string): { handler: RouteEntry['handler']; params: Record<string, string> } | null {
        if (!method || !(method in this.table)) return null
        const segments = splitPath(path)
        const entries = this.table[method]
        const parameterized: RouteEntry[] = []
        for (const entry of entries) {
            if (entry.segments.length !== segments.length) continue
            if (!entry.segments.some((segment) => segment.startsWith(':'))) {
                if (entry.segments.every((segment, index) => segment === segments[index])) {
                    return { handler: entry.handler, params: {} }
                }
                continue
            }
            parameterized.push(entry)
        }
        for (const entry of parameterized) {
            const params: Record<string, string> = {}
            let matched = true
            for (let index = 0; index < segments.length; index++) {
                const template = entry.segments[index]
                if (template.startsWith(':')) params[template.slice(1)] = decodeParam(segments[index])
                else if (template !== segments[index]) {
                    matched = false
                    break
                }
            }
            if (matched) return { handler: entry.handler, params }
        }
        return null
    }
}
