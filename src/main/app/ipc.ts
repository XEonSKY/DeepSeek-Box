import { app, dialog, ipcMain, shell, Menu } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { DEFAULT_SETTINGS, NEWTAB_URL } from '@shared/types'
import type { InstallKind, InstalledVersions, NodeDeployProgress, ResolvedLocale, Settings } from '@shared/types'
import { resolveLocale, localeCodeOf } from '@shared/i18n'
import { readDiskSettings, persistSettings, syncDshTheme, syncNativeTheme, loadSettings, dshLocale, writeDshLocale, configDirInfo, setConfigDir, revertConfigDir, runConfigMigration, cancelConfigMigration, normalizeNpmSource } from './settings'
import { readCurrentBalance, readModelsInfo } from './models'
import { resolveInstall, dshInstalled, listVersions, performUpdateCheck, updateDsh, installDsh, uninstallDsh, listInstalledDshVersions, useDshVersion, removeInstalledDshVersion } from '../dsh/manage'
import { getLogHistory, restart, isDshRunning, stopServer } from '../dsh/dsh'
import { appMeta, appSlotsState, appUpdateState, triggerAppUpdate, restartAndInstall, rollbackAppUpdate } from './appupdate'
import { broadcast, getCurrentUrl, getMainWindow, sendCore, sendToWindow, sendToWcId } from './runtime'
import { isCoreWindow, windowByContentsId, listWindows } from './windowreg'
import { openStandaloneWindow, focusCoreWindow, takeOpenIntent, createSecondaryShellWindow, syncGlobalHotkey, globalHotkeyState } from './ui'
import { applyWebviewProxy, applyWebviewUserAgent, defaultUserAgent, effectiveUserAgent } from './webview'
import { applyAutoLaunch } from './autolaunch'
import { findSystemNode, findSystemNpm, nodeVersionOf, localNodeExecPath } from '../dsh/tools'
import { deployLocalNode, listNodeVersions, nodeStatus, listInstalledNodeVersions, useNodeVersion, removeInstalledNodeVersion } from '../dsh/nodeenv'
import { listNpmVersions, npmStatus, updateNpm, ensureBundledNpmReady, listInstalledNpmVersions, useNpmVersion, removeInstalledNpmVersion } from '../dsh/npmRunner'
import { cancelActive } from '../dsh/cancel'
import { APP_TITLE } from './const'

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
    return v === 'node' || v === 'npm' || v === 'dsh' ? v : null
}

/** 已安装 / 生效的版本列表。 */
function versionsFor(kind: InstallKind): InstalledVersions {
    if (kind === 'node') return listInstalledNodeVersions()
    if (kind === 'npm') return listInstalledNpmVersions()
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

export function registerIpc(): void {
    ipcMain.handle('settings:get', () => {
        const merged: Settings = { ...DEFAULT_SETTINGS, ...readDiskSettings() }
        merged.npmSource = normalizeNpmSource(merged.npmSource)
        return merged
    })
    // 界面语言：读/写 dsh settings.yaml 的 locale.preference（zh/en）。
    ipcMain.handle('i18n:get', () => resolveLocale(dshLocale(), app.getLocale()))
    ipcMain.handle('i18n:set', (_e, loc: ResolvedLocale) => {
        writeDshLocale(localeCodeOf(loc))
        return loc
    })
    // Persist only — the renderer auto-saves edits without restarting dsh.
    ipcMain.handle('settings:save', async (_e, s: Settings) => {
        const merged: Settings = { ...DEFAULT_SETTINGS, ...s }
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
        // 广播给**所有**窗口（含发起保存的那一个）：状态栏的余额授权、内嵌网页的缩放 / 搜索引擎
        // 这类「从设置派生的状态」都靠这条事件刷新，而 settings.json 的 file watcher 对程序自己
        // 的写入是刻意静默的（见 settings.ts 的 lastSelfSettingsWrite）——不在这里补一条，同窗口内
        // 的改动就只能等重启才生效。保存方自己会忽略这次回放（见 useSettingsStore 的 lastSaveAt）。
        broadcast('settings:changed', merged)
        return merged
    })
    // Explicit "apply": restart dsh so the persisted settings take effect.
    ipcMain.handle('settings:apply', () => {
        void restart()
    })
    // Restore every setting to its default.
    ipcMain.handle('settings:reset', async () => {
        const d: Settings = { ...DEFAULT_SETTINGS }
        persistSettings(d)
        syncDshTheme(d.theme)
        syncNativeTheme(d.theme)
        applyAutoLaunch(d.autoLaunch)
        await applyWebviewProxy(d)
        broadcast('settings:changed', d)
        return d
    })
    ipcMain.handle('log:history', () => getLogHistory())
    ipcMain.handle('dsh:url:get', () => getCurrentUrl())
    ipcMain.handle('dsh:running', () => isDshRunning())
    ipcMain.handle('dsh:start', () => {
        void restart()
    })
    ipcMain.handle('dsh:stop', () => {
        stopServer()
    })
    ipcMain.handle('dsh:restart', () => {
        void restart()
    })
    ipcMain.handle('zoom:set', (e, percent: number) => {
        const w = windowOfSender(e)
        if (!w) return
        const p = Math.max(50, Math.min(200, Number(percent) || 100))
        w.webContents.setZoomFactor(p / 100)
    })
    ipcMain.on('app:relaunch', () => {
        app.relaunch()
        app.exit(0)
    })
    ipcMain.handle('dsh:version', () => resolveInstall(loadSettings()).version)
    ipcMain.handle('dsh:installed', () => dshInstalled())
    ipcMain.handle('dsh:versions', (_e, opts) => listVersions(opts))
    ipcMain.handle('update:check', (_e, opts) => performUpdateCheck(loadSettings(), opts))
    ipcMain.handle('appupdate:meta', () => appMeta())
    ipcMain.handle('appupdate:trigger', (_e, opts: { prerelease: boolean }) => triggerAppUpdate(opts))
    ipcMain.handle('appupdate:state', () => appUpdateState())
    ipcMain.handle('appupdate:slots', () => appSlotsState())
    ipcMain.handle('appupdate:rollback', () => rollbackAppUpdate())
    ipcMain.on('appupdate:restart', () => restartAndInstall())
    ipcMain.handle('dsh:update', (_e, opts) => updateDsh(opts))
    ipcMain.handle('dsh:install', (_e, opts) => installDsh(opts))
    ipcMain.handle('dsh:uninstall', () => uninstallDsh())
    ipcMain.handle('env:probe', async () => {
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
    ipcMain.handle('nodeenv:status', () => nodeStatus())
    ipcMain.handle('nodeenv:versions', (_e, opts: { includeNonLts?: boolean } | undefined) =>
        listNodeVersions(opts?.includeNonLts === true)
    )
    ipcMain.handle('nodeenv:deploy', async (_e, opts: { version?: string } | undefined) => {
        const version = typeof opts?.version === 'string' && opts.version ? opts.version : undefined
        return deployLocalNode((p) => broadcast('nodeenv:deploy-progress', installProgress(p)), version)
    })
    ipcMain.handle('npmenv:status', () => npmStatus())
    ipcMain.handle('npmenv:versions', (_e, opts: { prerelease?: boolean } | undefined) =>
        listNpmVersions(loadSettings(), opts?.prerelease === true)
    )
    ipcMain.handle('npmenv:update', (_e, opts: { source?: unknown; version?: unknown } | undefined) =>
        updateNpm(
            {
                source: normalizeNpmSource(opts?.source),
                version: typeof opts?.version === 'string' && opts.version ? opts.version : undefined
            },
            (p) => broadcast('npmenv:progress', installProgress(p))
        )
    )
    ipcMain.handle('npmenv:ensure', (_e, opts: { version?: unknown } | undefined) =>
        ensureBundledNpmReady(
            { version: typeof opts?.version === 'string' && opts.version ? opts.version : undefined },
            (p) => broadcast('npmenv:progress', installProgress(p))
        )
    )
    // ---- 取消 / 版本管理（node · npm · dsh 通用） ----
    ipcMain.handle('install:cancel', () => cancelActive())
    ipcMain.handle('versions:list', (_e, kind: unknown) => {
        const k = asInstallKind(kind)
        return k ? versionsFor(k) : { installed: [], active: null }
    })
    ipcMain.handle('versions:use', (_e, kind: unknown, version: unknown) => {
        const k = asInstallKind(kind)
        if (!k || typeof version !== 'string' || !version) return { ok: false, message: '参数不合法', version: null }
        if (k === 'node') return useNodeVersion(version)
        if (k === 'npm') return useNpmVersion(version)
        return useDshVersion(version)
    })
    ipcMain.handle('versions:remove', (_e, kind: unknown, version: unknown) => {
        const k = asInstallKind(kind)
        if (!k || typeof version !== 'string' || !version) return { ok: false, message: '参数不合法', version: null }
        if (k === 'node') return removeInstalledNodeVersion(version)
        if (k === 'npm') return removeInstalledNpmVersion(version)
        return removeInstalledDshVersion(version)
    })
    ipcMain.handle('configdir:get', () => configDirInfo())
    ipcMain.handle('hotkey:state', () => globalHotkeyState())
    ipcMain.handle('webview:info', () => ({
        defaultUserAgent: defaultUserAgent(),
        currentUserAgent: effectiveUserAgent()
    }))
    // 「设置 → 模型」：读取模型列表与各供应商用量（明文密钥绝不离开主进程）。
    ipcMain.handle('models:info', () => readModelsInfo())
    // 底部状态栏：当前供应商余额（未同意读取时直接返回 null，不读配置也不联网）。
    ipcMain.handle('models:balance', () => readCurrentBalance(loadSettings().modelsCredConsent === true))
    ipcMain.handle('configdir:set', (_e, dir: string | null) => {
        return setConfigDir(typeof dir === 'string' && dir ? dir : null)
    })
    // 撤销尚未执行的迁移：固定回原配置目录。
    ipcMain.handle('configdir:revert', () => revertConfigDir())
    // 重启引导阶段由渲染层触发实际搬迁（异步，进度经 configdir:migration 广播）。
    ipcMain.handle('configdir:migrate-run', () => {
        void runConfigMigration()
    })
    // 请求取消正在执行的迁移（已搬内容回滚）。
    ipcMain.handle('configdir:migrate-cancel', () => cancelConfigMigration())
    // 本窗口元信息：winId + 是否核心窗口（核心窗口才承载 dsh UI）。
    ipcMain.handle('shell:meta', (e) => {
        return { winId: e.sender.id, isCore: isCoreWindow(e.sender.id) }
    })
    // 把一个 URL 开到独立窗口（右键“在新窗口打开 / 移动到其它窗口”）。
    ipcMain.handle('shell:open-url', (_e, url: string) => {
        openStandaloneWindow(typeof url === 'string' ? url : '')
    })
    // 副窗口“跳转核心窗口”：聚焦核心窗口（无核心则重建一个）。
    ipcMain.handle('shell:focus-core', () => {
        focusCoreWindow()
    })
    // 副窗口挂载后取走本窗口的“开页意图”（创建时若带了 URL，会据此开一个动态标签页）。
    ipcMain.handle('shell:take-open-intent', (e) => takeOpenIntent(e.sender.id))

    // ---- 跨窗口拖标签移动（由“源窗口”自行跟踪指针，屏幕坐标决定落点）----
    let dragCtx: { sourceId: number; target: string } | null = null
    let hoveredWc: number | null = null
    const setHover = (id: number | null): void => {
        if (hoveredWc === id) return
        if (hoveredWc != null) sendToWcId(hoveredWc, 'tab-drag-hover', false)
        hoveredWc = id
        if (id != null) sendToWcId(id, 'tab-drag-hover', true)
    }
    // 源窗口开始拖拽：登记 ctx，并返回“其它壳窗口”的屏幕几何，供源窗口用指针屏幕坐标算落点。
    ipcMain.handle('tab-drag:begin', (e, payload: unknown) => {
        const p = payload as { target?: unknown } | null
        const target = p && typeof p.target === 'string' && p.target ? p.target : ''
        dragCtx = target ? { sourceId: e.sender.id, target } : null
        setHover(null)
        if (!dragCtx) return []
        return listWindows()
            .filter((w) => w !== windowByContentsId(e.sender.id) && !w.isDestroyed())
            .map((w) => {
                const b = w.getBounds()
                return { id: w.webContents.id, x: b.x, y: b.y, w: b.width, h: b.height }
            })
    })
    // 源窗口报告当前“指针悬停的目标窗口 id”（主进程只把高亮发给那个窗口）。
    ipcMain.on('tab-drag:hover', (_e, payload: unknown) => {
        const p = payload as { targetId?: unknown } | null
        const id = p && typeof p.targetId === 'number' ? (p.targetId as number) : null
        setHover(id)
    })
    // 取消：清除拖拽上下文并收起所有高亮。
    ipcMain.on('tab-drag:end', () => {
        dragCtx = null
        setHover(null)
    })
    // 源窗口决定把标签移入某目标窗口。
    ipcMain.on('tab-drag:drop-to', (_e, payload: unknown) => {
        const ctx = dragCtx
        const p = payload as { targetId?: unknown } | null
        const id = p && typeof p.targetId === 'number' ? (p.targetId as number) : -1
        dragCtx = null
        setHover(null)
        if (!ctx || id < 0) return
        sendToWcId(id, 'ui:new-tab', ctx.target) // 目标窗口开该标签（含内置导航页伪链接）
        sendToWcId(ctx.sourceId, 'tab-drag:moved') // 通知源窗口移除被拖标签
        focusWindowById(id) // 释放后聚焦“接收窗口”
    })
    // 副窗口把“当前标签页标题”同步给主进程，主进程据此命名窗口：<标签页标题> - 软件名。
    ipcMain.on('shell:set-title', (e, title: unknown) => {
        const w = windowOfSender(e)
        if (!w) return
        const label = typeof title === 'string' && title.trim() ? title.trim() : ''
        w.setTitle(label ? `${label} - ${APP_TITLE}` : APP_TITLE)
    })
    // “移动到其它窗口”：弹一个原生菜单列出其它壳窗口供用户选择目标；选中的目标窗口开一个
    // 动态标签页承载 url，随后源窗口移除其标签。若当前没有其它窗口则回退到新开一个副窗口。
    // resolve true 表示确实移走了（源窗口应关闭对应标签）；false 表示用户取消（保留标签）。
    ipcMain.handle(
        'shell:move-tab',
        (e, url: unknown) =>
            new Promise<boolean>((resolve) => {
                const src = windowOfSender(e)
                const u = typeof url === 'string' ? url : ''
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
    ipcMain.handle('app:openExternal', async (_e, url: string) => {
        if (/^https?:/i.test(url)) await shell.openExternal(url)
    })
    ipcMain.handle('dialog:openDirectory', async (e) => {
        const w = windowOfSender(e)
        if (!w) return null
        const r = await dialog.showOpenDialog(w, {
            title: '选择工作目录',
            properties: ['openDirectory', 'createDirectory']
        })
        return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
    })
    ipcMain.handle('dialog:openFile', async (e) => {
        const w = windowOfSender(e)
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
    ipcMain.on('app:quit', () => app.quit())

    // Frameless-window controls driven by each window's own custom title bar.
    ipcMain.on('win:minimize', (e) => windowOfSender(e)?.minimize())
    ipcMain.on('win:maximize-toggle', (e) => {
        const w = windowOfSender(e)
        if (!w) return
        if (w.isMaximized()) w.unmaximize()
        else w.maximize()
    })
    // 自定义标题栏要按状态切换「最大化 / 还原」。这里给一次当前值；之后的变化由 ui.ts 的窗口事件定向推送。
    ipcMain.handle('win:is-maximized', (e) => !!windowOfSender(e)?.isMaximized())
    ipcMain.on('win:close', (e) => windowOfSender(e)?.close())

    // Title-bar refresh: ask the (core) window that hosts the dsh UI to reload it.
    ipcMain.on('web:reload', () => sendCore('ui:reload-dsh'))
}
