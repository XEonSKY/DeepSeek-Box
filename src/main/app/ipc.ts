import { app, dialog, shell, Menu } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { DEFAULT_SETTINGS, NEWTAB_URL } from '@shared/types'
import type { InstallKind, InstalledVersions, NodeDeployProgress, Settings } from '@shared/types'
import { resolveLocale, localeCodeOf } from '@shared/i18n'
import { readDiskSettings, persistSettings, syncDshTheme, syncNativeTheme, loadSettings, dshLocale, writeDshLocale, configDirInfo, setConfigDir, revertConfigDir, runConfigMigration, cancelConfigMigration, normalizeNpmSource } from './settings'
import { readCurrentBalance, readModelsInfo } from './models'
import { resolveInstall, dshInstalled, listVersions, performUpdateCheck, updateDsh, installDsh, uninstallDsh, listInstalledDshVersions, useDshVersion, removeInstalledDshVersion } from '../dsh/manage'
import { restart, isDshRunning, stopServer } from '../dsh/dsh'
import { getLogHistory } from '../dsh/logbus'
import { appMeta, appSlotsState, appUpdateState, triggerAppUpdate, restartAndInstall, rollbackAppUpdate } from './appupdate'
import { broadcast, getCurrentUrl, getMainWindow, sendCore, sendToWindow, sendToWcId } from './runtime'
import { isCoreWindow, windowByContentsId, listWindows } from './windowreg'
import { openStandaloneWindow, focusCoreWindow, takeOpenIntent, createSecondaryShellWindow, syncGlobalHotkey, globalHotkeyState } from './ui'
import { confirmDialogContext, openConfirmDialog, replyConfirmDialog } from './confirmDialog'
import { applyWebviewProxy, applyWebviewUserAgent, defaultUserAgent, effectiveUserAgent } from './webview'
import { applyAutoLaunch } from './autolaunch'
import { listAppIcons, currentAppIcon, saveUserIcon, deleteUserIcon, applyAppIcon } from './appicon'
import { findSystemNode, findSystemNpm, nodeVersionOf, localNodeExecPath } from '../dsh/tools'
import { deployLocalNode, listNodeVersions, nodeStatus, listInstalledNodeVersions, useNodeVersion, removeInstalledNodeVersion } from '../dsh/nodeenv'
import { listNpmVersions, npmStatus, updateNpm, ensureBundledNpmReady, listInstalledNpmVersions, useNpmVersion, removeInstalledNpmVersion } from '../dsh/npmRunner'
import { listPnpmVersions, pnpmStatus, updatePnpm, ensureBundledPnpmReady, listInstalledPnpmVersions, usePnpmVersion, removeInstalledPnpmVersion } from '../dsh/pnpmRunner'
import { readPluginsInfo, setPluginEnabled, installDshPlugin, removeDshPlugin } from '../dsh/plugins'
import { measureRegistrySpeed } from '../dsh/speed'
import { cancelActive } from '../dsh/cancel'
import { APP_TITLE } from './const'
import { Router } from './router'

/**
 * 多窗口下定位“发起这次 IPC 的那个壳窗口”：取 e.sender(webContents) 所属的壳窗口；
 * 异常环境退回当前主(核心)窗口。窗口级操作(缩放/最小化/关闭/对话框)都应作用到该窗口，
 * 而不是总用主窗口——否则副窗口点“关闭”会误关核心窗口。
 */
function windowOfSender(e: { sender: { id: number } }): BrowserWindow | null {
    const w = windowByContentsId(e.sender.id)
    return w && !w.isDestroyed() ? w : (getMainWindow() && !getMainWindow()!.isDestroyed() ? getMainWindow() : null)
}

/** 安装进度统一整形：解压阶段百分比无意义，仅保留 phase 供前端切动画。 */
function installProgress(p: NodeDeployProgress): NodeDeployProgress {
    return {
        phase: p.phase,
        percent: Math.max(0, Math.min(100, Math.round(p.percent))),
        downloaded: p.downloaded,
        total: p.total,
        speed: p.speed
    }
}

/** 版本化安装对象（node / npm / dsh）的入参校验。 */
function asInstallKind(v: unknown): InstallKind | null {
    return v === 'node' || v === 'npm' || v === 'pnpm' || v === 'dsh' ? v : null
}

/** 已安装 / 生效的版本列表。 */
function versionsFor(kind: InstallKind): InstalledVersions {
    if (kind === 'node') return listInstalledNodeVersions()
    if (kind === 'npm') return listInstalledNpmVersions()
    if (kind === 'pnpm') return listInstalledPnpmVersions()
    return listInstalledDshVersions()
}

/** 聚焦某个壳窗口（若最小化先还原、不可见先显示），常用于“标签移入/新开后的接收窗口”。 */
function focusWindowById(wcId: number): void {
    const w = windowByContentsId(wcId)
    if (!w || w.isDestroyed()) return
    if (w.isMinimized()) w.restore()
    if (!w.isVisible()) w.show()
    w.focus()
}

/**
 * 注册全部 IPC 端点。
 *
 * 端点按 REST 风格组织（`/settings`、`/versions/:kind`、`DELETE /dsh` …），
 * 由 {@link Router} 在唯一通道上按「方法 + 路径」分发；渲染层用
 * `window.api.get('/settings')` 这类调用访问，类型来自 `@shared/api` 的 `ApiRoutes`。
 */
export function registerIpc(): void {
    const router = new Router()

    // ---- 设置 / 界面语言 ----
    router
        .get('/settings', () => {
            const merged: Settings = { ...DEFAULT_SETTINGS, ...readDiskSettings() }
            merged.npmSource = normalizeNpmSource(merged.npmSource)
            return merged
        })
        // 只落盘不重启：渲染层自动保存，dsh 不随保存重启。
        .put('/settings', async ({ body }) => {
            const merged: Settings = { ...DEFAULT_SETTINGS, ...body }
            persistSettings(merged)
            syncDshTheme(merged.theme)
            syncNativeTheme(merged.theme)
            // 快捷键改动要立刻生效（不用等 dsh 重启）：幂等，值没变时什么都不做。
            syncGlobalHotkey()
            // 开机自启同样立刻写系统登录项（幂等）。
            applyAutoLaunch(merged.autoLaunch)
            // UA 同理：改完立刻对新请求生效（已加载的页面按新 UA 重新请求）。硬件加速改不了 —— 见 webview.ts。
            applyWebviewUserAgent(merged)
            // 代理也立刻生效：已加载的内嵌网页要按新代理重新请求（dsh 子进程的代理随下次启动生效）。
            await applyWebviewProxy(merged)
            // 程序图标：换图后立刻更新所有窗口 / 托盘，并把新预览广播给渲染层。
            applyAppIcon(merged)
            // 广播给**所有**窗口（含发起保存的那一个）：状态栏的余额授权、内嵌网页的缩放 / 搜索引擎
            // 这类「从设置派生的状态」都靠这条事件刷新，而 settings.json 的 file watcher 对程序自己
            // 的写入是刻意静默的（见 settings.ts 的 lastSelfSettingsWrite）——不在这里补一条，同窗口内
            // 的改动就只能等重启才生效。保存方自己会忽略这次回放（见 useSettingsStore 的 lastSaveAt）。
            broadcast('settings:changed', merged)
            return merged
        })
        // 显式「应用」：重启 dsh 让落盘的设置生效。
        .post('/settings/apply', () => {
            void restart()
        })
        // 恢复全部设置为默认值。
        .post('/settings/reset', async () => {
            const d: Settings = { ...DEFAULT_SETTINGS }
            persistSettings(d)
            syncDshTheme(d.theme)
            syncNativeTheme(d.theme)
            applyAutoLaunch(d.autoLaunch)
            await applyWebviewProxy(d)
            applyAppIcon(d)
            broadcast('settings:changed', d)
            return d
        })
        // 界面语言：读/写 dsh settings.yaml 的 locale.preference（zh/en）。
        .get('/locale', () => resolveLocale(dshLocale(), app.getLocale()))
        .put('/locale', ({ body }) => {
            writeDshLocale(localeCodeOf(body))
            return body
        })

        // ---- 日志 ----
        .get('/logs', () => getLogHistory())

        // ---- dsh 子进程 ----
        .get('/dsh/url', () => getCurrentUrl())
        .get('/dsh/running', () => isDshRunning())
        .get('/dsh/version', () => resolveInstall(loadSettings()).version)
        .get('/dsh/installed', () => dshInstalled())
        .get('/dsh/versions', ({ query }) => listVersions(query))
        .get('/dsh/update-check', ({ query }) => performUpdateCheck(loadSettings(), query))
        .post('/dsh/start', () => {
            void restart()
        })
        .post('/dsh/stop', () => {
            stopServer()
        })
        .post('/dsh/restart', () => {
            void restart()
        })
        .post('/dsh/update', ({ body }) => updateDsh(body))
        .post('/dsh/install', ({ body }) => installDsh(body))
        .delete('/dsh', () => uninstallDsh())
        // 标题栏刷新：请承载 dsh UI 的（核心）窗口重新加载它。
        .post('/dsh/reload', () => sendCore('ui:reload-dsh'))
        // ---- dsh 插件（profile 组合包）：读 / 启停 / 安装 / 卸载 ----
        .get('/dsh/plugins', ({ query }) => readPluginsInfo(typeof query?.profile === 'string' && query.profile ? query.profile : undefined))
        .put('/dsh/plugins/:profile/enabled', ({ params, body }) => {
            const enabled = body?.enabled === true
            const name = typeof body?.name === 'string' ? body.name : ''
            return setPluginEnabled(params.profile, name, enabled)
        })
        .post('/dsh/plugins/:profile/install', ({ params, body }) => {
            const spec = typeof body?.spec === 'string' ? body.spec : ''
            return installDshPlugin(params.profile, spec, (p) => broadcast('pnmenv:progress', installProgress(p)))
        })
        .post('/dsh/plugins/:profile/remove', ({ params, body }) => {
            const name = typeof body?.name === 'string' ? body.name : ''
            return removeDshPlugin(params.profile, name)
        })

        // ---- 应用元信息 / 自动更新 ----
        .get('/app/meta', () => appMeta())
        .get('/app/update/state', () => appUpdateState())
        .post('/app/update/check', ({ body }) => triggerAppUpdate(body))
        .get('/app/update/slots', () => appSlotsState())
        .post('/app/update/rollback', () => rollbackAppUpdate())
        .post('/app/update/restart', () => restartAndInstall())
        .post('/app/relaunch', () => {
            app.relaunch()
            app.exit(0)
        })
        .post('/app/quit', () => app.quit())

        // ---- 运行环境 / Node ----
        .get('/env', async () => {
            const nodePath = findSystemNode()
            const localPath = localNodeExecPath()
            return {
                platform: process.platform,
                arch: process.arch,
                node: { present: !!nodePath, version: nodePath ? await nodeVersionOf(nodePath) : null },
                npm: !!findSystemNpm(),
                local: { present: !!localPath, version: localPath ? await nodeVersionOf(localPath) : null }
            }
        })
        .get('/node/status', () => nodeStatus())
        .get('/node/versions', ({ query }) => listNodeVersions(query?.includeNonLts === true))
        .post('/node/deploy', ({ body }) => {
            const version = typeof body?.version === 'string' && body.version ? body.version : undefined
            return deployLocalNode((p) => broadcast('nodeenv:deploy-progress', installProgress(p)), version)
        })

        // ---- npm ----
        .post('/registries/speed', () => measureRegistrySpeed())
        .get('/npm/status', () => npmStatus())
        .get('/npm/versions', ({ query }) => listNpmVersions(loadSettings(), query?.prerelease === true))
        .post('/npm/update', ({ body }) =>
            updateNpm(
                {
                    source: normalizeNpmSource(body?.source),
                    version: typeof body?.version === 'string' && body.version ? body.version : undefined
                },
                (p) => broadcast('npmenv:progress', installProgress(p))
            )
        )
        .post('/npm/ensure', ({ body }) =>
            ensureBundledNpmReady(
                { version: typeof body?.version === 'string' && body.version ? body.version : undefined },
                (p) => broadcast('npmenv:progress', installProgress(p))
            )
        )

        // ---- 内置 pnpm（dsh 插件安装用；与 npm 同构，仅内置来源）----
        .get('/pnpm/status', () => pnpmStatus())
        .get('/pnpm/versions', ({ query }) => listPnpmVersions(loadSettings(), query?.prerelease === true))
        .post('/pnpm/update', ({ body }) =>
            updatePnpm(
                { version: typeof body?.version === 'string' && body.version ? body.version : undefined },
                (p) => broadcast('pnmenv:progress', installProgress(p))
            )
        )
        .post('/pnpm/ensure', ({ body }) =>
            ensureBundledPnpmReady(
                { version: typeof body?.version === 'string' && body.version ? body.version : undefined },
                (p) => broadcast('pnmenv:progress', installProgress(p))
            )
        )

        // ---- 安装取消 / 版本管理（node · npm · dsh 通用）----
        .post('/installs/cancel', () => cancelActive())
        .get('/versions/:kind', ({ params }) => {
            const kind = asInstallKind(params.kind)
            return kind ? versionsFor(kind) : { installed: [], active: null }
        })
        .put('/versions/:kind/active', ({ params, body }) => {
            const kind = asInstallKind(params.kind)
            const version = body?.version
            if (!kind || typeof version !== 'string' || !version) return { ok: false, message: '参数不合法', version: null }
            if (kind === 'node') return useNodeVersion(version)
            if (kind === 'npm') return useNpmVersion(version)
            if (kind === 'pnpm') return usePnpmVersion(version)
            return useDshVersion(version)
        })
        .delete('/versions/:kind/:version', ({ params }) => {
            const kind = asInstallKind(params.kind)
            const version = params.version
            if (!kind || !version) return { ok: false, message: '参数不合法', version: null }
            if (kind === 'node') return removeInstalledNodeVersion(version)
            if (kind === 'npm') return removeInstalledNpmVersion(version)
            if (kind === 'pnpm') return removeInstalledPnpmVersion(version)
            return removeInstalledDshVersion(version)
        })

        // ---- 配置目录 ----
        .get('/config-dir', () => configDirInfo())
        .put('/config-dir', ({ body }) => setConfigDir(typeof body?.dir === 'string' && body.dir ? body.dir : null))
        // 撤销尚未执行的迁移：固定回原配置目录。
        .post('/config-dir/revert', () => revertConfigDir())
        // 重启引导阶段由渲染层触发实际搬迁（异步，进度经 configdir:migration 广播）。
        .post('/config-dir/migration', () => {
            void runConfigMigration()
        })
        // 请求取消正在执行的迁移（已搬内容回滚）。
        .delete('/config-dir/migration', () => cancelConfigMigration())

        // ---- 只读状态 ----
        .get('/hotkeys/state', () => globalHotkeyState())
        .get('/webview/info', () => ({
            defaultUserAgent: defaultUserAgent(),
            currentUserAgent: effectiveUserAgent()
        }))
        // 「设置 → 模型」：读取模型列表与各供应商用量（明文密钥绝不离开主进程）。
        .get('/models/info', () => readModelsInfo())
        // 底部状态栏：当前供应商余额（未同意读取时直接返回 null，不读配置也不联网）。
        .get('/models/balance', () => readCurrentBalance(loadSettings().modelsCredConsent === true))

        // ---- 程序图标（设置 → 外观）----
        .get('/icons', () => listAppIcons())
        .get('/icons/current', () => currentAppIcon())
        .post('/icons', ({ body }) => {
            const id = saveUserIcon(String(body?.name || 'icon'), body?.data as Uint8Array)
            return { id, list: listAppIcons() }
        })
        .delete('/icons/:id', ({ params }) => {
            deleteUserIcon(params.id)
            return listAppIcons()
        })

        // ---- 原生对话框 ----
        .post('/dialog/directory', async ({ event }) => {
            const w = windowOfSender(event)
            if (!w) return null
            const r = await dialog.showOpenDialog(w, {
                title: '选择工作目录',
                properties: ['openDirectory', 'createDirectory']
            })
            return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
        })
        .post('/dialog/file', async ({ event }) => {
            const w = windowOfSender(event)
            if (!w) return null
            const r = await dialog.showOpenDialog(w, {
                title: '选择启动器文件',
                properties: ['openFile'],
                filters: [
                    { name: 'launcher', extensions: ['cmd', 'bat', 'exe', 'js', 'sh', ''] },
                    { name: 'all', extensions: ['*'] }
                ]
            })
            return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
        })
        // 独立确认子窗口：开窗 → 等待确认窗回传结果。文案已由渲染层 i18n。
        .post('/dialog/confirm', async ({ event, body }) => {
            const confirmed = await openConfirmDialog(
                {
                    title: body.title,
                    message: body.message,
                    detail: body.detail,
                    confirmText: body.confirmText,
                    cancelText: body.cancelText,
                    danger: body.danger === true
                },
                windowOfSender(event)
            )
            return { confirmed }
        })
        .get('/dialog/confirm/context', ({ event }) => confirmDialogContext(event.sender.id))
        .post('/dialog/confirm/reply', ({ event, body }) => {
            replyConfirmDialog(event.sender.id, body.confirmed === true)
        })

        // ---- 外壳 / 标签 / 窗口 ----
        .post('/shell/open-external', async ({ body }) => {
            if (/^https?:/i.test(body.url)) await shell.openExternal(body.url)
        })
        // 把一个 URL 开到独立窗口（右键“在新窗口打开 / 移动到其它窗口”）。
        .post('/shell/open-url', ({ body }) => {
            openStandaloneWindow(typeof body.url === 'string' ? body.url : '')
        })
        // 副窗口“跳转核心窗口”：聚焦核心窗口（无核心则重建一个）。
        .post('/shell/focus-core', () => {
            focusCoreWindow()
        })
        // 本窗口元信息：winId + 是否核心窗口（核心窗口才承载 dsh UI）。
        .get('/shell/meta', ({ event }) => ({ winId: event.sender.id, isCore: isCoreWindow(event.sender.id) }))
        // 副窗口挂载后取走本窗口的“开页意图”（创建时若带了 URL，会据此开一个动态标签页）。
        .post('/shell/open-intent', ({ event }) => takeOpenIntent(event.sender.id))
        // 副窗口把“当前标签页标题”同步给主进程，主进程据此命名窗口：<标签页标题> - 软件名。
        .put('/shell/title', ({ event, body }) => {
            const w = windowOfSender(event)
            if (!w) return
            const label = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : ''
            w.setTitle(label ? `${label} - ${APP_TITLE}` : APP_TITLE)
        })
        .put('/windows/zoom', ({ event, body }) => {
            const w = windowOfSender(event)
            if (!w) return
            const percent = Math.max(50, Math.min(200, Number(body.percent) || 100))
            w.webContents.setZoomFactor(percent / 100)
        })
        .post('/windows/minimize', ({ event }) => windowOfSender(event)?.minimize())
        .post('/windows/maximize-toggle', ({ event }) => {
            const w = windowOfSender(event)
            if (!w) return
            if (w.isMaximized()) w.unmaximize()
            else w.maximize()
        })
        // 自定义标题栏要按状态切换「最大化 / 还原」。这里给一次当前值；之后的变化由 ui.ts 的窗口事件定向推送。
        .get('/windows/maximized', ({ event }) => !!windowOfSender(event)?.isMaximized())
        .post('/windows/close', ({ event }) => windowOfSender(event)?.close())

    // ---- 跨窗口拖标签移动（由“源窗口”自行跟踪指针，屏幕坐标决定落点）----
    let dragCtx: { sourceId: number; target: string } | null = null
    let hoveredWc: number | null = null
    const setHover = (id: number | null): void => {
        if (hoveredWc === id) return
        if (hoveredWc != null) sendToWcId(hoveredWc, 'tab-drag-hover', false)
        hoveredWc = id
        if (id != null) sendToWcId(id, 'tab-drag-hover', true)
    }
    router
        // 源窗口开始拖拽：登记 ctx，并返回“其它壳窗口”的屏幕几何，供源窗口用指针屏幕坐标算落点。
        .post('/tab-drag', ({ event, body }) => {
            const target = typeof body.target === 'string' && body.target ? body.target : ''
            dragCtx = target ? { sourceId: event.sender.id, target } : null
            setHover(null)
            if (!dragCtx) return []
            return listWindows()
                .filter((w) => w !== windowByContentsId(event.sender.id) && !w.isDestroyed())
                .map((w) => {
                    const b = w.getBounds()
                    return { id: w.webContents.id, x: b.x, y: b.y, w: b.width, h: b.height }
                })
        })
        // 源窗口报告当前“指针悬停的目标窗口 id”（主进程只把高亮发给那个窗口）。
        .patch('/tab-drag', ({ body }) => {
            setHover(typeof body.targetId === 'number' ? body.targetId : null)
        })
        // 取消：清除拖拽上下文并收起所有高亮。
        .delete('/tab-drag', () => {
            dragCtx = null
            setHover(null)
        })
        // 源窗口决定把标签移入某目标窗口。
        .post('/tab-drag/drop', ({ body }) => {
            const ctx = dragCtx
            const id = typeof body.targetId === 'number' ? body.targetId : -1
            dragCtx = null
            setHover(null)
            if (!ctx || id < 0) return
            sendToWcId(id, 'ui:new-tab', ctx.target) // 目标窗口开该标签（含内置导航页伪链接）
            sendToWcId(ctx.sourceId, 'tab-drag:moved') // 通知源窗口移除被拖标签
            focusWindowById(id) // 释放后聚焦“接收窗口”
        })
        // “移动到其它窗口”：弹一个原生菜单列出其它壳窗口供用户选择目标；选中的目标窗口开一个
        // 动态标签页承载 url，随后源窗口移除其标签。若当前没有其它窗口则回退到新开一个副窗口。
        // resolve true 表示确实移走了（源窗口应关闭对应标签）；false 表示用户取消（保留标签）。
        .post('/shell/move-tab', ({ event, body }) =>
            new Promise<boolean>((resolve) => {
                const src = windowOfSender(event)
                const u = typeof body.url === 'string' ? body.url : ''
                const okHttp = /^https?:/i.test(u)
                const okNewtab = u === NEWTAB_URL
                if (!u || (!okHttp && !okNewtab)) {
                    resolve(false)
                    return
                }
                const doOpen = (target: BrowserWindow | null): BrowserWindow | null => {
                    if (target && !target.isDestroyed()) {
                        sendToWindow(target, 'ui:new-tab', u)
                        return target
                    }
                    return createSecondaryShellWindow(u)
                }
                const candidates = listWindows().filter((w) => w !== src && !w.isDestroyed())
                let settled = false
                const finish = (ok: boolean): void => {
                    if (settled) return
                    settled = true
                    resolve(ok)
                }
                const pick = (w: BrowserWindow | null): void => {
                    const opened = doOpen(w)
                    if (opened && !opened.isDestroyed()) focusWindowById(opened.webContents.id)
                    finish(true)
                }
                if (candidates.length === 0) {
                    pick(null) // 没有其它窗口 → 直接新开
                    return
                }
                const items: MenuItemConstructorOptions[] = candidates.map((w) => ({
                    label: (w.getTitle() || APP_TITLE).trim(),
                    click: () => pick(w)
                }))
                items.push({ type: 'separator' })
                items.push({ label: '＋ 新窗口', click: () => pick(null) })
                const menu = Menu.buildFromTemplate(items)
                const anchor = src && !src.isDestroyed() ? src : undefined
                menu.popup({
                    window: anchor,
                    // 菜单被关闭（取消或 Esc）而无选择 → 视为取消
                    callback: () => finish(false)
                })
            })
        )

    router.listen()
}
