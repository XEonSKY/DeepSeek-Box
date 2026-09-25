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
 * 所以能力面把 scope 收窄成固定的 `'app'`（扩展请求归入应用来源），
 * 扩展只能决定 URL 与请求参数，不能自选 session。
 */

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
        const headers: Record<string, string> = {}
        res.headers.forEach((value, key) => {
            headers[key] = value
        })
        return { ok: res.ok, status: res.status, headers, text: await res.text() }
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
    }
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'net', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info('capability provided: net (actions: fetch, fetchJson)')
}
