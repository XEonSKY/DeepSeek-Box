import { app, BrowserWindow, Menu, Tray, globalShortcut, nativeImage, nativeTheme } from 'electron'
import type { NativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { NEWTAB_URL, isNewTabTarget } from '@shared/types'
import type { HotkeyState } from '@shared/types'
import { matchesAccelerator } from '@shared/hotkeys'
import { CONTENT_HEIGHT, CONTENT_WIDTH, STATUSBAR_HEIGHT, TITLEBAR_HEIGHT } from '@shared/chrome'
import { loadSettings, mt, configMigrationPlan } from './settings'
import { APP_TITLE } from './const'
import {
    getCurrentUrl,
    getMainWindow,
    setMainWindow,
    getTray,
    setTray,
    isQuitting,
    setQuitting,
    destroyTray,
    broadcast,
    sendToWindow,
    sendToWcId,
    sendCore
} from '../kernel/runtime'
import { registerShellWindow, hasCoreWindow, promoteNextToCore, windowByContentsId, listWindows } from './windowreg'
import { attachContextMenu } from './contextmenu'
import { dshInstalled } from '../dsh/manage'
import { effectiveIconPath } from './appicon'

/** 渲染层入口：dev 下是 Vite server URL，打包后是 index.html 的绝对路径。 */
export function rendererIndex(): string {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) return devUrl
    return path.join(__dirname, '../renderer/index.html')
}

/**
 * 应用图标路径：用户在「设置 → 外观 → 程序图标」里选定的自定义 / 预制图标优先（见 appicon.ts），
 * 未自定义时回退内置 Logo —— 深色模式下优先 `resources/icon-dark.png`，否则 `resources/icon.png`。
 *
 * main 侧的 `nativeTheme.shouldUseDarkColors` 即是**已解析**的明暗：外壳主题经
 * `syncNativeTheme()` 写入 `nativeTheme.themeSource`，故 `theme: 'system'` 也会跟随系统。
 * 缺文件时回退到浅色图标，避免设置成空图标。
 */
function appIconPath(): string {
    return effectiveIconPath(loadSettings().appIcon)
}

/** 当前应用图标（路径不存在时返回 undefined，交由调用方决定回退）。 */
function appIconImage(): NativeImage | undefined {
    const p = appIconPath()
    return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined
}

let iconThemeHooked = false

/**
 * 让所有壳窗口与托盘图标跟随明暗切换（深浅色用不同 Logo）。幂等：只挂一次监听。
 * 触发源是 `nativeTheme` 的 'updated' 事件（themeSource 变化或系统偏好变化都会触发）。
 */
function hookIconTheme(): void {
    if (iconThemeHooked) return
    iconThemeHooked = true
    nativeTheme.on('updated', () => {
        const img = appIconImage()
        if (!img || img.isEmpty()) return
        for (const w of listWindows()) {
            if (!w.isDestroyed()) w.setIcon(img)
        }
        const t = getTray()
        if (t && !t.isDestroyed()) t.setImage(img.resize({ width: 16, height: 16 }))
    })
}

function clampPopupPx(n: number): number {
    if (!Number.isFinite(n) || n <= 0) return 0
    return Math.max(300, Math.min(1600, Math.round(n)))
}

/** 从 window.open 的 features 提取宽高（默认用 900x720）。 */
function parsePopupSize(features: string): { width: number; height: number } {
    const out = { width: 900, height: 720 }
    const mW = /(?:^|,)width=(\d+)/i.exec(features)
    const mH = /(?:^|,)height=(\d+)/i.exec(features)
    const w = mW ? clampPopupPx(Number(mW[1])) : 0
    const h = mH ? clampPopupPx(Number(mH[1])) : 0
    if (w) out.width = w
    if (h) out.height = h
    return out
}

/** 弹窗特征：带 frameName 或 features 视为真弹窗（开独立窗口），否则按普通新标签链接处理。 */
function isPopupRequest(frameName: string, features: string): boolean {
    return !!frameName || !!features
}

/**
 * 某 webview 内发生的 target=_blank / window.open：
 * - 真弹窗（带 frameName/features）→ 独立轻量 BrowserWindow（不入壳窗口册）。
 * - 普通 target=_blank → 应用内新标签页，但只定向到“发起者所在的那个壳窗口”
 *   （多窗口下不再群发给所有窗口）。owner 为发起窗口；缺省（如弹窗内再点普通链接）回退到核心窗口。
 */
function openWebWindow(url: string, frameName: string, features: string, owner?: BrowserWindow | null): void {
    if (!/^https?:/i.test(url)) return
    if (isPopupRequest(frameName, features)) {
        createPopupWindow(url, features)
    } else if (owner && !owner.isDestroyed()) {
        sendToWindow(owner, 'ui:new-tab', url)
    } else {
        sendCore('ui:new-tab', url)
    }
}

/**
 * 给「真弹窗」（webview 里 window.open 打开的独立窗口）补上壳窗口本来就有的两项：
 *  - 右键菜单：Electron 没有内建右键菜单，不挂这一项右键就完全没有反应；
 *  - 应用内快捷键：切换终端视图 / DevTools。
 * 弹窗不属于壳窗口，所以「切换终端视图」转交给核心窗口处理。
 */
function attachPopupBehaviors(win: BrowserWindow): void {
    const wc = win.webContents
    attachContextMenu(wc, win)
    const isMac = process.platform === 'darwin'
    wc.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return
        const s = loadSettings()
        const ev = { key: input.key, control: input.control, meta: input.meta, alt: input.alt, shift: input.shift }
        if (matchesAccelerator(s.hotkeyToggleTerminal, ev, isMac)) {
            event.preventDefault()
            sendCore('ui:toggle-view')
            return
        }
        // DevTools 快捷键：只在「开发模式」开启时生效（与壳窗口语义一致）。
        if (matchesAccelerator(s.hotkeyDevTools, ev, isMac)) {
            event.preventDefault()
            if (!s.devMode) return
            if (wc.isDevToolsOpened()) wc.closeDevTools()
            else wc.openDevTools({ mode: 'detach' })
        }
    })
}

/** 建一个独立的网页窗口（真弹窗用）。不属于壳窗口，不入册、不参与核心接管。 */
function createPopupWindow(url: string, features: string): void {
    const { width, height } = parsePopupSize(features)
    const iconPath = appIconPath()
    const win = new BrowserWindow({
        width,
        height,
        autoHideMenuBar: true,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false
        }
    })
    attachPopupBehaviors(win)
    win.webContents.setWindowOpenHandler(({ url: u, frameName, features: f }) => {
    // 弹窗内再要新开：普通链接交给核心窗口（无明确发起壳窗口）；真弹窗继续开弹窗。
        openWebWindow(u, frameName, f)
        return { action: 'deny' }
    })
    win.once('ready-to-show', () => win.show())
    void win.loadURL(url).catch(() => {
        if (!win.isDestroyed()) win.close()
    })
}

// ---------------------------------------------------------------------------
// Shell-window lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * 一个壳窗口被真正销毁后的收尾：若它正是当前“主(核心)窗口”则清空句柄；随后若已无核心
 * 但仍有多余壳窗口存活，则把核心角色移交给“现存最早”的副窗口，设为主窗口并告诉它：
 *   - shell:core(true)  → renderer 补上三固定站并回到 dsh UI；
 *   - dsh:url           → 新核心此前未收过 dsh 地址，补发当前 dsh URL。
 */
function finalizeWindowClosed(win: BrowserWindow): void {
    if (getMainWindow() === win) setMainWindow(null)
    if (isQuitting()) return // 真退出：不把角色递给同样在关闭的窗口
    if (hasCoreWindow()) return // 还有别的核心窗口在跑（例如刚创建的新核心）
    const nextId = promoteNextToCore()
    if (nextId == null) return // 已无其它壳窗口
    const next = windowByContentsId(nextId)
    if (!next) return
    setMainWindow(next)
    sendToWcId(nextId, 'shell:core', true)
    const url = getCurrentUrl()
    if (url) sendToWcId(nextId, 'dsh:url', url)
}

/**
 * 副窗口“首次打开的 URL”暂存：主进程在创建带 initialUrl 的副窗口时放入，渲染层挂载后
 * 用 shell:take-open-intent 取走并据此开一个动态标签页。用“取走”而非 did-finish-load 里
 * 直接发 ui:new-tab，是为了避免与渲染层订阅 onNewTab 的时序竞态（漏掉初始 URL）。
 */
const openIntent = new Map<number, string>()

/** 取走并清除某窗口的开页意图；无则 null。 */
export function takeOpenIntent(wcId: number): string | null {
    if (wcId == null) return null
    const u = openIntent.get(wcId) ?? null
    openIntent.delete(wcId)
    return u
}

/**
 * 建一个壳窗口（核心或副窗口）并挂上所有与角色/多窗口相关的处理。核心窗口承载 dsh
 * UI；副窗口是带完整标签条的浏览器窗口，但无 dsh UI 固定站，且 UI 事件均只发回本窗口。
 */
function buildShellWindow(core: boolean, initialUrl?: string): BrowserWindow {
    Menu.setApplicationMenu(null)
    hookIconTheme() // 窗口/托盘图标跟随深浅色（幂等，只挂一次）
    const iconPath = appIconPath()

    const win = new BrowserWindow({
        // 默认 16:9 指内容区 1280×720；再加自绘的标题栏与底部状态栏（见 @shared/chrome）
        width: CONTENT_WIDTH,
        height: CONTENT_HEIGHT + TITLEBAR_HEIGHT + STATUSBAR_HEIGHT,
        minWidth: 900,
        minHeight: 600,
        title: APP_TITLE,
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        frame: false, // frameless: the renderer draws its own title bar (drag + controls)
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true, // dsh Web UI / 站点均以 <webview> 内嵌
            preload: path.join(__dirname, '../preload/index.js')
        }
    })

    registerShellWindow(win, core)
    const wcId = win.webContents.id // 捕获 id：'closed' 后 webContents 已销毁，届时不能再访问 win.webContents
    if (core) setMainWindow(win) // 主窗口语义 = 当前核心窗口（托盘/对话框回退等用它）
    if (!core && initialUrl) openIntent.set(wcId, initialUrl)
    // 核心窗口首个 ready-to-show 再显形避免白屏；副窗口立即 show()（有些环境 ready-to-show
    // 对后开的窗口不触发，会导致窗口一直隐藏、看起来“没出现”）。ready-to-show 到达时再 show 一次也无害。
    //
    // 「默认使用系统浏览器打开 DSH」开启时，核心窗口启动即隐藏到系统托盘（dsh 地址就绪后由主进程在
    // 默认浏览器里打开界面，见 dsh.ts）。但下面这些情况必须照常显示，不能藏进托盘：
    //  - 托盘不可用：否则用户没有召回入口；
    //  - 配置目录迁移进行中：迁移进度只在窗口里可见；
    //  - **dsh 尚未安装**（未初始化）：此时窗口里是安装向导（DshWizard），藏起来等于把
    //    初始化流程藏掉，用户只能对着托盘图标猜。
    const startHidden = core && loadSettings().openDshInBrowser && !configMigrationPlan() && dshInstalled()
    if (core) {
        win.once('ready-to-show', () => {
            if (!(startHidden && getTray())) win.show()
        })
    } else {
        win.show()
    }
    const wc = win.webContents

    // 最大化状态定向推给本窗口：自定义标题栏的「最大化 / 还原」按钮要按状态换图标与提示。
    // 除按钮外，双击拖动区、系统快捷键、Aero Snap 都会改变状态，所以监听窗口事件而不是只靠按钮回传。
    const pushMaximized = (): void => {
        if (!win.isDestroyed()) sendToWindow(win, 'win:maximized', win.isMaximized())
    }
    win.on('maximize', pushMaximized)
    win.on('unmaximize', pushMaximized)

    // Fixed window title: page titles never rename the shell window. 核心窗口恒为软件名；
    // 副窗口默认软件名，之后由渲染层用 shell:set-title 推“<当前标签页标题> - 软件名”驱动。
    wc.on('page-title-updated', (e) => e.preventDefault())
    win.on('page-title-updated', (e) => e.preventDefault())
    if (core) {
        const enforceTitle = (): void => { if (!win.isDestroyed()) win.setTitle(APP_TITLE) }
        win.once('ready-to-show', enforceTitle)
        wc.on('did-navigate', enforceTitle)
    }

    // 应用内快捷键（可在设置 → 快捷键里改；匹配规则见 shared/hotkeys.ts，修饰键必须完全一致）。
    const isMac = process.platform === 'darwin'
    const toggleViewHere = (): void => sendToWindow(win, 'ui:toggle-view')
    /** 本窗口是否要吃掉这个按键：命中「切换终端视图」或「DevTools」即吃掉。 */
    const handleHotkey = (
        input: { type: string; key: string; control: boolean; meta: boolean; alt: boolean; shift: boolean },
        event: { preventDefault: () => void }
    ): boolean => {
        if (input.type !== 'keyDown') return false
        const s = loadSettings()
        const ev = { key: input.key, control: input.control, meta: input.meta, alt: input.alt, shift: input.shift }
        if (matchesAccelerator(s.hotkeyToggleTerminal, ev, isMac)) {
            event.preventDefault()
            toggleViewHere()
            return true
        }
        // DevTools 快捷键：只在「开发模式」开启时生效（与 F12 的既有语义一致）。
        if (matchesAccelerator(s.hotkeyDevTools, ev, isMac)) {
            event.preventDefault()
            if (!s.devMode) return true
            if (wc.isDevToolsOpened()) wc.closeDevTools()
            else wc.openDevTools({ mode: 'detach' })
            return true
        }
        return false
    }
    wc.on('before-input-event', (event, input) => {
        handleHotkey(input, event)
    })
    // 右键菜单：外壳自己的 webContents（设置页输入框 / 页面里拖选的文本）
    attachContextMenu(wc, win)
    wc.on('did-attach-webview', (_event, guest) => {
        guest.on('before-input-event', (gEvent, input) => {
            handleHotkey(input, gEvent)
        })
        // 内嵌 webview（DeepSeek UI / 网页 / 动态标签）也要有复制粘贴菜单
        attachContextMenu(guest, win)
        // guest 里不得再嵌一层 webview：标签页本身已经是一层内嵌，允许再嵌既会让任意
        // 页面在我们的进程树里无限套娃，也绕开了这一层对 webview 的隔离设置
        //（dsh 官方 desktop 的侧栏浏览器同样直接拒绝嵌套）。
        guest.on('will-attach-webview', (gEvent) => gEvent.preventDefault())
        guest.setWindowOpenHandler(({ url, frameName, features }) => {
            // 本窗口的 webview 里新开：普通链接 → 本窗口新标签；真弹窗 → 独立窗口。
            openWebWindow(url, frameName, features, win)
            return { action: 'deny' }
        })
    })

    // 渲染层加载完成后：核心窗口若在它加载前 dsh 已就绪则补发地址（初始开页意图由渲染层
    // 挂载后经 shell:take-open-intent 取走，避免时序竞态）。
    wc.on('did-finish-load', () => {
        if (core) {
            const url = getCurrentUrl()
            if (url) sendToWindow(win, 'dsh:url', url)
        }
    })

    // Close behaviour：
    // - 若这是最后一个壳窗口且存在托盘 → 按「关闭程序后继续运行后台扩展和应用」的设置：
    //   开则隐藏到托盘继续后台运行，关则真正退出。
    // - 否则（有托盘且有其它窗口、或根本没有托盘）→ 让窗口真正关闭。若关掉的是核心且仍有副窗口，
    //   会在 closed 里把角色移交给最早的副窗口（见 finalizeWindowClosed），而不是退出整个应用。
    win.on('close', (e) => {
        if (isQuitting()) return // 真退出（托盘「退出」等）：放行真正关闭
        const others = listWindows().filter((w) => w !== win)
        const lastWithTray = getTray() && others.length === 0
        if (!lastWithTray) return // not the final window (or no tray) → allow real close

        e.preventDefault()

        // 「设置 → 常规」的「关闭程序后继续运行后台扩展和应用」：开 = 隐藏到托盘继续后台运行，
        // 关 = 真正退出（并优雅结束 dsh）。
        if (loadSettings().closeToTray) {
            if (!win.isDestroyed()) win.hide()
        } else {
            setQuitting(true)
            app.quit()
        }
    })

    win.on('closed', () => {
        openIntent.delete(wcId)
        finalizeWindowClosed(win)
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
        void wc.loadURL(devUrl)
    } else {
        void wc.loadFile(rendererIndex())
    }
    return win
}

/**
 * 首个（核心）壳窗口。dsh UI 固定站只在此窗口出现；它在关闭（且无托盘或非最后窗口）
 * 时被真正销毁，若有副窗口则会把核心角色移交给它们。
 */
export function createShellWindow(): void {
    buildShellWindow(true)
}

/**
 * 新建一个副窗口（完整壳、带标签条、isCore=false）。url 为 http(s) 时，加载后在其中开一个
 * 动态标签页承载之；url 为内置导航页伪链接(dssh://about:blank)时，在其中开一个内置导航页。
 */
export function createSecondaryShellWindow(url?: string): BrowserWindow | null {
    const okHttp = typeof url === 'string' && /^https?:/i.test(url)
    const okNewtab = isNewTabTarget(url)
    if (!okHttp && !okNewtab) return null // 只接受 http(s) 或内置导航页伪链接
    const initial = okNewtab ? NEWTAB_URL : (url as string)
    try {
        const win = buildShellWindow(false, initial)
        console.log('[shell] created secondary window wcId=', win.webContents.id, 'target=', initial ?? '(none)')
        return win
    } catch (err) {
        console.error('[shell] failed to create secondary window:', err)
        return null
    }
}

/**
 * 把某个标签页/URL 开到一个新副窗口（右键“在新窗口打开 / 移动到其它窗口”用）。
 */
export function openStandaloneWindow(url: string): BrowserWindow | null {
    return createSecondaryShellWindow(url)
}

/** 聚焦核心窗口（副窗口“跳转核心窗口”按钮用）；无核心则重建一个。 */
export function focusCoreWindow(): void {
    const core = getMainWindow()
    if (core && !core.isDestroyed()) {
    // 最小化时 isVisible() 仍为 true，只 show()+focus() 拉不回来，必须先 restore()。
        if (core.isMinimized()) core.restore()
        if (!core.isVisible()) core.show()
        core.focus()
        return
    }
    createShellWindow()
}

/** Show the main (core) window, or recreate it if it was destroyed. */
export function showMainWindow(): void {
    const w = getMainWindow()
    if (w && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore()
        if (!w.isVisible()) w.show()
        w.focus()
    } else {
        createShellWindow()
    }
}

// ---------------------------------------------------------------------------
// 系统全局快捷键（设置 → 快捷键）：任何程序里按下都回到主窗口
// ---------------------------------------------------------------------------

/** 当前已注册的全局 accelerator（空串 = 没有）。用于幂等：值没变就什么都不做。 */
let registeredGlobalHotkey = ''

/** 把主进程 globalShortcut 的真实状态告诉渲染层（设置页据此提示「被占用」）。 */
function pushHotkeyState(state: HotkeyState): void {
    broadcast('hotkey:state', state)
}

/** 当前全局快捷键状态（渲染层进入设置页时问一次）。 */
export function globalHotkeyState(): HotkeyState {
    const want = (loadSettings().hotkeyFocusWindow || '').trim()
    return { accelerator: registeredGlobalHotkey || want, ok: !want || registeredGlobalHotkey === want }
}

/**
 * 按设置注册「返回主窗口」的系统全局快捷键。**幂等**：值没变就直接返回（settings:save 每次落盘都会调它）。
 * 注册可能失败（被别的程序占用），失败时广播 `hotkey:state`，设置页会给出提示。
 * 必须在 `app.whenReady()` 之后调用。
 */
export function syncGlobalHotkey(): void {
    const want = (loadSettings().hotkeyFocusWindow || '').trim()
    if (want === registeredGlobalHotkey) return
    if (registeredGlobalHotkey) {
        try {
            globalShortcut.unregister(registeredGlobalHotkey)
        } catch {
            /* 已经不在了 */
        }
        registeredGlobalHotkey = ''
    }
    if (!want) {
        pushHotkeyState({ accelerator: '', ok: true })
        return
    }
    let ok: boolean
    try {
        ok = globalShortcut.register(want, () => showMainWindow())
    } catch {
        ok = false
    }
    if (ok) registeredGlobalHotkey = want
    pushHotkeyState({ accelerator: want, ok })
}

/** System tray: close hides the (core) window here; "退出" really quits (and stops dsh). */
export function createTray(): void {
    try {
        const iconPath = appIconPath()
        let img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
        if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 })
        const t = new Tray(img)
        setTray(t)

        const visibleWindow = (): BrowserWindow | null => {
            const w = getMainWindow()
            return w && !w.isDestroyed() ? w : null
        }
        t.setToolTip(APP_TITLE)
        t.setContextMenu(
            Menu.buildFromTemplate([
                {
                    label: mt('m.tray.showHide'),
                    click: () => {
                        const w = visibleWindow()
                        if (w && w.isVisible()) w.hide()
                        else showMainWindow()
                    }
                },
                { type: 'separator' },
                { label: mt('m.tray.quitDsh'), click: quitApp }
            ])
        )
        t.on('click', () => {
            const w = visibleWindow()
            if (w && w.isVisible()) w.hide()
            else showMainWindow()
        })
    } catch (err) {
    // Tray may be unavailable (e.g. some Linux setups). Degrade gracefully.
        console.error('[Manager] failed to create tray:', err)
        setTray(null)
    }
}

/** Tray-driven real quit. */
export function quitApp(): void {
    setQuitting(true)
    destroyTray()
    app.quit()
}
