import { activeTab, keptTabIds, webTabs } from '../shell/tabs'
import type { WebTab } from '../shell/tabs'

/**
 * `<webview>` 生命周期管理：创建、保活、裁剪、缩放与 home 地址跟随。
 *
 * 从 WebHost.vue 抽出。宿主只负责「显示」与「地址栏」，webview 的创建/销毁规则集中在此，
 * 便于单独理解与测试「谁在什么时候被加载、谁被回收」这一最容易出错的逻辑。
 *
 * 与宿主的耦合只有两个回调（见 `WebviewHost`）：导航状态变化、加载状态变化。
 */

/** Electron `<webview>` 在 renderer 侧没有官方类型，这里按实际用到的成员声明最小接口。 */
export interface WebviewEl extends HTMLElement {
    // 注意：不要重复声明 remove()——HTMLElement 已提供非可选的 remove()，
    // 若在此声明为可选（remove?:），会因「用可选成员覆盖必需成员」而报 TS2430。
    src: string
    getURL?: () => string
    getTitle?: () => string
    canGoBack?: () => boolean
    canGoForward?: () => boolean
    setZoomFactor?: (factor: number) => void
    /** 是否正在加载：与 did-start/stop-loading 同源，切换标签页时用它校正加载态，避免遗留转圈。 */
    isLoading?: () => boolean
    reload?: () => void
    stop?: () => void
    goBack?: () => void
    goForward?: () => void
    loadURL?: (url: string) => Promise<void>
}

/** 宿主（WebHost.vue）提供的回调；webview 自身无法直接改宿主的 UI 状态。 */
export interface WebviewHost {
    /** 某 webview 的导航状态变化（URL / 可前进后退）→ 宿主刷新地址栏。 */
    onNavChange(wv: WebviewEl): void
    /** 加载状态变化（仅当前激活的 webview 才会上报）。 */
    onLoadingChange(loading: boolean): void
}

export function useWebviews(host: WebviewHost) {
    /** 每个标签页对应的容器元素（由模板 ref 绑定）。 */
    const holderEls: Record<string, HTMLDivElement | null> = {}
    const wvById = new Map<string, WebviewEl>()
    let zoomPct = 100
    let lastHomeUrl: string | null = null

    /** 当前激活标签页的 webview（无则 null）。 */
    function activeWv(): WebviewEl | null {
        const t = activeTab()
        return t ? (wvById.get(t.id) ?? null) : null
    }

    /** 模板 ref 绑定：记录/清除某标签页的容器。 */
    function setHolder(id: string, el: HTMLDivElement | null): void {
        if (el) holderEls[id] = el
        else delete holderEls[id]
    }

    function applyZoom(wv: WebviewEl): void {
        try {
            if (wv && typeof wv.setZoomFactor === 'function') wv.setZoomFactor((zoomPct || 100) / 100)
        } catch {
            /* ignore */
        }
    }

    /** 缩放变化后对全部已存在 webview 生效。 */
    function setZoom(pct: number): void {
        zoomPct = pct
        for (const wv of wvById.values()) applyZoom(wv)
    }

    function removeWebview(id: string): void {
        const wv = wvById.get(id)
        if (wv) {
            try {
                wv.remove()
            } catch {
                /* ignore */
            }
            wvById.delete(id)
        }
    }

    /** 为某个标签页创建 webview（首次激活时调用）。 */
    function ensureWebview(tab: WebTab): void {
        const holder = holderEls[tab.id]
        if (!holder || !tab.url) return
        if (wvById.get(tab.id)) return

        const wv = document.createElement('webview') as WebviewEl
        // 必须显式允许弹窗，target=_blank / window.open 才会进入主进程的
        // setWindowOpenHandler（主进程再转成“应用内新标签页”）。缺了它会被 webview 静默拦掉。
        wv.setAttribute('allowpopups', '')
        wv.style.width = '100%'
        wv.style.height = '100%'
        wv.style.border = 'none'
        wv.style.flex = '1 1 auto'
        holder.appendChild(wv)
        wvById.set(tab.id, wv)
        tab.visited = true // 打开过：固定三站此时才开始保活

        wv.addEventListener('dom-ready', () => {
            applyZoom(wv)
            // 动态标签页标题跟随真实页面标题；固定来源用友好名。
            if (tab.kind === 'dynamic') {
                const title = typeof wv.getTitle === 'function' ? (wv.getTitle() as string) : ''
                if (title) tab.title = title
            }
            host.onNavChange(wv)
        })
        wv.addEventListener('did-navigate', () => host.onNavChange(wv))
        wv.addEventListener('did-navigate-in-page', () => host.onNavChange(wv))
        wv.addEventListener('did-start-loading', () => {
            if (activeWv() === wv) host.onLoadingChange(true)
        })
        wv.addEventListener('did-stop-loading', () => {
            if (activeWv() === wv) {
                host.onLoadingChange(false)
                host.onNavChange(wv)
            }
        })
        // 仅在首次创建时设置 src；此后不再复位，避免切换/返回时触发重载。
        wv.src = tab.url
    }

    /** 确保当前激活标签页有 webview（已访问标签页保活）。 */
    function ensureActive(): void {
        const t = activeTab()
        if (t) ensureWebview(t)
    }

    /** 重载当前激活 webview。 */
    function reloadActive(): void {
        const wv = activeWv()
        if (wv && typeof wv.reload === 'function') wv.reload()
    }

    /** 销毁不在保活集（keptTabIds：固定三站 + 用户星标 + 最近 3 个动态）或已关闭标签页的 webview。 */
    function prune(): void {
        const keep = keptTabIds()
        for (const id of [...wvById.keys()]) {
            if (!keep.has(id)) removeWebview(id)
        }
    }

    /** home(dsh UI) URL 变化（dsh 就绪/重连换端口）时，让已存在的 home webview 导航过去。 */
    function syncHomeUrl(): void {
        const home = webTabs.list.find((t) => t.kind === 'home')
        const u = home?.url ?? null
        if (u && u !== lastHomeUrl) {
            lastHomeUrl = u
            const wv = wvById.get('home')
            if (wv && wv.src && wv.src !== u && typeof wv.loadURL === 'function') {
                void wv.loadURL(u).catch(() => {
                    /* 导航失败由 webview 自身事件反映 */
                })
            }
        }
    }

    /** 卸载时销毁全部 webview。 */
    function destroyAll(): void {
        for (const id of [...wvById.keys()]) removeWebview(id)
        wvById.clear()
    }

    return {
        setHolder,
        setZoom,
        activeWv,
        ensureActive,
        reloadActive,
        prune,
        syncHomeUrl,
        destroyAll
    }
}
