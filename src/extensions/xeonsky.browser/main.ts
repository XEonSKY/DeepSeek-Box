import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { MessageBoxOptions, WebContents } from 'electron'
import type { ExtContext } from '@main/extensions/loader/ctx'
import { buildSearchUrl, normalizeEngine, normalizeShortcuts } from './shared'
import type { SearchEngineId, Shortcut } from './shared'

/**
 * 内置扩展 `xeonsky.browser` —— 内嵌页面（webview）功能的**主进程侧**实现。
 *
 * ## 迁自哪里
 *
 * 本文件承接原内核里的两处，**规则未改**：
 *  - `app/webview.ts` 的 UA 生成与「应用 UA / 代理 / 装权限处理器」；
 *  - `app/webviewPermissionPolicy.ts` 的整套权限判定（含 `PermissionMemory`）。
 *
 * 内核侧只保留**机制**：系统扩展 `system.webview` 把 defaultSession 的操作包成
 * `webview` 能力，本扩展经 `ctx.capabilities.call('webview', …)` 使用 ——
 * 依赖方向仍是 扩展 → 能力面 → 内核，扩展不 import 内核实现（见 AGENTS.md 红线）。
 *
 * ## 与「窗口级 webview 机制」的分工
 *
 * `webviewTag`、阻止嵌套、弹窗挂载（右键菜单 / 快捷键）、真正 `new BrowserWindow` 这些属
 * **窗口机制**，由内核建窗时决定（`app/ui.ts`）—— 它们是「窗口怎么建」，与「页面怎么配」
 * 是两层；且外壳整个内容区（含 dsh Web UI）本身靠 `<webview>` 渲染，属核心通路，不能被
 * 可停用的扩展拿掉。本扩展只接管后者，外加窗口级的**纯策略**：弹窗尺寸解析与「真弹窗 vs
 * 应用内新标签」的判定（见下方「窗口级 webview 策略」段），内核经门面 `app/webview.ts` 查询。
 *
 * ## 设置存在哪
 *
 * UA 这一项原先存在内核 `Settings.webviewUserAgent` 里。迁到本扩展后，它改为存在
 * **扩展自己的数据目录**（`ctx.dataDir/config.json`）—— 扩展不再伸手进内核设置结构，
 * 内核也就不必为「浏览器」这个可选功能保留一个字段（停用该扩展后设置里也不该残留）。
 * 与 `xeonsky.download` 的 `config.json` 同一套做法。
 *
 * ## 硬件加速为什么不在本文件
 *
 * 它必须早于 `app.whenReady()`，而扩展激活在其之后 —— 因此由内核**预读 manifest**
 * 的 `preReady` 落地（见 `main/extensions/preready.ts`）。本扩展的 manifest 里
 * 保留该字段作为归属声明。
 */

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 本扩展的设置。 */
export interface BrowserConfig {
    /**
     * 内嵌页面的 UserAgent；**留空 = 用按平台/版本生成的默认 UA**。
     *
     * 之所以允许自定义：部分站点按 UA 分流（给「不支持的浏览器」降级甚至拒绝服务），
     * 用户需要能伪装成别的浏览器版本。
     */
    userAgent: string
    /**
     * 地址栏输入不是网址时使用的默认搜索引擎。
     *
     * 它**只影响地址栏**（浏览器的惯例：地址栏既能开网址也能搜）——
     * 导航页那个输入框是纯「跳转」语义，不读这一项（见 `resolveTarget`）。
     */
    searchEngine: SearchEngineId
    /** 导航页上的常用站点快捷方式。 */
    shortcuts: Shortcut[]
}

export const DEFAULT_CONFIG: BrowserConfig = { userAgent: '', searchEngine: 'bing', shortcuts: [] }

// ---------------------------------------------------------------------------
// UserAgent 生成（迁自 app/webview.ts，逻辑未改）
// ---------------------------------------------------------------------------

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

/**
 * 默认 UserAgent：`Mozilla/5.0 (平台) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<Chromium> Safari/537.36 XEonSKY/<应用版本>`。
 *
 * @param appVersion 应用版本号（由内核在激活时经 IPC 注入；扩展不 import `app`）。
 */
export function defaultUserAgent(appVersion: string): string {
    const plat = platformToken(process.platform, process.arch, os.release())
    const chrome = process.versions.chrome ?? '0.0.0.0'
    return `Mozilla/5.0 (${plat}) AppleWebKit/${WEBKIT_TOKEN} (KHTML, like Gecko) Chrome/${chrome} Safari/${WEBKIT_TOKEN} XEonSKY/${appVersion}`
}

// ---------------------------------------------------------------------------
// 权限策略（迁自 app/webviewPermissionPolicy.ts，规则未改）
// ---------------------------------------------------------------------------

/** 三态判定：放行 / 拒绝 / 交给用户确认。 */
export type PermissionVerdict = 'grant' | 'deny' | 'ask'

/**
 * 外部站点也直接放行的权限 —— 常规浏览真正需要、且不触碰本机设备与隐私的那一批。
 *
 * 特别说明 `mediaKeySystem`：受保护内容（Netflix 等 DRM 视频）没有它直接播不了，
 * 而它拿到的是一个解密密钥句柄而非设备权限，因此归在放行档。
 */
const BROWSER_GRANTS: readonly string[] = [
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'keyboardLock',
    'local-fonts',
    'mediaKeySystem',
    'pointerLock',
    'speaker-selection',
    'storage-access',
    'top-level-storage-access',
    'background-sync'
]

/** 外部站点访问前必须先问用户的权限：涉及本机设备或位置，浏览器同样会弹权限条。 */
const BROWSER_ASKS: readonly string[] = ['media', 'geolocation', 'notifications', 'midi', 'midiSysex']

/** 权限对应的文案键后缀；`media` 由媒体类型细分，见 {@link permissionKindKey}。 */
const KIND_KEY: Readonly<Record<string, string>> = {
    media: 'cameraMic',
    geolocation: 'location',
    notifications: 'notifications',
    midi: 'midi',
    midiSysex: 'midi'
}

/**
 * 本机回环地址上的界面算可信来源。
 *
 * 为什么把回环整个算可信：dsh 界面本身就跑在 `127.0.0.1` 上（端口每次启动都变，不能只认
 * 某一个），用户的本地开发服务同理 —— 它们都在本机，与「桌面应用自己的界面」同一信任级。
 * 外部站点拿不到回环来源，所以这条放宽不会把外部页面变成可信。
 */
export function isTrustedRequestingUrl(value: string): boolean {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        return false
    }
    // 外壳自带的页面（打包后是 file:）与自定义协议：等同应用自身。
    if (url.protocol === 'file:' || url.protocol === 'app:') return true
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host.endsWith('.localhost')
}

/** 单个权限的判定；`requestingUrl` 为空（拿不到来源）时按外部站点处理。 */
export function decidePermission(permission: string, requestingUrl: string): PermissionVerdict {
    if (requestingUrl && isTrustedRequestingUrl(requestingUrl)) return 'grant'
    if (BROWSER_GRANTS.includes(permission)) return 'grant'
    if (BROWSER_ASKS.includes(permission)) return 'ask'
    return 'deny'
}

/** `media` 按媒体类型细分文案（只读摄像头 / 只读麦克风 / 两者）。 */
export function permissionKindKey(permission: string, mediaTypes?: readonly string[]): string {
    if (permission === 'media' && Array.isArray(mediaTypes) && mediaTypes.length > 0) {
        const audio = mediaTypes.includes('audio')
        const video = mediaTypes.includes('video')
        if (audio && !video) return 'microphone'
        if (video && !audio) return 'camera'
    }
    return KIND_KEY[permission] ?? 'unknown'
}

/** 取来源（用于「同一来源 + 同一权限只问一次」的记忆键）；无法解析时返回空串。 */
export function originOf(requestingUrl: string): string {
    try {
        return new URL(requestingUrl).origin
    } catch {
        return ''
    }
}

/**
 * 会话级的「记住选择」：同一个来源 + 同一个权限只问一次。
 *
 * 刻意**不落盘**：一次运行内的重复请求不该反复弹窗，但「允许某站点用摄像头」不该成为永久
 * 授权 —— 重启后重新询问，与浏览器的会话级授权一致，也避免为此改设置结构（设置结构变更
 * 必须升 `settingsVersion` 并保证向后兼容）。
 */
export class PermissionMemory {
    private readonly decided = new Map<string, boolean>()

    /** 已记住的结论；没问过返回 undefined。 */
    recall(origin: string, permission: string): boolean | undefined {
        return this.decided.get(`${origin}\u0000${permission}`)
    }

    /** 记住用户的选择。 */
    remember(origin: string, permission: string, granted: boolean): void {
        this.decided.set(`${origin}\u0000${permission}`, granted)
    }

    /** 清空（测试与调试用）。 */
    clear(): void {
        this.decided.clear()
    }
}

/**
 * 同步的「检查」路径（`navigator.permissions.query`、设备枚举等）用的判定。
 *
 * 它**不能**弹窗（回调是同步布尔），所以：直接放行的返回 true，直接拒绝的返回 false，
 * 「该问用户」的在没有记忆时先按**拒绝** —— 这样设备标签、位置状态在用户授权前不会泄露，
 * 真正的授权仍然由 request 路径（`getUserMedia` 等）触发询问。
 */
export function checkPermission(
    permission: string,
    requestingUrl: string,
    memory: PermissionMemory
): boolean {
    const verdict = decidePermission(permission, requestingUrl)
    if (verdict === 'grant') return true
    if (verdict === 'deny') return false
    return memory.recall(originOf(requestingUrl), permission) === true
}

// ---------------------------------------------------------------------------
// 窗口级 webview 策略（迁自 app/ui.ts 的纯逻辑部分，规则未改）
// ---------------------------------------------------------------------------
//
// 只迁**判定规则**，不迁**机制**：`webviewTag`、`did-attach-webview` 挂处理器、
// 阻止嵌套、真正 `new BrowserWindow` 都留在内核 `app/ui.ts` —— 因为外壳的整个内容区
// （含 dsh Web UI 固定站）都靠 `<webview>` 渲染，属**核心通路**；一旦交给可停用的扩展，
// 用户停用本扩展就会让内容区白屏。而「多大算弹窗、什么时候开新标签」是纯策略，可以迁。
//
// 内核经门面 `app/webview.ts` 查询本处规则（`actionsOf('ext:xeonsky.browser')`）。

/** 弹窗尺寸夹取：非正数视为「未指定」，其余夹到 [300, 1600]。 */
export function clampPopupPx(n: number): number {
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.max(300, Math.min(1600, Math.round(n)))
}

/** 从 window.open 的 features 提取宽高（默认用 900x720，越界按 clampPopupPx 收拢）。 */
export function parsePopupSize(features: string): { width: number; height: number } {
    const out = { width: 900, height: 720 }
    const mW = /(?:^|,)width=(\d+)/i.exec(features)
    const mH = /(?:^|,)height=(\d+)/i.exec(features)
    const w = mW ? clampPopupPx(Number(mW[1])) : 0
    const h = mH ? clampPopupPx(Number(mH[1])) : 0
    if (w) out.width = w
    if (h) out.height = h
    return out
}

/** 弹窗特征：带 frameName 或 features 视为真弹窗（开独立窗口），否则按普通新标签链接处理。 */
export function isPopupRequest(frameName: string, features: string): boolean {
    return !!frameName || !!features
}

/**
 * 一次 webview 内 target=_blank / window.open 的处置决策。
 *
 *  - `popup`：真弹窗（带 frameName/features）→ 内核开独立窗口；
 *  - `tab`：普通链接 → 应用内新标签页；
 *  - `external`：**本扩展不该接管** —— 非 http(s)（mailto: / tel: / 自定义协议等），
 *    交系统默认程序处理。
 *
 * 注意这里**没有**「扩展不可用」这一档：那是内核的兜底（`app/webview.ts` 查不到本扩展时
 * 一律返回 `external`）。判定规则只在扩展里有一份，内核只负责「查不到就外部打开」。
 */
export function decideOpenAction(url: string, frameName: string, features: string): 'external' | 'popup' | 'tab' {
    if (!/^https?:/i.test(url)) return 'external'
    return isPopupRequest(frameName, features) ? 'popup' : 'tab'
}

// ---------------------------------------------------------------------------
// 输入解析（地址栏 / 导航页的「跳转」语义）
// ---------------------------------------------------------------------------
//
// 「用户敲的这一行是什么」属**浏览策略**，随功能一起迁到本扩展：
// 内核只把原文递进来，拿回「该加载哪个 URL」或「该交给系统」。
//
// 语义是**跳转**而非搜索：能当网址解析的一律当网址。只有当它明显不是网址时，
// 才按配置的默认搜索引擎拼一条搜索 URL —— 这一条是「地址栏」的浏览器惯例，
// 与导航页那个纯跳转的输入框是两回事（导航页直接用 `resolveTarget`）。

/** 一次输入解析的结果。 */
export type ResolveResult =
    /** 应在内嵌页面里加载该 URL。 */
    | { kind: 'url'; url: string }
    /** 不是内嵌页面能处理的目标（非 http(s) 协议）→ 交系统默认程序。 */
    | { kind: 'external'; url: string }
    /** 空输入，什么都不做。 */
    | { kind: 'none' }

/** URL 的协议前缀（`https:` / `mailto:` …）。 */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

/** 像主机名的输入（`example.com` / `www.example.com` / `a.b.c`）。 */
const HOSTNAME_RE = /^[\w-]+(\.[\w-]+)+(\/.*)?$/

/**
 * 把一行输入解析成内嵌页面可加载的 URL。
 *
 * 规则（**跳转优先**）：
 *  1. 带协议：http(s) 直接加载；其余（mailto: / tel: / 自定义）交系统；
 *  2. 形如主机名（`example.com`）→ 补 `https://`；
 *  3. 其余 → 用默认搜索引擎拼搜索 URL（浏览器的地址栏惯例）。
 *
 * @param raw 用户输入原文（未 trim）
 * @param engine 默认搜索引擎（来自本扩展的配置）
 */
export function resolveAddressInput(raw: string, engine: SearchEngineId): ResolveResult {
    const s = raw.trim()
    if (!s) return { kind: 'none' }
    const scheme = SCHEME_RE.exec(s)
    if (scheme) {
        const proto = scheme[1].toLowerCase()
        if (proto === 'http' || proto === 'https' || proto === 'about') return { kind: 'url', url: s }
        return { kind: 'external', url: s }
    }
    if (HOSTNAME_RE.test(s)) return { kind: 'url', url: `https://${s}` }
    return { kind: 'url', url: buildSearchUrl(engine, s) }
}

/**
 * 把一行输入解析成**纯跳转**目标（导航页的输入框用）。
 *
 * 与 {@link resolveAddressInput} 的唯一差别：不是网址就**不猜**，直接补 `https://` 当作域名
 * 去试 —— 导航页的输入框是「跳转」，不做搜索。
 */
export function resolveTarget(raw: string): ResolveResult {
    const s = raw.trim()
    if (!s) return { kind: 'none' }
    const scheme = SCHEME_RE.exec(s)
    if (scheme) {
        const proto = scheme[1].toLowerCase()
        if (proto === 'http' || proto === 'https' || proto === 'about') return { kind: 'url', url: s }
        return { kind: 'external', url: s }
    }
    return { kind: 'url', url: `https://${s}` }
}

// ---------------------------------------------------------------------------
// 激活
// ---------------------------------------------------------------------------

/** 会话级「记住选择」：同一来源 + 同一权限只问一次（重启后重新询问，不落盘）。 */
const permissionMemory = new PermissionMemory()

/** 权限询问串行化：多个站点同时请求时不该叠出一堆系统弹窗。 */
let promptQueue: Promise<unknown> = Promise.resolve()

function queuePrompt(task: () => Promise<boolean>): Promise<boolean> {
    const next = promptQueue.then(task, task)
    promptQueue = next.catch(() => undefined)
    return next
}

/**
 * 权限文案：`<来源> 想使用 <权限>`。
 *
 * 内联英文而不是走外壳 i18n：权限弹窗是**系统级对话框**（`dialog.showMessageBox`），
 * 由主进程直接构造，不经过渲染层的 i18n 运行时；而扩展数据目录里的设置并没有
 * 「该用哪种语言」的信息。保持英文是与内核原实现一致的做法
 * （原实现用的是 `mt('m.webviewPerm.*')`，迁移后该键随功能一起撤出内核文案表）。
 */
function permissionLabel(permission: string, mediaTypes?: readonly string[]): string {
    const kind = permissionKindKey(permission, mediaTypes)
    const labels: Record<string, string> = {
        cameraMic: 'camera and microphone',
        camera: 'camera',
        microphone: 'microphone',
        location: 'your location',
        notifications: 'notifications',
        midi: 'MIDI devices',
        unknown: 'this permission'
    }
    return labels[kind] ?? labels.unknown
}

/** 弹系统询问框问用户；拿不到宿主窗口时用无父窗口的对话框。弹不出来按拒绝。 */
async function askPermission(
    contents: WebContents | null,
    permission: string,
    requestingUrl: string,
    mediaTypes: readonly string[] | undefined,
    appTitle: string
): Promise<boolean> {
    const options: MessageBoxOptions = {
        type: 'question',
        title: appTitle,
        message: `${originOf(requestingUrl)} wants to use ${permissionLabel(permission, mediaTypes)}`,
        detail: requestingUrl,
        buttons: ['Allow', 'Deny'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
    }
    const parent = contents ? BrowserWindow.fromWebContents(contents) : null
    try {
        const { response } = parent && !parent.isDestroyed()
            ? await dialog.showMessageBox(parent, options)
            : await dialog.showMessageBox(options)
        return response === 0
    } catch {
        return false
    }
}

/**
 * 激活本扩展。
 *
 * 与内核原实现相比，唯一的结构差异是：UA / 代理 / 权限处理器现在经**能力面**设置，
 * 而不是直接 `session.defaultSession`（那属内核）。判定规则与调用时机完全一致。
 */
export function activate(ctx: ExtContext): void {
    /**
     * 应用版本号：由内核在建窗之前经 `applySession(version, appTitle)` 送进来。
     * 扩展不 import `electron` 的 `app`（那属内核），故版本号只能从外面给进来。
     * 未送入时用一个占位值，UA 里会显示成 `XEonSKY/0.0.0` —— 只在极早的时序窗口出现。
     */
    let appVersion = '0.0.0'

    /** 能力面调用薄包装：按动作名分发，缺能力时抛错由调用方捕获。 */
    const cap = <T>(action: string, ...args: unknown[]): T =>
        ctx.capabilities.call<T>('webview', action, ...args as never[])

    /** 文件能力薄包装（读扩展自己的配置）。 */
    const fsCall = <T>(action: string, ...args: unknown[]): T =>
        ctx.capabilities.call<T>('fs', action, ...args as never[])

    // ---- 配置存储 ------------------------------------------------------------

    const configPath = path.join(ctx.dataDir, 'config.json')

    function loadConfig(): BrowserConfig {
        const raw = fsCall<string | null>('readIfExists', configPath)
        if (!raw) return { ...DEFAULT_CONFIG }
        try {
            const parsed = JSON.parse(raw) as Partial<BrowserConfig>
            return {
                userAgent: typeof parsed.userAgent === 'string' ? parsed.userAgent : '',
                searchEngine: normalizeEngine(parsed.searchEngine),
                shortcuts: normalizeShortcuts(parsed.shortcuts)
            }
        } catch {
            // 配置损坏不该拖垮扩展：回落到默认。
            return { ...DEFAULT_CONFIG }
        }
    }

    function saveConfig(next: BrowserConfig): void {
        fsCall('write', configPath, JSON.stringify(next, null, 4))
    }

    let cfg = loadConfig()

    /** 当前生效的 UA：自定义优先，留空用默认。 */
    function effectiveUserAgent(): string {
        const custom = (cfg.userAgent || '').trim()
        return custom || defaultUserAgent(appVersion)
    }

    // ---- 应用设置到会话 ------------------------------------------------------

    /**
     * 把 UA / 代理 / 权限策略应用到 defaultSession。
     *
     * **由内核在建窗之前调用**（UA 与权限处理器必须早于建窗，否则先建出来的 webview
     * 拿到的是「未装处理器 = 默认放行一切」的策略）。
     */
    async function applySession(version: string, appTitle: string): Promise<{ ua: string; proxy: string | null }> {
        // 内核把应用版本号送进来（扩展不 import `app`），顺便记下供设置页展示的默认 UA。
        if (version) appVersion = version
        const ua = effectiveUserAgent()
        try {
            cap<boolean>('setUserAgent', ua)
        } catch (err) {
            ctx.log.warn(`setUserAgent failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        let proxy: string | null = null
        try {
            proxy = (await cap<Promise<string | null>>('applyProxy')) ?? null
        } catch (err) {
            ctx.log.warn(`applyProxy failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        try {
            cap<void>('installPermissionHandlers', check, onRequest(appTitle))
        } catch (err) {
            ctx.log.warn(`installPermissionHandlers failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        return { ua, proxy }
    }

    /** 同步检查回调（`navigator.permissions.query` / 设备枚举）。 */
    function check(permission: string, requestingOrigin: string): boolean {
        return checkPermission(permission, requestingOrigin, permissionMemory)
    }

    /** 异步请求回调（`getUserMedia` 等会真正弹窗的那条路径）。 */
    function onRequest(appTitle: string): (
        permission: string,
        url: string,
        mediaTypes: readonly string[] | undefined
    ) => Promise<boolean> {
        return (permission, url, mediaTypes) => {
            const verdict = decidePermission(permission, url)
            if (verdict === 'grant') return Promise.resolve(true)
            if (verdict === 'deny') return Promise.resolve(false)
            const origin = originOf(url)
            const remembered = permissionMemory.recall(origin, permission)
            if (remembered !== undefined) return Promise.resolve(remembered)
            return queuePrompt(async () => {
                // 系统对话框由能力面在请求回调里提供宿主 WebContents 时才能挂父窗口；
                // 这里走无父窗口路径（与内核原实现的「拿不到宿主窗口」分支同一行为）。
                const granted = await askPermission(null, permission, url, mediaTypes, appTitle)
                permissionMemory.remember(origin, permission, granted)
                return granted
            })
        }
    }

    // ---- 对外提供的动作 ------------------------------------------------------

    ctx.provides.register('xeonsky.browser', {
        /** 应用 UA / 代理 / 权限策略（内核在建窗前调用；版本号与标题由内核传入）。 */
        applySession: (version: string, appTitle: string) => applySession(version, appTitle),
        /**
         * 重新应用代理（代理设置变化时内核调用）。
         *
         * 代理仍属内核设置（`Settings.proxy*`）—— 它是个跨范围的概念（dsh 子进程 / 程序本体），
         * 不适合拆进单个扩展。所以这里只做「把当前设置里的程序本体代理应用到会话」，
         * 值由能力面 `applyProxy` 自己读设置。
         */
        reapplyProxy: async (): Promise<string | null> => {
            try {
                return (await cap<Promise<string | null>>('applyProxy')) ?? null
            } catch (err) {
                ctx.log.warn(`reapplyProxy failed: ${err instanceof Error ? err.message : String(err)}`)
                return null
            }
        },
        /** 默认 UA（供设置页展示）。 */
        defaultUserAgent: (): string => defaultUserAgent(appVersion),
        /** 当前配置。 */
        getConfig: (): BrowserConfig => ({ ...cfg }),
        /** 权限判定的对外查询（调试 / 别的扩展自查）。 */
        decidePermission: (permission: string, url: string): PermissionVerdict => decidePermission(permission, url),
        /**
         * 窗口级 webview 的**纯策略**（内核 `app/ui.ts` 经门面调用）。
         *
         * 机制（webviewTag / 挂处理器 / 建弹窗窗）仍在核心里，这里只回答两个判定问题。
         */
        /** 从 features 解析弹窗尺寸。 */
        parsePopupSize: (features: string) => parsePopupSize(features),
        /** 一次 window.open 的处置决策。 */
        decideOpenAction: (url: string, frameName: string, features: string) =>
            decideOpenAction(url, frameName, features),
        /**
         * 地址栏输入解析（浏览器惯例：网址就跳、否则按默认引擎搜）。
         *
         * 内核只递原文、拿结论 —— 「用户敲的这一行是什么意思」是浏览策略，
         * 随功能一起留在本扩展。
         */
        resolveAddressInput: (raw: string): ResolveResult => resolveAddressInput(raw, cfg.searchEngine),
        /** 导航页的纯跳转解析（不搜索）。 */
        resolveTarget: (raw: string): ResolveResult => resolveTarget(raw)
    })

    // ---- 渲染层 IPC ----------------------------------------------------------

    /** 设置页读取：当前配置 + 默认 UA + 应用版本（默认 UA 里含版本号，便于展示对照）。 */
    const readState = (): { config: BrowserConfig; defaultUserAgent: string; appVersion: string } => ({
        config: { userAgent: cfg.userAgent, searchEngine: cfg.searchEngine, shortcuts: cfg.shortcuts.map((s) => ({ ...s })) },
        defaultUserAgent: defaultUserAgent(appVersion),
        appVersion
    })

    ctx.ipc.handle('config', () => readState())
    ctx.ipc.handle('setConfig', (patch: unknown) => {
        const p = (patch ?? {}) as Partial<BrowserConfig>
        cfg = {
            userAgent: typeof p.userAgent === 'string' ? p.userAgent : cfg.userAgent,
            searchEngine: p.searchEngine === undefined ? cfg.searchEngine : normalizeEngine(p.searchEngine),
            shortcuts: p.shortcuts === undefined ? cfg.shortcuts : normalizeShortcuts(p.shortcuts)
        }
        saveConfig(cfg)
        // UA 变化立即生效（无需重启）：重新应用到 defaultSession。
        cap<boolean>('setUserAgent', effectiveUserAgent())
        return readState()
    })

    ctx.log.info('xeonsky.browser activated')
}
