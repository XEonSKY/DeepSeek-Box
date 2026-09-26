import { app } from 'electron'
import type { ResolveResult, Settings } from '@shared/types'
import { logger } from '../kernel/logger'
import { actionsOf } from '../extensions/loader/capability'

/**
 * 内核侧的**内嵌浏览器门面** —— 内嵌页面（webview）的会话设置都从这里走。
 *
 * ## 为什么只剩下这一层
 *
 * webview 功能（UA 生成、代理应用、权限策略判定）已迁到内置扩展 `xeonsky.browser`
 * （见 `src/extensions/xeonsky.browser/`）。内核不能直接 `import` 一个扩展 ——
 * 那等于内核依赖一个**可被用户停用**的东西，且方向与「扩展依赖内核」相反。
 *
 * 于是按加载器已有的惯例（见 `dsh/download.ts` 的门面）：内核不 import 扩展，
 * 而是**按约定名查能力槽**。查到就用扩展，查不到就降级为「不配置会话」
 * （内嵌页面用 Electron 默认行为）并打 warn。
 *
 * ## 为什么降级不是回落一份实现
 *
 * 与下载不同，webview 的会话设置**没有必须保住的核心路径**：扩展被停用时内嵌页面
 * 用 Electron 默认策略（默认放行权限、默认 UA）也能跑，只是安全性/兼容性打折。
 * 为此在内核里再留一份权限判定实现，等于把刚迁出去的东西又复制回来（两份实现必然漂移），
 * 违背迁移初衷。故这里只做转发 + 降级告警。
 *
 * 唯一保留内联实现的是 `parsePopupSize`（纯几何计算，没有「策略」可言）。
 * 而 `decideOpenAction` / `resolveAddressInput` / `resolveTarget` 的降级是**行为切换**：
 * 扩展不可用时一律「交系统默认浏览器」—— 这正是用户要的规则（浏览器扩展关掉，
 * 就不再由外壳承担浏览），不是把策略复制一份回来。
 *
 * ## 时机约束（别改）
 *
 * 本函数必须在 `startLoader()` **之后**（扩展才已激活）、`createShellWindow()`
 * **之前**调用 —— 晚于建窗的话，先建出来的 webview 拿到的是「未装处理器 = 默认放行一切」。
 * 硬件加速不在这里：它必须早于 `app.whenReady()`，由 `extensions/preready.ts` 预读处理。
 */

/** 内嵌浏览器能力的约定名（由内置扩展 `xeonsky.browser` 提供）。 */
const BROWSER_CAPABILITY = 'ext:xeonsky.browser'

/** 扩展 `applySession` 动作的返回形状。 */
interface ApplySessionResult {
    ua: string
    proxy: string | null
}

/** 窗口级 webview 的纯策略（内核 `app/ui.ts` 经门面查询，机制仍在内核）。 */
interface WindowPolicyActions {
    /** 从 `window.open` 的 features 解析弹窗宽高。 */
    parsePopupSize?: (features: string) => { width: number; height: number }
    /**
     * 一次 `window.open` 的处置决策。
     *
     * `external` = 本扩展不接管（非 http(s) 协议）；**「扩展不可用」不在这里表达** ——
     * 那是内核兜底（见 {@link decideOpenAction}）。
     */
    decideOpenAction?: (url: string, frameName: string, features: string) => 'external' | 'popup' | 'tab'
    /** 地址栏输入解析（网址就跳、否则按扩展配置的默认引擎搜）。 */
    resolveAddressInput?: (raw: string) => ResolveResult
    /** 导航页的纯跳转解析（不搜索）。 */
    resolveTarget?: (raw: string) => ResolveResult
}

/** 一次输入解析的结果（契约形状见 `@shared/types` 的 {@link ResolveResult}）。 */
export type { ResolveResult }

/** 扩展提供的动作表（只在扩展激活后存在）。 */
interface BrowserActions extends WindowPolicyActions {
    /** 应用 UA / 代理 / 权限策略（版本号与标题由内核传入，扩展不 import `app`）。 */
    applySession?: (version: string, appTitle: string) => Promise<ApplySessionResult>
    /** 重新应用代理（代理设置变化时调用）。 */
    reapplyProxy?: () => Promise<string | null>
}

/** 取扩展的浏览器动作表；不可用返回 null。 */
function browserActions(): BrowserActions | null {
    const table = actionsOf(BROWSER_CAPABILITY)
    return table ? (table as unknown as BrowserActions) : null
}

/** 内核兜底弹窗尺寸（扩展不可用时用）—— 与扩展侧同一默认值。 */
const FALLBACK_POPUP_SIZE = { width: 900, height: 720 }

/** 内核兜底夹取（非正数 = 未指定，其余夹到 [300, 1600]）。 */
function clampPx(n: number): number {
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.max(300, Math.min(1600, Math.round(n)))
}

/**
 * 解析 `window.open` 的弹窗尺寸。
 *
 * 规则本身已迁到扩展（`xeonsky.browser` 的 `parsePopupSize`），这里只做转发；
 * 扩展不可用时**回落一份等价的内联实现** —— 与「会话策略可降级」不同，弹窗尺寸
 * 若缺失会让真弹窗尺寸错乱，且这是一段纯几何计算、不存在两份实现漂移的风险。
 */
export function parsePopupSize(features: string): { width: number; height: number } {
    const fromExt = browserActions()?.parsePopupSize
    if (typeof fromExt === 'function') {
        try {
            return fromExt(features)
        } catch {
            /* 落到内联兜底 */
        }
    }
    const out = { ...FALLBACK_POPUP_SIZE }
    const mW = /(?:^|,)width=(\d+)/i.exec(features)
    const mH = /(?:^|,)height=(\d+)/i.exec(features)
    const w = mW ? clampPx(Number(mW[1])) : 0
    const h = mH ? clampPx(Number(mH[1])) : 0
    if (w) out.width = w
    if (h) out.height = h
    return out
}

/**
 * 一次 `window.open` 的处置决策（`external` / `popup` / `tab`）。
 *
 * 优先问扩展；**扩展不可用时一律返回 `external`** —— 这就是「浏览器扩展关闭了，
 * 就在系统默认浏览器里打开」这条规则：外壳内容区仍靠 `<webview>` 渲染（那是核心通路），
 * 但「新开一个目标」这件事在浏览器扩展缺席时不再由外壳自己承担。
 */
export function decideOpenAction(url: string, frameName: string, features: string): 'external' | 'popup' | 'tab' {
    const fromExt = browserActions()?.decideOpenAction
    if (typeof fromExt === 'function') {
        try {
            return fromExt(url, frameName, features)
        } catch {
            /* 落到下方兜底 */
        }
    }
    return 'external'
}

/** 扩展不可用时的输入解析兜底：一律交系统默认程序（外壳不再自己当浏览器）。 */
function fallbackResolve(raw: string): ResolveResult {
    const s = raw.trim()
    return s ? { kind: 'external', url: s } : { kind: 'none' }
}

/**
 * 解析**地址栏**输入（网址就跳、否则按扩展配置的默认引擎搜）。
 *
 * 规则整体在扩展里（`resolveAddressInput`）；内核只转发。扩展不可用时交系统默认程序。
 */
export function resolveAddressInput(raw: string): ResolveResult {
    const fromExt = browserActions()?.resolveAddressInput
    if (typeof fromExt === 'function') {
        try {
            return fromExt(raw)
        } catch {
            /* 落到下方兜底 */
        }
    }
    return fallbackResolve(raw)
}

/**
 * 解析**导航页**输入（纯跳转语义，不搜索）。
 *
 * 与 {@link resolveAddressInput} 走同一套转发，只是问扩展的另一个动作 ——
 * 「不猜搜索」这条差别留在扩展里，内核不认识「搜索引擎」这个概念。
 */
export function resolveTarget(raw: string): ResolveResult {
    const fromExt = browserActions()?.resolveTarget
    if (typeof fromExt === 'function') {
        try {
            return fromExt(raw)
        } catch {
            /* 落到下方兜底 */
        }
    }
    return fallbackResolve(raw)
}

/**
 * 代理设置变化后重新应用到内嵌页面会话。
 *
 * 由设置模块在保存 / 重置后调用。UA 不走这里 —— 它是扩展自己的设置项，
 * 由扩展侧在保存时自应用；这里只管仍属内核设置的「程序本体代理范围」。
 */
export async function reapplyWebviewProxy(): Promise<void> {
    const actions = browserActions()
    const reapply = actions?.reapplyProxy
    if (typeof reapply !== 'function') return
    try {
        await reapply()
    } catch {
        /* 扩展未激活 / 未就绪：代理保持现状，不影响设置保存 */
    }
}

/**
 * 把内嵌页面的会话设置（UA / 代理 / 权限策略）落地。
 *
 * 由 `index.ts` 在 `startLoader()` 之后、`createShellWindow()` 之前调用。
 * 扩展未激活时降级为不配置，并打一条 warn 让问题在开发期暴露。
 *
 * @param cfg 当前设置（保留形参以便将来需要另读项；会话配置本身已由扩展内部决定）
 * @param log 调用方的 logger（沿用其 tag，便于日志归口）
 */
export async function initWebviewSession(cfg: Settings, log: ReturnType<typeof logger>): Promise<void> {
    void cfg
    const actions = browserActions()
    const apply = actions?.applySession
    if (typeof apply !== 'function') {
        log.warn('browser extension unavailable, embedded pages use Electron default session policy')
        return
    }
    // 必须 await：权限处理器要在 createShellWindow() 之前装好，否则先建出来的 webview
    // 会拿到「未装处理器 = 默认放行一切」的策略。失败只降级为打日志，不阻断启动。
    try {
        const r = await apply(app.getVersion(), app.getName())
        log.info({ ua: r?.ua, proxy: r?.proxy ?? 'system' }, 'webview session configured')
    } catch (err) {
        log.warn({ err }, 'webview session configuration failed')
    }
}
