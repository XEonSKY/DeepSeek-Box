import { watch } from 'vue'
import { extState } from './store'
import { openTab, findTab, webTabs } from '../shell/tabs'
import { tt } from '../lib/locales'

/**
 * 渲染层控制点 1：**标签页**。
 *
 * 扩展能做的只有一件事 —— 声明一个 URL，外壳把它当普通动态标签页打开。
 * 这正好复用了现成的标签页模型（`shell/tabs.ts` 的 `openTab`）：扩展标签页
 * 与用户手动开的动态页**完全同质**，共享保活、关闭、拖拽等全部既有行为，
 * 不需要给 `WebTabKind` 加新种类，也不会出现"扩展标签页行为不一样"的割裂。
 *
 * 为什么不在标签栏塞一个"扩展页入口"列表：那等于给扩展开第三个控制点，
 * 而用户限定的能力面只有两个（标签页 + 设置页）。扩展想被打开，
 * 要么 `openOnStart` 自动开一次，要么由用户在扩展设置面板里点（复用搜索/新建页的既有入口）。
 */

/** 已自动打开过的贡献 key（`<extId>/<key>`），避免每次刷新重复开。 */
const autoOpened = new Set<string>()

/** 给扩展标签页一个稳定的 id：`ext-<extId>-<key>`，便于查找与去重。 */
export function extTabId(extId: string, key: string): string {
    return `ext-${extId}-${key}`
}

/**
 * 打开（或聚焦）某扩展的标签页。
 *
 * 已存在则激活它，不重复开 —— 扩展入口常被当"设置/面板"点，
 * 每次都新开一个会让标签栏堆积。
 */
export function openExtTab(extId: string, key: string): void {
    const contribution = extState.tabs.find((t) => t.extId === extId && t.key === key)
    if (!contribution) return
    const id = extTabId(extId, key)
    const existing = findTab(id)
    if (existing) {
        webTabs.activeId = id
        existing.used = Date.now()
        return
    }
    // 复用 openTab 的构造逻辑，再把 id 改成稳定值（openTab 生成的是时间戳 id）。
    // openTab 的 title 是**展示文本**而非 i18n 键，故这里先把贡献的 titleKey 译好再传入，
    // 否则标签栏会直接显示 'ext.tab.xxx' 这样的原始键。
    const tab = openTab(contribution.url, tt(contribution.titleKey))
    tab.id = id
    webTabs.activeId = id
}

/**
 * 注册标签页控制点：贡献点变化时，把 `openOnStart` 的扩展标签页自动打开一次。
 *
 * 用 watch 而不是在拉取时直接开：拉取是异步的，且可能多次刷新（启用/停用扩展）；
 * watch 保证"贡献点真正生效"这一刻才开，且 autoOpened 集合防重复。
 */
export function registerExtTabs(): void {
    watch(
        () => extState.tabs.map((t) => `${t.extId}/${t.key}`).join(','),
        () => {
            for (const tab of extState.tabs) {
                if (!tab.openOnStart) continue
                const marker = `${tab.extId}/${tab.key}`
                if (autoOpened.has(marker)) continue
                autoOpened.add(marker)
                openExtTab(tab.extId, tab.key)
            }
        },
        { immediate: true }
    )
}
