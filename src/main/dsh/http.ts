import { session } from 'electron'
import type { ProxyConfig, Session } from 'electron'
import type { Settings } from '@shared/types'
import { loadSettings } from '../app/settings'
import { proxyActive, proxyUrl } from './net'

/**
 * 主进程自身发出的 HTTP 请求入口（代理生效的地方）。
 *
 * 背景：Node 的全局 `fetch` **不读** `HTTP_PROXY` 之类的环境变量，`net.ts` 的 `proxyEnv()`
 * 也只作用于 npm / node / dsh 子进程。于是「设置 → 网络 → 代理」过去只覆盖 npm 子进程，
 * 主进程自己的注册表查询、Node 发行包索引与**所有文件下载**都在直连——在必须走代理
 * 才能出网的环境里表现为「装了代理却查不到版本、下载超时」。
 *
 * 做法：按「代理范围」各建一个独立 partition 的 session 并在上面 `setProxy()`，
 * 请求经该 session 的 `fetch()` 发出（走 Chromium 网络栈，与 <webview> 的 defaultSession 隔离）。
 * 未启用代理时不调用 setProxy 的等价物、而是显式回落 `mode: 'system'`，保留系统代理。
 */

/**
 * 走本模块发出请求的范围。其余范围各有自己的出口，不经过这里：
 *  - 'app'      主进程自身联网（见 app/models.ts）；
 *  - 'update'   应用自更新（专属 session 'electron-updater'，见 app/appupdate.ts）；
 *  - 'dsh'      dsh 子进程（环境变量，见 dsh/dsh.ts 与 net.ts 的 proxyEnv）。
 */
export type HttpScope = 'app' | 'npm' | 'node' | 'registry'

const SESSION_NAME: Record<HttpScope, string> = {
    app: 'dsbox-http-app',
    npm: 'dsbox-http-npm',
    node: 'dsbox-http-node',
    registry: 'dsbox-http-registry'
}

/** 已实际写入每个 session 的代理 URL（null = 跟随系统）；避免每次请求都重复 setProxy。 */
const appliedProxy = new Map<HttpScope, string | null>()

/**
 * 由代理 URL 生成 Electron 的 ProxyConfig。
 *
 * 三个用到代理的出口（本模块的 session、webview 的 defaultSession、更新器的专属 session）
 * 共用它，避免三处的绕过规则各写一遍而出现分歧：`<local>` 让 127.0.0.1 / localhost
 * **永远直连** —— 内嵌的 dsh 界面就跑在本地回环上，走代理会直接把自己打坏。
 */
export function proxyConfigFor(url: string | null): ProxyConfig {
    return url ? { proxyRules: url, proxyBypassRules: '<local>' } : { mode: 'system' }
}

/** 取该类别对应的 session，并在代理设置变化时同步。 */
async function sessionFor(scope: HttpScope, cfg: Settings): Promise<Session> {
    const ses = session.fromPartition(SESSION_NAME[scope], { cache: false })
    const url = proxyUrl(cfg)
    if (appliedProxy.get(scope) !== url) {
        await ses.setProxy(proxyConfigFor(url))
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
    if (!proxyActive(cfg, scope)) return fetch(url, init)
    const ses = await sessionFor(scope, cfg)
    return ses.fetch(url, init)
}
