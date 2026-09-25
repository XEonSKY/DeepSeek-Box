import { app } from 'electron'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Settings } from '@shared/types'
import { resolveLocale, localeCodeOf } from '@shared/i18n'
import { broadcast } from '../kernel/runtime'
import { defineModule } from '../kernel/module'
import { operationsSnapshot } from '../kernel/operations'
import { SERVICE, useService } from '../kernel/services'
import { getLogHistory } from '../dsh/logbus'
import { writeRemoteLog } from '../kernel/logger'
import { readDiskSettings, persistSettings, syncDshTheme, syncNativeTheme, dshLocale, writeDshLocale, normalizeNpmSource } from '../app/settings'
import { syncGlobalHotkey } from '../app/ui'
import { applyAutoLaunch } from '../app/autolaunch'
import { applyWebviewProxy, applyWebviewUserAgent } from '../app/webview'
import { applyAppIcon } from '../app/appicon'

/**
 * 设置 / 界面语言 / 日志 / 操作快照。
 *
 * 这一组是「外壳自身状态」的读写口：设置落盘后要**广播**给所有窗口（派生状态靠它刷新），
 * 日志与操作快照是只读查询（供切页回来的面板重新取回现场）。
 *
 * 注意 `/settings/apply` 要重启 dsh，但 dsh 模块会反过来依赖 app/settings —— 若这里直接
 * import 就成环。故走 kernel 的服务槽：dsh 模块在自己的 `onReady` 里注册 `RESTART_DSH`。
 */
export default defineModule({
    id: 'settings',
    routes: {
        GET: {
            '/settings': () => {
                const merged: Settings = { ...DEFAULT_SETTINGS, ...readDiskSettings() }
                merged.npmSource = normalizeNpmSource(merged.npmSource)
                return merged
            },
            '/locale': () => resolveLocale(dshLocale(), app.getLocale()),
            '/logs': () => getLogHistory(),
            // 正在进行的操作快照：面板切走再切回来时靠它把进度找回来（见 kernel/operations.ts）。
            '/operations': () => operationsSnapshot()
        },
        PUT: {
            // 只落盘不重启：渲染层自动保存，dsh 不随保存重启。
            '/settings': async ({ body }) => {
                const merged: Settings = { ...DEFAULT_SETTINGS, ...body }
                persistSettings(merged)
                syncDshTheme(merged.theme)
                syncNativeTheme(merged.theme)
                // 快捷键改动要立刻生效（不用等 dsh 重启）：幂等，值没变时什么都不做。
                syncGlobalHotkey()
                // 开机自启同样立刻写系统登录项（幂等）。
                applyAutoLaunch(merged.autoLaunch)
                // UA 同理：改完立刻对新请求生效（已加载的页面按新 UA 重新请求）。硬件加速改不了 —— 见 app/webview.ts。
                applyWebviewUserAgent(merged)
                // 代理也立刻生效：已加载的内嵌网页要按新代理重新请求（dsh 子进程的代理随下次启动生效）。
                await applyWebviewProxy(merged)
                // 程序图标：换图后立刻更新所有窗口 / 托盘，并把新预览广播给渲染层。
                applyAppIcon(merged)
                // 广播给**所有**窗口（含发起保存的那一个）：状态栏的余额授权、内嵌网页的缩放 / 搜索引擎
                // 这类「从设置派生的状态」都靠这条事件刷新，而 settings.json 的 file watcher 对程序自己
                // 的写入是刻意静默的（见 app/settings.ts 的 lastSelfSettingsWrite）——不在这里补一条，同窗口内
                // 的改动就只能等重启才生效。保存方自己会忽略这次回放（见 useSettingsStore 的 lastSaveAt）。
                broadcast('settings:changed', merged)
                return merged
            },
            '/locale': ({ body }) => {
                writeDshLocale(localeCodeOf(body))
                return body
            }
        },
        POST: {
            // 显式「应用」：重启 dsh 让落盘的设置生效。
            '/settings/apply': () => {
                void (useService(SERVICE.RESTART_DSH) as () => Promise<void>)()
            },
            // 恢复全部设置为默认值。
            '/settings/reset': async () => {
                const d: Settings = { ...DEFAULT_SETTINGS }
                persistSettings(d)
                syncDshTheme(d.theme)
                syncNativeTheme(d.theme)
                applyAutoLaunch(d.autoLaunch)
                await applyWebviewProxy(d)
                applyAppIcon(d)
                broadcast('settings:changed', d)
                return d
            },
            // 渲染层日志上报：用自己的 logger 重记一遍，落进同一份文件（见 kernel/logger.ts）。
            '/logs/renderer': ({ body }) => {
                writeRemoteLog(body)
            }
        }
    }
})
