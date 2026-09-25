import { httpFetch, type HttpScope } from '../../../dsh/http'
import { downloadFile } from '../../../dsh/downloader'
import type { DownloadThreads } from '@shared/types'
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
    },
    /**
     * 下载**二进制文件**到磁盘。
     *
     * `fetch` 只回文本，二进制（压缩包、可执行文件）经它必然失真 —— 所以单列一个动作，
     * 直接复用内核的 `dsh/downloader.ts`（多线程 Range 分段 / 代理感知 / 进度 / 重试 /
     * 临时文件 + 原子落位）。扩展若自己拿 `fetch` 再写盘，会绕开这一整套，
     * 这正是不把裸 fetch 暴露出去的原因。
     *
     * 代理档位：下载器只认它历史上的两档（npm / node），故这里也只为它暴露这两档，
     * 缺省交给下载器自己决定（'npm'）。
     *
     * @returns 成功与否、取消标志、失败信息与落盘后的绝对路径
     */
    download: async (options: {
        url: string
        destDir: string
        fileName?: string
        threads?: DownloadThreads
        proxyScope?: 'npm' | 'node'
    }): Promise<{ ok: boolean; canceled?: boolean; message?: string; file: string }> => {
        const fileName = options.fileName ?? ''
        const result = await downloadFile({
            url: options.url,
            destDir: options.destDir,
            fileName: fileName || undefined,
            threads: options.threads,
            proxyScope: options.proxyScope
        })
        // 不依赖 downloader 内部如何推断文件名：落位路径由「目录 + 实际文件名」拼回来。
        const name = fileName || new URL(options.url).pathname.split('/').filter(Boolean).pop() || ''
        return { ...result, file: name ? `${options.destDir}/${decodeURIComponent(name)}` : options.destDir }
    }
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'net', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info('capability provided: net (actions: fetch, fetchJson, download)')
}
