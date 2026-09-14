import { session } from 'electron'
import type { Session } from 'electron'
import type { Settings } from '@shared/types'
import { loadSettings } from '../app/settings'
import { proxyUrl } from './net'

/**
 * 主进程自身发出的 HTTP 请求入口（代理生效的地方）。
 *
 * 背景：Node 的全局 `fetch` **不读** `HTTP_PROXY` 之类的环境变量，`net.ts` 的 `proxyEnv()`
 * 也只作用于 npm / node 子进程。于是「设置 → 网络 → 代理」过去只覆盖 npm 子进程，
 * 主进程自己的注册表查询、Node 发行包索引与**所有文件下载**都在直连——在必须走代理
 * 才能出网的环境里表现为「装了代理却查不到版本、下载超时」。
 *
 * 做法：按「代理范围」各建一个独立 partition 的 session 并在上面 `setProxy()`，
 * 请求经该 session 的 `fetch()` 发出（走 Chromium 网络栈，与 <webview> 的 defaultSession 隔离）。
 * 未启用代理时不调用 setProxy 的等价物、而是显式回落 `mode: 'system'`，保留系统代理。
 */

/** 请求类别 → 对应「代理范围」设置。registry 是 npm 与 update 两个范围的并集。 */
export type HttpScope = 'npm' | 'node' | 'registry'

const SESSION_NAME: Record<HttpScope, string> = {
    npm: 'dsbox-http-npm',
    node: 'dsbox-http-node',
    registry: 'dsbox-http-registry'
}

/** 已实际写入每个 session 的代理 URL（null = 跟随系统）；避免每次请求都重复 setProxy。 */
const appliedProxy = new Map<HttpScope, string | null>()

/**
 * 该请求类别在当前设置下是否走代理。
 * - npm：npm 安装 / 下载；node：Node 下载部署；
 * - registry：注册表查询同时服务于「npm 安装/下载」与「DeepSeek Harness 更新检查」，两者任一勾选即走代理。
 */
function scopeEnabled(cfg: Settings, scope: HttpScope): boolean {
    if (scope === 'registry') return cfg.proxyScope.includes('npm') || cfg.proxyScope.includes('update')
    return cfg.proxyScope.includes(scope)
}

/** 取该类别对应的 session，并在代理设置变化时同步。 */
async function sessionFor(scope: HttpScope, cfg: Settings): Promise<Session> {
    const ses = session.fromPartition(SESSION_NAME[scope], { cache: false })
    const url = proxyUrl(cfg)
    if (appliedProxy.get(scope) !== url) {
        await ses.setProxy(url ? { proxyRules: url, proxyBypassRules: '<local>' } : { mode: 'system' })
        appliedProxy.set(scope, url)
    }
    return ses
}

/**
 * 按类别发起请求；返回标准 Response（`body` 是 web ReadableStream，可直接 `Readable.fromWeb`）。
 *
 * **只有在对应范围启用了代理时才切换到 Chromium 网络栈**：未启用代理时沿用 Node 的全局
 * `fetch`，与改动前完全一致——这样「下载路径换网络栈」的行为差异只影响显式配置了代理的用户，
 * 而那正是他们需要代理的场景。（每次调用读一次设置，只在代理 URL 变化时才写 session，
 * 因此设置改动无需额外挂钩子。）
 */
export async function httpFetch(scope: HttpScope, url: string, init?: RequestInit): Promise<Response> {
    const cfg = loadSettings()
    if (!scopeEnabled(cfg, scope)) return fetch(url, init)
    const ses = await sessionFor(scope, cfg)
    return ses.fetch(url, init)
}
