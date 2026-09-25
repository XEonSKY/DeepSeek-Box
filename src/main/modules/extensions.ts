import { shell } from 'electron'
import { defineModule } from '../kernel/module'
import { broadcast } from '../kernel/runtime'
import { registerExtRoute } from '../kernel/extroute'
import { installPorts, info, setEnabled, forgive, exitSafeMode, externalRoot } from '../extensions/loader'

/**
 * 扩展管理：加载器端口的安装、扩展列表、启停与安全模式操作。
 *
 * 这个模块是**内核与扩展层之间唯一的桥**。它做两件事：
 *
 *   1. 装配期把内核的落点（挂路由 / 广播 / 通知）交给加载器（`installPorts`）——
 *      加载器因此不需要认识 Router / broadcast，内核也不需要认识加载器；
 *   2. 暴露管理端点（`GET /extensions` 等），让设置页能列出、启停扩展。
 *
 * 放在模块层而不是 kernel：内核「不认识任何功能」，扩展管理是一条功能策略，
 * 和 settings / env 同级。
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
