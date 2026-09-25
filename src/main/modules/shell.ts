import { dialog, shell, Menu } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { NEWTAB_URL } from '@shared/types'
import type { ConfirmDialogRequest } from '@shared/types'
import { defineModule } from '../kernel/module'
import { getMainWindow, sendToWindow } from '../kernel/runtime'
import { isCoreWindow, windowByContentsId, listWindows } from '../app/windowreg'
import { openStandaloneWindow, focusCoreWindow, takeOpenIntent, createSecondaryShellWindow, globalHotkeyState } from '../app/ui'
import { confirmDialogContext, openConfirmDialog, replyConfirmDialog } from '../app/confirmDialog'
import { defaultUserAgent, effectiveUserAgent } from '../app/webview'
import { APP_TITLE } from '../app/const'

/**
 * 多窗口下定位「发起这次 IPC 的那个壳窗口」：取 e.sender(webContents) 所属的壳窗口；
 * 异常环境退回当前主(核心)窗口。窗口级操作(缩放/最小化/关闭/对话框)都应作用到该窗口，
 * 而不是总用主窗口——否则副窗口点“关闭”会误关核心窗口。
 */
export function windowOfSender(e: { sender: { id: number } }): BrowserWindow | null {
    const w = windowByContentsId(e.sender.id)
    return w && !w.isDestroyed() ? w : (getMainWindow() && !getMainWindow()!.isDestroyed() ? getMainWindow() : null)
}

/** 聚焦某个壳窗口（若最小化先还原、不可见先显示），常用于“标签移入/新开后的接收窗口”。 */
export function focusWindowById(wcId: number): void {
    const w = windowByContentsId(wcId)
    if (!w || w.isDestroyed()) return
    if (w.isMinimized()) w.restore()
    if (!w.isVisible()) w.show()
    w.focus()
}

/**
 * 外壳：窗口控制、标签移动、原生对话框、只读外壳状态。
 *
 * 这一组是「发给渲染层的窗口级动作」的入口。核心约束：窗口级操作必须按**发起请求的那个
 * 窗口**作用（`ctx.event.sender` → 壳窗口），不能用全局主窗口，否则副窗口点关闭会误关核心窗口。
 */
export default defineModule({
    id: 'shell',
    routes: {
        GET: {
            '/hotkeys/state': () => globalHotkeyState(),
            '/webview/info': () => ({
                defaultUserAgent: defaultUserAgent(),
                currentUserAgent: effectiveUserAgent()
            }),
            // 本窗口元信息：winId + 是否核心窗口（核心窗口才承载 dsh UI）。
            '/shell/meta': ({ event }) => ({ winId: event.sender.id, isCore: isCoreWindow(event.sender.id) }),
            // 自定义标题栏要按状态切换「最大化 / 还原」。这里给一次当前值；之后的变化由 ui.ts 的窗口事件定向推送。
            '/windows/maximized': ({ event }) => !!windowOfSender(event)?.isMaximized(),
            '/dialog/confirm/context': ({ event }) => confirmDialogContext(event.sender.id)
        },
        POST: {
            '/shell/open-external': async ({ body }) => {
                if (/^https?:/i.test(body.url)) await shell.openExternal(body.url)
            },
            // 把一个 URL 开到独立窗口（右键“在新窗口打开 / 移动到其它窗口”）。
            '/shell/open-url': ({ body }) => {
                openStandaloneWindow(typeof body.url === 'string' ? body.url : '')
            },
            // 副窗口“跳转核心窗口”：聚焦核心窗口（无核心则重建一个）。
            '/shell/focus-core': () => {
                focusCoreWindow()
            },
            // 副窗口挂载后取走本窗口的“开页意图”（创建时若带了 URL，会据此开一个动态标签页）。
            '/shell/open-intent': ({ event }) => takeOpenIntent(event.sender.id),
            // 原生对话框
            '/dialog/directory': async ({ event }) => {
                const w = windowOfSender(event)
                if (!w) return null
                const r = await dialog.showOpenDialog(w, {
                    title: '选择工作目录',
                    properties: ['openDirectory', 'createDirectory']
                })
                return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
            },
            '/dialog/file': async ({ event }) => {
                const w = windowOfSender(event)
                if (!w) return null
                const r = await dialog.showOpenDialog(w, {
                    title: '选择启动器文件',
                    properties: ['openFile'],
                    filters: [
                        { name: 'launcher', extensions: ['cmd', 'bat', 'exe', 'js', 'sh', ''] },
                        { name: 'all', extensions: ['*'] }
                    ]
                })
                return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
            },
            // 独立确认子窗口：开窗 → 等待确认窗回传结果。文案已由渲染层 i18n。
            '/dialog/confirm': async ({ event, body }) => {
                const confirmed = await openConfirmDialog(
                    {
                        title: body.title,
                        message: body.message,
                        detail: body.detail,
                        confirmText: body.confirmText,
                        cancelText: body.cancelText,
                        danger: body.danger === true
                    } satisfies ConfirmDialogRequest,
                    windowOfSender(event)
                )
                return { confirmed }
            },
            '/dialog/confirm/reply': ({ event, body }) => {
                replyConfirmDialog(event.sender.id, body.confirmed === true)
            },
            // 窗口控制
            '/windows/minimize': ({ event }) => windowOfSender(event)?.minimize(),
            '/windows/maximize-toggle': ({ event }) => {
                const w = windowOfSender(event)
                if (!w) return
                if (w.isMaximized()) w.unmaximize()
                else w.maximize()
            },
            '/windows/close': ({ event }) => windowOfSender(event)?.close(),
            // “移动到其它窗口”：弹一个原生菜单列出其它壳窗口供用户选择目标；选中的目标窗口开一个
            // 动态标签页承载 url，随后源窗口移除其标签。若当前没有其它窗口则回退到新开一个副窗口。
            // resolve true 表示确实移走了（源窗口应关闭对应标签）；false 表示用户取消（保留标签）。
            '/shell/move-tab': ({ event, body }) =>
                new Promise<boolean>((resolve) => {
                    const src = windowOfSender(event)
                    const u = typeof body.url === 'string' ? body.url : ''
                    const okHttp = /^https?:/i.test(u)
                    const okNewtab = u === NEWTAB_URL
                    if (!u || (!okHttp && !okNewtab)) {
                        resolve(false)
                        return
                    }
                    const doOpen = (target: BrowserWindow | null): BrowserWindow | null => {
                        if (target && !target.isDestroyed()) {
                            sendToWindow(target, 'ui:new-tab', u)
                            return target
                        }
                        return createSecondaryShellWindow(u)
                    }
                    const candidates = listWindows().filter((w) => w !== src && !w.isDestroyed())
                    let settled = false
                    const finish = (ok: boolean): void => {
                        if (settled) return
                        settled = true
                        resolve(ok)
                    }
                    const pick = (w: BrowserWindow | null): void => {
                        const opened = doOpen(w)
                        if (opened && !opened.isDestroyed()) focusWindowById(opened.webContents.id)
                        finish(true)
                    }
                    if (candidates.length === 0) {
                        pick(null) // 没有其它窗口 → 直接新开
                        return
                    }
                    const items: MenuItemConstructorOptions[] = candidates.map((w) => ({
                        label: (w.getTitle() || APP_TITLE).trim(),
                        click: () => pick(w)
                    }))
                    items.push({ type: 'separator' })
                    items.push({ label: '＋ 新窗口', click: () => pick(null) })
                    const menu = Menu.buildFromTemplate(items)
                    const anchor = src && !src.isDestroyed() ? src : undefined
                    menu.popup({
                        window: anchor,
                        // 菜单被关闭（取消或 Esc）而无选择 → 视为取消
                        callback: () => finish(false)
                    })
                })
        },
        PUT: {
            // 副窗口把“当前标签页标题”同步给主进程，主进程据此命名窗口：<标签页标题> - 软件名。
            '/shell/title': ({ event, body }) => {
                const w = windowOfSender(event)
                if (!w) return
                const label = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : ''
                w.setTitle(label ? `${label} - ${APP_TITLE}` : APP_TITLE)
            },
            '/windows/zoom': ({ event, body }) => {
                const w = windowOfSender(event)
                if (!w) return
                const percent = Math.max(50, Math.min(200, Number(body.percent) || 100))
                w.webContents.setZoomFactor(percent / 100)
            }
        }
    }
})
