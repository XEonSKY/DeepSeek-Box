import type { ExtManifest } from '@shared/extensions'

/**
 * 内置扩展 `xeonsky.browser` 的清单 —— 内嵌页面（webview）功能（已从内核迁到本扩展）。
 *
 * ## 它接管了什么
 *
 * 原先散在内核里的**会话策略**都收拢到这里：
 *  - UA / 代理 / 权限策略（原 `app/webview.ts` 与 `app/webviewPermissionPolicy.ts`）。
 *
 * 内核侧只留下**机制**：`system.webview` 系统扩展提供 defaultSession 的包装能力，
 * 本扩展经 `ctx.capabilities.call('webview', …)` 使用 —— 扩展不 import 内核（见 AGENTS.md 红线）。
 *
 * **不管**「窗口级机制」：`webviewTag`、阻止嵌套、右键菜单 / 快捷键挂载、真正
 * `new BrowserWindow` 都仍在内核 `app/ui.ts` —— 它们是「窗口怎么建」，且外壳的**整个内容区
 * （含 dsh Web UI 固定站）本身就靠 `<webview>` 渲染**，属核心通路，不能交给可停用的扩展
 * （否则停用本扩展即白屏）。本扩展只接管「窗口级的**纯策略**」：弹窗尺寸解析
 * （`parsePopupSize`）与「真弹窗 vs 应用内新标签」的判定（`decideOpenAction`），
 * 内核经门面 `app/webview.ts` 查询。
 *
 * ## 申请的系统能力
 *
 *  - `webview` UA / 代理 / 权限处理器（包装 defaultSession）；
 *  - `fs`      读写自己的设置与实际生效值（持久化在扩展数据目录）。
 *
 * ## 启动前配置
 *
 * `preReady.disableHardwareAcceleration` 由**内核在 ready 之前**读取并应用
 * （见 `main/extensions/preready.ts`）—— 因为 Electron 要求这一项必须早于 ready，
 * 而扩展层激活在 ready 之后，只有让内核预读清单才来得及。
 * 注意：这里**不申报**该值（即不主动禁用），而是尊重用户设置；字段留在这里是为了
 * 说明本扩展是硬件加速开关的归属者，将来若出现「某些驱动下必须禁用」的诉求，
 * 改这一处即可生效。
 *
 * ## 贡献点
 *
 *   1. 一个设置面板 `browser`（`view: 'browser'` 指向渲染层登记的实现，见
 *      `renderer/extensions/panels.ts`）：UA、默认搜索引擎、常用站点都迁到这里；
 *   2. 一个**内置标签页视图** `newtab`（`view: 'newtab'`，见
 *      `renderer/extensions/tabviews.ts`）：外壳的「新建标签页」不再是一个内建 Vue 页面，
 *      而是由本扩展提供的**程序内置标签页导航**。外壳只在扩展不可用时回落到自带的极简页。
 */
export const manifest: ExtManifest = {
    id: 'xeonsky.browser',
    name: '内嵌浏览器',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: ['webview', 'fs'],
    contributions: {
        settings: [{ key: 'browser', titleKey: 'ext.xeonskyBrowser.nav', view: 'browser', icon: 'compass' }],
        // 标签页控制点：`view` 存在时表示「本扩展提供一个程序内置标签页视图」，
        // 由外壳按视图名挂载（`url` 在这种贡献里不参与）。
        tabs: [{ key: 'newtab', titleKey: 'ext.xeonskyBrowser.engineTitle', view: 'newtab' }]
    },
    preReady: {}
}
