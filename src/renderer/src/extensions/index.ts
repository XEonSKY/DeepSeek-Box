import { refreshExtensions } from './store'
import { registerExtTabs } from './tabs'
import { registerExtPanels } from './panels'
import { installExtensionLocales } from './locales'

/**
 * 渲染层扩展加载器。
 *
 * 与主进程加载器的分工：主进程**裁决**（发现 / 排序 / 授权 / 加载），渲染层**呈现**
 * （把通过的贡献点挂到两个控制点上、订阅变化）。渲染层不做任何"该不该加载"的判断 ——
 * 那件事只在主进程做一次，否则等于把权限逻辑实现两遍。
 *
 * 启动时机：外壳 bootstrap 里、挂载 Vue 之前（与 `loadShellMeta()` 并列）。
 * 变化订阅：主进程广播 `extensions:changed` 时重新拉取并重建贡献点。
 */
export function startRendererExtensions(): void {
    // 先合并扩展自有文案（同步、纯内存）：必须在挂载 Vue 之前完成，
    // 否则侧栏 titleKey 与面板 $t 会在首屏短暂显示原始键。
    installExtensionLocales()

    // 拉取一次（不 await：扩展不该拖慢首屏；拉回来之前贡献点列表为空，是安全的初值）。
    void refreshExtensions()

    // 订阅变化：启用 / 停用 / 安全模式切换后重新拉取。
    window.api.on('extensions:changed', () => {
        void refreshExtensions()
    })

    // 把两个控制点的注册函数挂到 store 上（store 只存数据，具体落地在这里）。
    registerExtTabs()
    registerExtPanels()
}

export { extState, refreshExtensions } from './store'
