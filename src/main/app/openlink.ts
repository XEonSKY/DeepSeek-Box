import { shell } from 'electron'
import { logger } from '../kernel/logger'

/**
 * 交系统默认程序打开一个 URI 的**唯一出口**。
 *
 * 为什么要有这一层（而不是各处直接 `shell.openExternal`）：这个调用的放行面等于
 * 「什么 URI 能让本机拉起外部程序」。内嵌 `<webview>` 跑的是**任意站点**，
 * 它的 `window.open` / `target=_blank` 最终也会走到这里，所以放行必须收敛在一处、可审计。
 *
 * 策略：**协议白名单**。只认常规浏览（http/https）与最常见的外部处理协议
 * （mailto/tel/sms）；`file:`、`smb:`、以及任意自定义协议一律忽略 —— 放行它们等于
 * 把「打开本地文件 / 拉起任意注册程序」交给网页。
 */

const log = logger('[shell]')

/** 允许交给系统的协议。 */
const EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'sms'])

/** 取一个 URI 的协议名（小写，不含冒号）；无法识别返回空串。 */
function schemeOf(url: string): string {
    return /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim())?.[1].toLowerCase() ?? ''
}

/** 该 URI 是否允许交给系统默认程序打开。 */
function canOpenExternal(url: string): boolean {
    return !!url.trim() && EXTERNAL_SCHEMES.has(schemeOf(url))
}

/** 交系统默认程序打开；不在白名单内或调用失败只记一条日志，不抛错。 */
export async function openExternalSafe(url: string): Promise<void> {
    const target = url.trim()
    if (!target) return
    if (!canOpenExternal(target)) {
        log.warn({ url: target }, 'refused to open external url with disallowed scheme')
        return
    }
    try {
        await shell.openExternal(target)
    } catch (err) {
        log.warn({ err, url: target }, 'openExternal failed')
    }
}
