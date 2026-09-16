import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { ConfirmDialogRequest } from '@shared/types'
import { APP_TITLE } from './const'
import { rendererIndex } from './ui'

/**
 * 独立确认子窗口：把原先内嵌在页面里的 `ElMessageBox.confirm` 改成**真正的独立窗口**。
 *
 * 为什么：内嵌弹层受宿主窗口与页面层级/滚动影响，且不算真正独立；独立窗口由 OS 管理
 * 焦点与模态，也不遮挡页面。窗口无边框，外观由渲染层的 ConfirmWindow.vue 负责。
 *
 * 载荷不主动 push：确认窗挂载后自己 `GET /dialog/confirm/context` 拉取 —— 避免
 * `did-finish-load` 与渲染层订阅之间的时序竞态（与 shell:take-open-intent 同一思路）。
 * 结果由确认窗 `POST /dialog/confirm/reply` 回传，主进程据此结算并关窗。
 */

/** 一次进行中的确认。 */
interface PendingConfirm {
    /** 确认窗自己的 webContents id（窗口销毁后仍可安全持有）。 */
    wcId: number
    win: BrowserWindow
    payload: ConfirmDialogRequest
    settled: boolean
    resolve: (confirmed: boolean) => void
}

/** 进行中的确认窗，按自身 webContents id 索引。 */
const pending = new Map<number, PendingConfirm>()

/** 供确认窗拉取自己的载荷；不是确认窗则返回 null。 */
export function confirmDialogContext(wcId: number): ConfirmDialogRequest | null {
    return pending.get(wcId)?.payload ?? null
}

/** 确认窗回传结果；对未登记的窗口静默忽略。 */
export function replyConfirmDialog(wcId: number, confirmed: boolean): void {
    const p = pending.get(wcId)
    if (p) settle(p, confirmed)
}

/** 收尾：只结算一次，并关掉确认窗（'closed' 会再触发一次，被 settled 挡住）。 */
function settle(p: PendingConfirm, confirmed: boolean): void {
    if (p.settled) return
    p.settled = true
    pending.delete(p.wcId)
    p.resolve(confirmed)
    if (!p.win.isDestroyed()) p.win.close()
}

/**
 * 打开确认子窗口并等待结果。
 *
 * 有发起窗口时作为它的**模态子窗口**（始终在发起窗口之上，随它一起关闭）；
 * 拿不到发起窗口（异常环境）时就独立存在。用户关窗 = 取消。
 */
export function openConfirmDialog(req: ConfirmDialogRequest, parent: BrowserWindow | null): Promise<boolean> {
    return new Promise((resolve) => {
        const win = new BrowserWindow({
            width: 460,
            height: 252,
            parent: parent ?? undefined,
            modal: !!parent,
            frame: false,
            resizable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            show: false,
            title: APP_TITLE,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                webviewTag: false,
                preload: path.join(__dirname, '../preload/index.js')
            }
        })
        const entry: PendingConfirm = { wcId: win.webContents.id, win, payload: req, settled: false, resolve }
        pending.set(entry.wcId, entry)

        // Frameless 子窗口在个别环境不触发 ready-to-show；did-finish-load 兜底，二者幂等。
        // 显形后补一次 focus：模态窗不聚焦时键盘（Enter/Escape）会落到宿主窗口。
        const reveal = (): void => {
            if (win.isDestroyed()) return
            win.show()
            win.focus()
        }
        win.once('ready-to-show', reveal)
        win.webContents.once('did-finish-load', reveal)
        // 用户直接关窗 / 发起窗口关闭导致模态子窗关闭 → 一律按「取消」结算。
        win.on('closed', () => settle(entry, false))

        const devUrl = process.env['ELECTRON_RENDERER_URL']
        const load = devUrl
            ? win.loadURL(`${devUrl}?dialog=confirm`)
            : win.loadFile(rendererIndex(), { query: { dialog: 'confirm' } })
        void load.catch(() => settle(entry, false))
    })
}
