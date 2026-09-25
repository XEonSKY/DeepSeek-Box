import { defineModule } from '../kernel/module'
import { sendToWcId } from '../kernel/runtime'
import { windowByContentsId, listWindows } from '../app/windowreg'
import { focusWindowById } from './shell'

/** 当前这次拖拽的上下文；null 表示没有进行中的拖拽。 */
let dragCtx: { sourceId: number; target: string } | null = null
/** 当前被高亮的壳窗口 webContents id；null 表示无高亮。 */
let hoveredWc: number | null = null

/** 切换高亮窗口：只给「刚离开的那个」与「刚进入的那个」发消息，避免无谓的 IPC。 */
function setHover(id: number | null): void {
    if (hoveredWc === id) return
    if (hoveredWc != null) sendToWcId(hoveredWc, 'tab-drag-hover', false)
    hoveredWc = id
    if (id != null) sendToWcId(id, 'tab-drag-hover', true)
}

/**
 * 跨窗口拖标签：由「源窗口」自行跟踪指针，用屏幕坐标决定落点。
 *
 * 拖拽是**有状态的**（正在进行的那一次拖拽的源窗口 / 目标模板 / 当前高亮窗口），
 * 因此单独成一个模块 —— 状态与模块同生命周期，不必塞进 kernel。
 * 同一时刻只可能有一次拖拽，故状态用模块级变量而非 Map 即可。
 */
export default defineModule({
    id: 'tabdrag',
    routes: {
        POST: {
            // 源窗口开始拖拽：登记 ctx，并返回“其它壳窗口”的屏幕几何，供源窗口用指针屏幕坐标算落点。
            '/tab-drag': ({ event, body }) => {
                const target = typeof body.target === 'string' && body.target ? body.target : ''
                dragCtx = target ? { sourceId: event.sender.id, target } : null
                setHover(null)
                if (!dragCtx) return []
                return listWindows()
                    .filter((w) => w !== windowByContentsId(event.sender.id) && !w.isDestroyed())
                    .map((w) => {
                        const b = w.getBounds()
                        return { id: w.webContents.id, x: b.x, y: b.y, w: b.width, h: b.height }
                    })
            },
            // 源窗口决定把标签移入某目标窗口。
            '/tab-drag/drop': ({ body }) => {
                const ctx = dragCtx
                const id = typeof body.targetId === 'number' ? body.targetId : -1
                dragCtx = null
                setHover(null)
                if (!ctx || id < 0) return
                sendToWcId(id, 'ui:new-tab', ctx.target) // 目标窗口开该标签（含内置导航页伪链接）
                sendToWcId(ctx.sourceId, 'tab-drag:moved') // 通知源窗口移除被拖标签
                focusWindowById(id) // 释放后聚焦“接收窗口”
            }
        },
        PATCH: {
            // 源窗口报告当前“指针悬停的目标窗口 id”（主进程只把高亮发给那个窗口）。
            '/tab-drag': ({ body }) => {
                setHover(typeof body.targetId === 'number' ? body.targetId : null)
            }
        },
        DELETE: {
            // 取消：清除拖拽上下文并收起所有高亮。
            '/tab-drag': () => {
                dragCtx = null
                setHover(null)
            }
        }
    }
})
