import type { ConfirmDialogRequest } from '@shared/types'

/**
 * 弹出一个**独立的确认子窗口**并等待用户选择。
 *
 * 取代原先的 `ElMessageBox.confirm`：取消 / 关窗都解析为 `false`，
 * 调用方不再需要 try/catch 包一层，也不必关心弹层被宿主页面遮挡。
 */
export async function confirmDialog(req: ConfirmDialogRequest): Promise<boolean> {
    const r = await window.api.post('/dialog/confirm', { body: req })
    return r.confirmed === true
}
