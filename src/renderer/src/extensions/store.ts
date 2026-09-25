import { reactive } from 'vue'
import type { ExtSettingsContribution, ExtTabContribution, ExtensionsInfo } from '@shared/extensions'

/**
 * 渲染层扩展注册表 —— 主进程那份「已登记贡献点」在渲染侧的镜像。
 *
 * 主进程负责**裁决**（谁被加载、谁申请到了什么能力），渲染层负责**呈现**：
 * 它只消费主进程给的贡献点列表，把它们挂到两个控制点上：
 *
 *   1. 标签页 —— `shell/tabs.ts` 的动态标签页类型（`openTab` 打开扩展声明的 URL）；
 *   2. 设置页 —— 侧栏追加面板项 + 路由 `/settings/<key>` 落到扩展提供的视图。
 *
 * 刻意保持**被动**：本模块不自己去发现扩展、不自己判断该不该加载 ——
 * 那些判断只在主进程做一次，渲染层重复判断等于把「谁有权限」分成两份实现。
 */

/** 一个扩展带来的标签页贡献（含来源扩展 id，便于展示与排查）。 */
export interface RendererTabExt extends ExtTabContribution {
    extId: string
    extName: string
}

/** 一个扩展带来的设置面板贡献。 */
export interface RendererPanelExt extends ExtSettingsContribution {
    extId: string
    extName: string
}

interface ExtRendererState {
    /** 全部扩展（主进程给的列表，含失败 / 停用的，便于设置页展示）。 */
    info: ExtensionsInfo | null
    /** 生效中的标签页贡献（只来自 status === 'active' 的扩展）。 */
    tabs: RendererTabExt[]
    /** 生效中的设置面板贡献。 */
    panels: RendererPanelExt[]
    /** 是否已加载过一次。 */
    loaded: boolean
}

export const extState = reactive<ExtRendererState>({
    info: null,
    tabs: [],
    panels: [],
    loaded: false
})

/** 由主进程的扩展信息重建贡献点列表。 */
function rebuild(): void {
    const info = extState.info
    if (!info) {
        extState.tabs = []
        extState.panels = []
        return
    }
    const tabs: RendererTabExt[] = []
    const panels: RendererPanelExt[] = []
    for (const entry of info.entries) {
        // 只有 active 的扩展贡献才生效 —— 失败 / 停用 / 跳过的扩展不该在外壳上留痕迹。
        if (entry.status !== 'active') continue
        for (const tab of entry.contributions?.tabs ?? []) {
            tabs.push({ ...tab, extId: entry.id, extName: entry.name })
        }
        for (const panel of entry.contributions?.settings ?? []) {
            panels.push({ ...panel, extId: entry.id, extName: entry.name })
        }
    }
    extState.tabs = tabs
    extState.panels = panels
}

/** 拉取一次扩展信息并重建贡献点。 */
export async function refreshExtensions(): Promise<void> {
    try {
        extState.info = await window.api.get('/extensions')
    } catch {
        // 主进程不可用时不该让渲染层崩：当作没有扩展。
        extState.info = null
    }
    rebuild()
    extState.loaded = true
}

/** 清空（扩展列表变化但拉取失败时的兜底）。 */
export function clearExtensions(): void {
    extState.info = null
    extState.tabs = []
    extState.panels = []
    extState.loaded = false
}
