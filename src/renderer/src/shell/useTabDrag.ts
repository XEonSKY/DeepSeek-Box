import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { Ref } from 'vue'
import { webTabs, closeTab } from './tabs'
import type { WebTab } from './tabs'
import { tt } from '../lib/locales'
import { NEWTAB_URL } from '@shared/types'

/**
 * 标签页拖拽控制器（每窗口一份）。
 *
 * 关键认知：一旦在某窗口按下鼠标，该窗口会**捕获鼠标**，直到松开——因此跨窗口拖拽时，指针
 * 滑到另一个窗口，事件仍会回到“源窗口”（Windows 如此）。所以跨窗口拖拽由源窗口负责全程：
 *   - 源窗口用指针的**屏幕坐标**判断当前悬停在哪个其它壳窗口上方；
 *   - 经主进程让那个窗口亮起“可接收”遮罩（浅蓝）；
 *   - 松开时源窗口据此决定：移入该目标窗口 / 本地排序 / 取消。
 *
 * 不再依赖“目标窗口收 pointer 事件”（那在按下捕获后根本收不到，正是之前移不过去的原因）。
 */

const DRAG_THRESHOLD = 6 // 启动拖拽前的最小位移（区分点击与拖拽）
const GHOST_OFFSET = 14 // 幽灵标签相对指针的偏移
/** 目标窗口“可接收”的可点击高度（其顶部标签栏区域大致占窗口内顶部这一段）。 */
const TARGET_BAND = 88

function isDraggableKind(tab: WebTab): boolean {
    return tab.kind === 'dynamic' || tab.kind === 'newtab'
}

/** 一个标签作为“可转移目标”的标识：普通标签=URL；内置导航页=NEWTAB_URL。 */
function targetOf(tab: WebTab): string | null {
    if (!isDraggableKind(tab)) return null
    if (tab.kind === 'newtab') return NEWTAB_URL
    return tab.url
}

interface OtherWindow {
    id: number
    x: number
    y: number
    w: number
    h: number
}

export interface TabDragApi {
    /** 绑定到标签条根元素（用于定位插入/拖放）。 */
    bindTabsBar: (el: unknown) => void
    /** 绑定到每个可拖标签的 pointerdown。 */
    onTabPointerDown: (tab: WebTab, e: PointerEvent) => void
    /** 当前正在被拖拽（本窗口为源）的标签 id。 */
    draggingTabId: Ref<string | null>
    /** 本地排序的插入标记：应插到该 id 的标签“之前”。 */
    slotBeforeId: Ref<string | null>
    /** 本窗口是否正被某跨窗口拖拽“悬停”为目标（浅蓝遮罩显示与否）。 */
    hoverMask: Ref<boolean>
    /** 跟随指针的半透明“幽灵”标签。 */
    ghost: { visible: boolean; x: number; y: number; text: string }
}

export function useTabDrag(): TabDragApi {
    const tabsBarEl = ref<HTMLElement | null>(null)
    const draggingTabId = ref<string | null>(null)
    const slotBeforeId = ref<string | null>(null)
    const hoverMask = ref(false)
    const ghost = reactive({ visible: false, x: 0, y: 0, text: '' })

    let press: { x: number; y: number; tab: WebTab } | null = null
    let started = false
    let others: OtherWindow[] = []
    let hoveredId: number | null = null

    const bindTabsBar = (el: unknown): void => {
        tabsBarEl.value = el instanceof HTMLElement ? el : null
    }

    // ---- 同窗口内 draggable 顺序（固定站始终在最前，只对动态/新标签页排序）----
    const draggableOrder = (): WebTab[] => webTabs.list.filter(isDraggableKind)

    function slotBeforeAt(x: number): string | null {
        const bar = tabsBarEl.value
        const order = draggableOrder()
        if (!bar || order.length === 0) return null
        const kids = bar.querySelectorAll<HTMLElement>('.tab:not(.tab--add)')
        for (let i = 0; i < order.length; i++) {
            const el = kids[i]
            if (!el) continue
            const r = el.getBoundingClientRect()
            if (x < r.left + r.width / 2) return order[i].id
        }
        return null
    }

    function reorderInWindow(id: string, before: string | null): void {
        const fixed = webTabs.list.filter((t) => !isDraggableKind(t))
        const dyn = draggableOrder()
        const from = dyn.findIndex((t) => t.id === id)
        if (from < 0) return
        const [moved] = dyn.splice(from, 1)
        if (before) {
            const bi = dyn.findIndex((t) => t.id === before)
            dyn.splice(bi < 0 ? dyn.length : bi, 0, moved)
        } else {
            dyn.push(moved)
        }
        webTabs.list.splice(0, webTabs.list.length, ...fixed, ...dyn)
    }

    function pointerInOwnStrip(cx: number, cy: number): boolean {
        const bar = tabsBarEl.value
        if (!bar) return false
        const r = bar.getBoundingClientRect()
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
    }

    /** 屏幕坐标落在哪个其它壳窗口的“可接收”区域（顶部标签栏带）内。 */
    function hoverTarget(sx: number, sy: number): number | null {
        for (const o of others) {
            if (sx >= o.x && sx <= o.x + o.w && sy >= o.y && sy <= o.y + TARGET_BAND) return o.id
        }
        return null
    }

    function reportHover(next: number | null): void {
        if (next === hoveredId) return
        hoveredId = next
        window.api.tabDragHover(next)
    }

    function syncGhost(cx: number, cy: number): void {
        const w = window.innerWidth || 0
        const h = window.innerHeight || 0
        ghost.x = Math.min(Math.max(0, cx + GHOST_OFFSET), Math.max(0, w - 40))
        ghost.y = Math.min(Math.max(0, cy + GHOST_OFFSET), Math.max(0, h - 34))
    }

    // ---- 源窗口指针处理 ----
    function onSourceMove(e: PointerEvent): void {
        if (!press) return
        if (!started) {
            const dx = e.clientX - press.x
            const dy = e.clientY - press.y
            if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
            void beginDrag()
        }
        if (!started) return
        syncGhost(e.clientX, e.clientY)
        reportHover(hoverTarget(e.screenX, e.screenY))
        // 本地排序指示：仅当指针仍在本窗口标签条内
        if (pointerInOwnStrip(e.clientX, e.clientY)) slotBeforeId.value = slotBeforeAt(e.clientX)
        else slotBeforeId.value = null
    }

    async function beginDrag(): Promise<void> {
        if (!press || started) return
        const t = targetOf(press.tab)
        if (!t) return
        const list = await window.api.tabDragBegin(t)
        started = true
        others = list ?? []
        hoveredId = null
        draggingTabId.value = press.tab.id
        ghost.visible = true
        // 幽灵标签文案与标签条保持一致：内置导航页走 i18n，不能硬编码英文
        ghost.text = press.tab.kind === 'newtab' ? tt('app.tabs.new') : press.tab.title || ''
    }

    function endLocal(opts: { reorder?: boolean; dropTarget?: number | null }): void {
        const id = draggingTabId.value
        cleanupSourceListeners()
        ghost.visible = false
        draggingTabId.value = null
        slotBeforeId.value = null
        if (opts.dropTarget != null && id) {
            window.api.tabDragDropTo(opts.dropTarget) // 移入其它窗口；标签移除由 onTabDragMoved 处理
            return
        }
        window.api.tabDragEnd() // 本地排序或取消
        press = null
        started = false
        others = []
        hoveredId = null
        reportHover(null)
    }

    function onSourceUp(e: PointerEvent): void {
        if (!started) {
            cleanupSourceListeners()
            return
        }
        const target = hoverTarget(e.screenX, e.screenY)
        if (target != null) {
            endLocal({ dropTarget: target })
            return
        }
        if (pointerInOwnStrip(e.clientX, e.clientY)) {
            const before = slotBeforeAt(e.clientX)
            const id = draggingTabId.value
            if (id) reorderInWindow(id, before)
            endLocal({})
            return
        }
        endLocal({}) // 其它位置松开 = 取消
    }

    function onSourceCancel(): void {
        endLocal({})
    }

    function onSourceLeave(): void {
        slotBeforeId.value = null
    }

    function cleanupSourceListeners(): void {
        window.removeEventListener('pointermove', onSourceMove)
        window.removeEventListener('pointerup', onSourceUp)
        window.removeEventListener('pointercancel', onSourceCancel)
        window.removeEventListener('pointerleave', onSourceLeave)
    }

    function onTabPointerDown(tab: WebTab, e: PointerEvent): void {
        if (e.button !== 0) return
        if (!isDraggableKind(tab)) return
        const t = targetOf(tab)
        if (!t) return
        const target = e.target as HTMLElement | null
        if (target && target.closest('button')) return // 关/星标按钮不触发拖拽
        press = { x: e.clientX, y: e.clientY, tab }
        started = false
        draggingTabId.value = null
        slotBeforeId.value = null
        window.addEventListener('pointermove', onSourceMove)
        window.addEventListener('pointerup', onSourceUp)
        window.addEventListener('pointercancel', onSourceCancel)
        window.addEventListener('pointerleave', onSourceLeave)
    }

    function onSourceMovedAway(): void {
    // 被拖标签已移入其它窗口：主进程会先对目标发 hover false，这里移除本地该标签并清状态。
        const id = draggingTabId.value
        cleanupSourceListeners()
        ghost.visible = false
        draggingTabId.value = null
        slotBeforeId.value = null
        press = null
        started = false
        others = []
        hoveredId = null
        if (id) closeTab(id)
    }

    let offMoved: (() => void) | null = null
    let offHover: (() => void) | null = null

    onMounted(() => {
        offMoved = window.api.onTabDragMoved(onSourceMovedAway)
        offHover = window.api.onTabDragHover((on) => {
            hoverMask.value = on
        })
    })
    onBeforeUnmount(() => {
        offMoved?.()
        offHover?.()
        cleanupSourceListeners()
    })

    return {
        bindTabsBar,
        onTabPointerDown,
        draggingTabId,
        slotBeforeId,
        hoverMask,
        ghost
    }
}
