import { defineModule } from '../kernel/module'
import { getCurrentUrl, sendCore, broadcast } from '../kernel/runtime'
import { trackedOperation } from '../kernel/operations'
import { SERVICE, provideService } from '../kernel/services'
import { loadSettings } from '../app/settings'
import { resolveInstall, dshInstalled, listVersions, performUpdateCheck, updateDsh, installDsh, uninstallDsh } from '../dsh/manage'
import { restart, isDshRunning, stopServer } from '../dsh/dsh'
import { readPluginsInfo, setPluginEnabled, installDshPlugin, removeDshPlugin } from '../dsh/plugins'

/** 进度广播落点（kernel 的 trackedOperation 只判断「要不要发」，发到哪由模块决定）。 */
const emitProgress = (channel: string, payload: Parameters<typeof broadcast>[1]): void => broadcast(channel, payload)

/**
 * dsh 本体：子进程启停、版本管理、插件（profile 组合包）。
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
            '/dsh/update-check': ({ query }) => performUpdateCheck(loadSettings(), query),
            // dsh 插件（profile 组合包）：读插件信息。
            '/dsh/plugins': ({ query }) => readPluginsInfo(typeof query?.profile === 'string' && query.profile ? query.profile : undefined)
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
            '/dsh/reload': () => sendCore('ui:reload-dsh'),
            '/dsh/plugins/:profile/install': ({ params, body }) => {
                const spec = typeof body?.spec === 'string' ? body.spec : ''
                return trackedOperation('dsh-plugin', emitProgress, (onProgress) => installDshPlugin(params.profile, spec, onProgress))
            },
            '/dsh/plugins/:profile/remove': ({ params, body }) => {
                const name = typeof body?.name === 'string' ? body.name : ''
                return removeDshPlugin(params.profile, name)
            }
        },
        PUT: {
            '/dsh/plugins/:profile/enabled': ({ params, body }) => {
                const enabled = body?.enabled === true
                const name = typeof body?.name === 'string' ? body.name : ''
                return setPluginEnabled(params.profile, name, enabled)
            }
        },
        DELETE: {
            '/dsh': () => uninstallDsh()
        }
    }
})
