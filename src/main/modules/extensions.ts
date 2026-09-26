import { shell } from 'electron'
import { defineModule } from '../kernel/module'
import { broadcast } from '../kernel/runtime'
import { registerExtRoute } from '../kernel/extroute'
import { installPorts, info, setEnabled, forgive, exitSafeMode, externalRoot, reloadExt, reloadAllLoader } from '../extensions/loader'

/**
 * 扩展管理：加载器端口的安装、扩展列表、启停、重载与安全模式操作。
 *
 * 这个模块是**内核与扩展层之间唯一的桥**。它做两件事：
 *
 *   1. 装配期把内核的落点（挂路由 / 广播 / 通知）交给加载器（`installPorts`）——
 *      加载器因此不需要认识 Router / broadcast，内核也不需要认识加载器；
 *   2. 暴露管理端点（`GET /extensions` 等），让设置页能列出、启停、重载扩展。
 *
 * 放在模块层而不是 kernel：内核「不认识任何功能」，扩展管理是一条功能策略，
 * 和 settings / env 同级。
 *
 * 重载端点（`POST /extensions/:id/reload`、`POST /extensions/reload-all`）与系统能力
 * `extmanage`（`system.extmanage`）调用的是同一份加载器实现 —— 前者给外壳自己的界面用，
 * 后者给扩展生态内部协作，不存在两套行为。
 */

/** 通知渲染层扩展列表变了（设置页据此重新拉取）。 */
function notifyChanged(): void {
    broadcast('extensions:changed')
}

export default defineModule({
    id: 'extensions',
    routes: {
        GET: {
            '/extensions': () => info()
        },
        PUT: {
            '/extensions/:id/enabled': ({ params, body }) => {
                setEnabled(params.id, body.enabled === true)
                return info()
            }
        },
        POST: {
            '/extensions/:id/forgive': ({ params }) => {
                forgive(params.id)
                return info()
            },
            // 重载单个扩展：卸载 → 按当前磁盘状态重新激活（改完扩展代码立刻生效）。
            // 注意：重载「被别的扩展依赖」的扩展时，依赖方仍持有旧的动作表 ——
            // 要一并刷新请用 /extensions/reload-all。
            '/extensions/:id/reload': async ({ params }) => {
                const r = await reloadExt(params.id)
                if (!r) throw new Error(`扩展不存在：${params.id}`)
                notifyChanged()
                return info()
            },
            // 重载全部扩展：卸载全部 → 重新走一遍完整加载（等价于重启加载器，不重启 Electron）。
            '/extensions/reload-all': async () => {
                const r = await reloadAllLoader()
                notifyChanged()
                return r
            },
            '/extensions/exit-safe-mode': () => {
                exitSafeMode()
                return info()
            },
            '/extensions/open-dir': async () => {
                // 目录可能还不存在（用户从没装过外部扩展），openPath 会失败，
                // 因此先确保存在：外部扩展根目录本身是安全的（就在配置目录下）。
                const dir = externalRoot()
                await shell.openPath(dir)
            }
        }
    },
    onReady: () => {
        // 安装内核落点。必须在加载器启动之前完成 —— 否则扩展的路由挂不上。
        installPorts({
            mountRoute: registerExtRoute,
            emit: (event, payload) => broadcast(event, payload),
            notifyChanged
        })
    }
})
