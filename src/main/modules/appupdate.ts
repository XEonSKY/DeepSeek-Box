import { app } from 'electron'
import { defineModule } from '../kernel/module'
import { appMeta, appSlotsState, appUpdateState, triggerAppUpdate, restartAndInstall, rollbackAppUpdate } from '../app/appupdate'

/**
 * 应用元信息与自动更新（A/B 版本槽）。
 *
 * `/app/relaunch` 与 `/app/quit` 也归这里：它们都是「应用生命周期」动作，与更新同属一类。
 */
export default defineModule({
    id: 'appupdate',
    routes: {
        GET: {
            '/app/meta': () => appMeta(),
            '/app/update/state': () => appUpdateState(),
            '/app/update/slots': () => appSlotsState()
        },
        POST: {
            '/app/update/check': ({ body }) => triggerAppUpdate(body),
            '/app/update/rollback': async () => rollbackAppUpdate(),
            '/app/update/restart': () => restartAndInstall(),
            '/app/relaunch': () => {
                app.relaunch()
                app.exit(0)
            },
            '/app/quit': () => app.quit()
        }
    }
})
