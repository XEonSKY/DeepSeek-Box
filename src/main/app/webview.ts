import os from 'node:os'
import { app, session } from 'electron'
import type { Settings } from '@shared/types'
import { loadSettings } from './settings'
import { proxyActive, proxyUrl } from '../dsh/net'
import { proxyConfigFor } from '../dsh/http'

/**
 * Webview（内嵌页面）相关的渲染与身份设置：硬件加速开关 + UserAgent + 代理。
 *
 * 作用范围：内嵌 `<webview>` 用的是 **defaultSession**（见 appupdate.ts 里那段注释：自更新
 * 刻意只改 `partition: 'electron-updater'`，不动 defaultSession，所以 webview 不受它影响），
 * 因此 UA 与代理设到 `session.defaultSession` 就正好命中所有 webview，而不会波及自更新。
 */

/** Chromium 的 WebKit 兼容标记：真实 Chrome/Electron 一直发 537.36，与版本无关。 */
const WEBKIT_TOKEN = '537.36'

/**
 * UA 里的平台段，按各平台真实 Chrome 的写法生成：
 *  - Windows：`Windows NT 10.0; Win64; x64`（NT 版本取 `os.release()` 的主次版本）
 *  - macOS：`Macintosh; Intel Mac OS X 10_15_7` —— Chrome 自 Catalina 起就把这个串冻住了，
 *    即使 Apple Silicon 也照发，所以这里写死而不去猜 Darwin 版本到产品版本的映射
 *  - Linux：`X11; Linux x86_64` / `aarch64`
 */
function platformToken(platform: string, arch: string, osRelease: string): string {
    if (platform === 'win32') {
        const nt = /^(\d+\.\d+)/.exec(osRelease)?.[1] ?? '10.0'
        const cpu = arch === 'arm64' ? 'Win64; ARM64' : arch === 'ia32' ? 'WOW64' : 'Win64; x64'
        return `Windows NT ${nt}; ${cpu}`
    }
    if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7'
    const cpu = arch === 'arm64' ? 'aarch64' : arch === 'ia32' ? 'i686' : 'x86_64'
    return `X11; Linux ${cpu}`
}

/** 默认 UserAgent：Mozilla/5.0 (平台) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<Chromium> Safari/537.36 XEonSKY/<程序版本>。 */
export function defaultUserAgent(): string {
    const plat = platformToken(process.platform, process.arch, os.release())
    const chrome = process.versions.chrome ?? '0.0.0.0'
    return `Mozilla/5.0 (${plat}) AppleWebKit/${WEBKIT_TOKEN} (KHTML, like Gecko) Chrome/${chrome} Safari/${WEBKIT_TOKEN} XEonSKY/${app.getVersion()}`
}

/** 实际生效的 UA：设置里留空就用默认。 */
export function effectiveUserAgent(cfg: Settings = loadSettings()): string {
    const custom = (cfg.webviewUserAgent || '').trim()
    return custom || defaultUserAgent()
}

/** 已应用到 defaultSession 的值（幂等用）。 */
let appliedUa = ''

/**
 * 把 UA 应用到 webview 所在的 defaultSession。**必须在 `app.whenReady()` 之后调用**
 * （`session.defaultSession` 在 ready 前拿不到），且要在建窗之前 —— 这样 webContents 一创建
 * 拿到的就是它。值没变时什么都不做。
 */
export function applyWebviewUserAgent(cfg: Settings = loadSettings()): void {
    const ua = effectiveUserAgent(cfg)
    if (ua === appliedUa) return
    try {
        session.defaultSession.setUserAgent(ua)
        appliedUa = ua
    } catch {
    /* ready 之前调用会抛：忽略，启动流程里 ready 后还会再调一次 */
    }
}

/**
 * 硬件加速开关。**必须在 `app ready` 之前调用**（Electron 限制，之后调用无效），
 * 所以它只在启动时读一次设置 —— 改动它必须重启应用，UI 里也是这么提示的。
 */
export function applyHardwareAcceleration(cfg: Settings = loadSettings()): void {
    if (cfg.hardwareAcceleration === false) app.disableHardwareAcceleration()
}

// ---------------------------------------------------------------------------
// 内嵌网页的代理（「程序本体」范围）
// ---------------------------------------------------------------------------

/** 已应用到 defaultSession 的代理 URL；null = 从未显式设置（沿用系统代理）。 */
let appliedProxy: string | null = null

/**
 * 把「程序本体」范围的代理应用到 webview 所在的 defaultSession。
 *
 * 这一档覆盖的是**应用自己的浏览**：home 页 / 标签页里打开的外部网站。dsh 界面跑在
 * 127.0.0.1 上，由 proxyConfigFor() 的 `<local>` 绕过规则保证永远直连 —— 否则代理一开，
 * 内嵌界面会连自己都请求不到。
 *
 * 与更新器 session 同样的克制：未启用代理时**不调用 setProxy**，保留 Electron 默认的
 * 「跟随系统代理」，只有从「有」变「无」时才显式回落 system。
 *
 * 返回 Promise：`setProxy` 是异步生效的，建窗 / 保存设置时应当 await，
 * 否则「设置了代理后的第一批请求」仍会按旧配置发出去。
 */
export async function applyWebviewProxy(cfg: Settings = loadSettings()): Promise<void> {
    const url = proxyActive(cfg, 'app') ? proxyUrl(cfg) : null
    if (appliedProxy === url) return
    // 先登记再 await：并发的两次调用不会因为 await 顺序颠倒而把状态记反。
    appliedProxy = url
    try {
        await session.defaultSession.setProxy(proxyConfigFor(url))
    } catch {
    /* ready 之前调用会抛：撤销登记，启动流程里 ready 后还会再调一次 */
        appliedProxy = null
    }
}
