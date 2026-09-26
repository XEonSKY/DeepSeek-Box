import { Readable } from 'node:stream'
import { httpFetch, type HttpScope } from '../../../dsh/http'
import { provideActions } from '../../loader/capability'
import type { ExtContext } from '../../loader/ctx'

/**
 * 系统扩展 `system.net` —— 把主进程的 HTTP 入口包装成能力。
 *
 * 内核的约定是「主进程 HTTP 一律走 `dsh/http.ts` 的 `httpFetch`」，原因是它按 scope
 * 绑定各自的 Electron session（代理、UA、Cookie 分区都跟着设置走）。若让外部扩展
 * 直接用全局 `fetch`，就会绕开这套策略 —— 表现为「设置了代理但扩展的请求不走代理」。
 *
 * 所以能力面把 scope 收窄成固定几档，扩展只能决定 URL 与请求参数，不能自选 session。
 *
 * ## 关于 `download`
 *
 * 历史上这里有一个 `download` 动作（转发内核的 `dsh/downloader.ts`）。它已经**移除**：
 * 下载能力整体迁到了内置扩展 `xeonsky.download`（分段、断点续传、限速、队列持久化、
 * 任务可见都只在扩展里才有）。需要下载的扩展请申请能力 `ext:xeonsky.download`，
 * 用 `ctx.capabilities.call('ext:xeonsky.download', 'download', { ... })`。
 *
 * 不保留转发的原因是分层：系统能力是「内核的门面」，内置扩展是「门面之上的实现」。
 * 让 `system.net` 反过来依赖一个内置扩展，会把这条方向弄反。
 */

/** 流式请求允许自选的代理档位（'registry' 只服务注册表查询，不下发）。 */
type StreamScope = Extract<HttpScope, 'app' | 'npm' | 'node'>

/** 一次流式响应的形状（刻意不给 Response 本体：那会把 Electron session 的细节漏出去）。 */
interface StreamedResponse {
    ok: boolean
    status: number
    headers: Record<string, string>
    /** 响应体（Node 可读流）；无体时为 null。 */
    body: Readable | null
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

/** 收窄档位：不认识的档位一律按 'app' 处理（扩展请求归入应用来源）。 */
function normalizeScope(scope: unknown): StreamScope {
    return scope === 'npm' || scope === 'node' ? scope : 'app'
}

/** 把 Headers 摊成小写键的普通对象（Header 名按规范已归一为小写）。 */
function headersOf(res: Response): Record<string, string> {
    const out: Record<string, string> = {}
    res.headers.forEach((value, key) => {
        out[key] = value
    })
    return out
}

/** 允许的动作。 */
const actions = {
    /**
     * 发一次 HTTP 请求。
     *
     * 返回体只给扩展「需要且安全」的部分：状态码、头、文本。
     * 不返回 Response 对象本身 —— 那会把 Electron session 的细节漏出去。
     */
    fetch: async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
        ok: boolean
        status: number
        headers: Record<string, string>
        text: string
    }> => {
        const res = await httpFetch('app' as HttpScope, url, {
            method: init?.method,
            headers: init?.headers,
            body: init?.body
        })
        return { ok: res.ok, status: res.status, headers: headersOf(res), text: await res.text() }
    },
    /** 只取 JSON（失败返回 null，省去扩展到处写 try/catch）。 */
    fetchJson: async (url: string): Promise<unknown | null> => {
        try {
            const res = await httpFetch('app' as HttpScope, url)
            if (!res.ok) return null
            return (await res.json()) as unknown
        } catch {
            return null
        }
    },
    /**
     * 发一次**流式**请求（可带 `Range`），返回 Node 可读流。
     *
     * 存在的理由：`fetch` 只能拿文本，而下载器要按偏移写盘、要边下边算速度 ——
     * 必须拿到字节流。但也不能把 `Response` 本体给扩展（会把 session 细节漏出去），
     * 所以给一个 Node 侧的 `Readable`：它只是一个字节管道，不含任何连接信息。
     *
     * 代理档位只对下载有意义，故只开放 `app` / `npm` / `node` 三档；
     * 请求仍然经 `httpFetch`，于是「设置 → 网络 → 代理」对下载照常生效。
     *
     * 调用方**必须**消费或销毁返回的流：不读 body 会让连接悬挂。
     */
    stream: async (url: string, init?: { headers?: Record<string, string>; scope?: StreamScope; signal?: AbortSignal }): Promise<StreamedResponse> => {
        const res = await httpFetch(normalizeScope(init?.scope), url, {
            method: 'GET',
            headers: init?.headers,
            signal: init?.signal
        })
        return { ok: res.ok, status: res.status, headers: headersOf(res), body: toNodeReadable(res) }
    }
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'net', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info(`capability provided: net (actions: ${Object.keys(actions).join(', ')})`)
}
