import { defineModule } from '../kernel/module'
import { getCurrentUrl, sendCore } from '../kernel/runtime'
import { SERVICE, provideService } from '../kernel/services'
import { loadSettings } from '../app/settings'
import { resolveInstall, dshInstalled, listVersions, performUpdateCheck, updateDsh, installDsh, uninstallDsh } from '../dsh/manage'
import { restart, isDshRunning, stopServer } from '../dsh/dsh'

/**
 * dsh 本体：子进程启停、版本管理。
 *
 * 注：原先这里还挂着「插件（profile 组合包）」的管理端点，现已移除 —— 插件的增删启停
 * 不再由 Box 代劳。`dsh.profile.bundles` 仍会被读取（`dshPatchLayers.ts` 靠它合成有效配置层），
 * 所以 `pluginManifest.ts` 的纯读取函数保留；随功能一起删掉的只有写入与 pnpm 子进程编排。
 *
 * 同时在 `onReady` 里注册 `RESTART_DSH` 服务，供设置模块的 `/settings/apply` 调用 ——
 * 这样 modules/settings.ts 不必反过来 import dsh（会成环）。
 */
export default defineModule({
    id: 'dsh',
    onReady: () => {
        provideService(SERVICE.RESTART_DSH, () => restart())
    },
    routes: {
        GET: {
            '/dsh/url': () => getCurrentUrl(),
            '/dsh/running': () => isDshRunning(),
            '/dsh/version': () => resolveInstall(loadSettings()).version,
            '/dsh/installed': () => dshInstalled(),
            '/dsh/versions': ({ query }) => listVersions(query),
            '/dsh/update-check': ({ query }) => performUpdateCheck(loadSettings(), query)
        },
        POST: {
            '/dsh/start': () => {
                void restart()
            },
            '/dsh/stop': () => {
                stopServer()
            },
            '/dsh/restart': () => {
                void restart()
            },
            '/dsh/update': ({ body }) => updateDsh(body),
            '/dsh/install': ({ body }) => installDsh(body),
            // 标题栏刷新：请承载 dsh UI 的（核心）窗口重新加载它。
            '/dsh/reload': () => sendCore('ui:reload-dsh')
        },
        DELETE: {
            '/dsh': () => uninstallDsh()
        }
    }
})
