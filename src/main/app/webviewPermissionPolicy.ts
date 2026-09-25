/**
 * 内嵌页面（webview / 标签页）的权限策略 —— **纯逻辑**，不 import electron，便于单测。
 *
 * 为什么需要它：Electron 在**没有安装处理器**时默认放行权限请求，而 dsbox 的标签页里跑的
 * 是任意站点 —— 等于把摄像头、麦克风、地理位置、HID / 串口 / USB 全交给网页决定。
 *
 * 官方 desktop 对它的内嵌浏览器是一律拒绝（permission request/check 全 false + 设备权限
 * false + 显示捕获拒绝）；那是「受控侧栏浏览器」的取舍，dsbox 是**通用外壳**，一刀切会误伤
 * 正常站点（dsh 自己的实验性语音输入插件就要用麦克风），所以按来源分两档：
 *
 *  - 可信来源（本机回环上的界面，含 dsh 的 127.0.0.1）→ 放行，等同桌面应用；
 *  - 外部站点 → 只放行常规浏览所需（`BROWSER_GRANTS`），设备与隐私类交给**用户确认**
 *    （`BROWSER_ASKS`，浏览器里也是弹权限条），其余一律拒绝。
 *
 * 未列入任何名单的权限按**拒绝**处理：新权限随 Chromium 升级出现时默认安全。要放开某个
 * 新权限，把它加进 `BROWSER_GRANTS`（直接放行）或 `BROWSER_ASKS`（先问用户）。
 */

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

/** 权限对应的文案键后缀（`m.webviewPerm.*`）；`media` 由媒体类型细分，见 {@link permissionKindKey}。 */
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
