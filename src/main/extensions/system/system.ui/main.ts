import { provideActions } from '../../loader/capability'
import { listByKind } from '../../loader/registry'
import type { ExtContext } from '../../loader/ctx'

/**
 * 系统扩展 `system.ui` —— 外壳界面操作的**能力声明**。
 *
 * 与其他能力不同，这个能力的**执行在渲染层**：标签页与设置面板是渲染层的两个
 * 控制点（`shell/tabs.ts`、`views/SettingsView.vue`），主进程侧只能做「登记」。
 * 因此这里提供的是「查询当前已登记的贡献」两个动作 —— 扩展借此知道
 * 「外壳上现在挂了哪些界面元素」，用于自查与协作（例如某扩展贡献的标签页
 * 是否真的生效）。
 *
 * 之所以单独成一个能力而不是并进 `app`：界面修改的可见性最强、最需要审计，
 * 且系统能力按**能力域**拆开正是为了让授权有粒度（「要么全给要么全不给」会让申请失去意义）。
 */

/** 允许的动作。 */
const actions = {
    /** 当前已登记的标签页贡献（`<extId>/<key>` → 拥有者）。 */
    tabs: (): Array<{ key: string; owner: string }> => listByKind('tab'),
    /** 当前已登记的设置面板贡献。 */
    panels: (): Array<{ key: string; owner: string }> => listByKind('settings-panel'),
    /** 当前已登记的扩展自有端点（供扩展排查自己的通道名）。 */
    routes: (): Array<{ key: string; owner: string }> => listByKind('route')
}

export function activate(ctx: ExtContext): void {
    provideActions(ctx.id, 'ui', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info('capability provided: ui (actions: tabs, panels, routes)')
}
