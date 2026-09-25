import path from 'node:path'
import { app } from 'electron'
import { registerIpc, runModuleReady, runModuleQuit } from './app/ipc'
import { startAutoCheckIfEnabled, noteGracefulExit } from './app/appupdate'
import { loadSettings, startConfigWatchers, readDiskSettings, syncNativeTheme, ensureDefaultConfigMigration, waitForConfigMigration } from './app/settings'
import { createShellWindow, createTray, showMainWindow, syncGlobalHotkey } from './app/ui'
import { applyHardwareAcceleration, applyWebviewProxy, applyWebviewUserAgent, installWebviewPermissionPolicy } from './app/webview'
import { applyAutoLaunch } from './app/autolaunch'
import { resolveInstall } from './dsh/manage'
import { migrateLegacyInstalls } from './dsh/installs'
import { nodeVersionOf } from './dsh/tools'
import { restart, killServer, stopDshGracefully } from './dsh/dsh'
import { killAllChildren } from './dsh/logbus'
import { getTray, setQuitting, destroyTray } from './kernel/runtime'
import { startLoader, stopLoader } from './extensions/loader'

// ---------------------------------------------------------------------------
// Dev vs release isolation. A dev run must not grab the installed release's
// single-instance lock; otherwise launching dev while the packaged app is open
// would kick it (or get kicked itself). Electron keys that lock to the userData
// directory, so pointing dev at its own userData folder isolates the lock (and
// keeps the dev Chromium/updater profile apart too). Must run BEFORE
// requestSingleInstanceLock() below. The release build keeps the default path.
// NOTE: the app's own settings.json does NOT live under userData — see
// main/settings.ts configDir() (~/.dsbox/{release,dev}).
// ---------------------------------------------------------------------------
if (!app.isPackaged) {
    app.setPath('userData', path.join(app.getPath('appData'), `${app.getName()} (dev)`))
}

// ---------------------------------------------------------------------------
// 配置目录默认位置迁到 ~/.dsbox/{release,dev}：若旧默认目录（~/.config/dsh_shell[_dev]
// 或短暂用过的 ~/dsbox/{release,dev}）仍有内容且用户从未自选过目录，登记一份迁移计划，
// 本次重启的引导阶段执行。
// 必须在任何 readDiskSettings() 之前调用，否则会读到还不存在的新目录。
// ---------------------------------------------------------------------------
ensureDefaultConfigMigration()

// 忽略系统显示缩放：若设置开启，在 ready 前强制设备缩放系数为 1（需重启生效）。
try {
    const boot = readDiskSettings()
    if (boot.ignoreSystemScale) {
        app.commandLine.appendSwitch('force-device-scale-factor', '1')
    }
} catch {
    /* settings not readable yet; fall back to OS scaling */
}

// ---------------------------------------------------------------------------
// Single-instance guard: acquire the lock as early as possible. If another
// instance already holds it, this second process quits immediately; the OS
// forwards the new launch attempt to the first instance via 'second-instance'.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
    // Another instance is already running (two shells would fight over the same
    // port / workspace / dsh watchdog), so there is nothing left for this one to do.
    app.quit()
} else {
    app.on('second-instance', () => {
    // A user (re)launched the app while it is already running (desktop
    // shortcut, installer-launched copy, …). Bring the existing window — which
    // may be tray-hidden or minimized — back to the front instead of opening a
    // duplicate shell.
        showMainWindow()
    })

    // 硬件加速必须在 app ready **之前**决定（Electron 限制）：先单独读一次设置。
    // 读失败就按默认（开着加速）继续，不能让设置文件的问题拦住启动。
    try {
        applyHardwareAcceleration(loadSettings())
    } catch {
    /* 用默认值 */
    }

    // Boot: wire IPC, start the external-config watchers, open the window/tray,
    // and launch dsh when it is present.
    app.whenReady().then(async () => {
        const cfg = loadSettings()
        syncNativeTheme(cfg.theme) // 建窗前先让 webview 深浅色与外壳一致
        // UA 与代理同理：都只能在 ready 之后设（defaultSession 尚不存在），且必须早于建窗。
        applyWebviewUserAgent(cfg)
        // 权限策略同样必须在建窗之前装到 defaultSession 上：晚一步的话，先建出来的 webview
        // 拿到的还是「未装处理器 = 默认放行一切」的策略。
        installWebviewPermissionPolicy()
        await applyWebviewProxy(cfg)
        registerIpc()
        // 各模块的 onReady：注册内核服务、准备需要 Electron 就绪态的能力（建窗之前）。
        await runModuleReady()
        // 扩展层加载：在模块 onReady 之后（此时系统扩展依赖的内核能力已就绪）、建窗之前。
        // 加载器自身的失败已被它内部隔离，这里再包一层只是保证「扩展坏了也不挡启动」。
        try {
            await startLoader()
        } catch (err) {
            console.error('[ext] 扩展层启动失败（已忽略，继续启动应用）', err)
        }
        createShellWindow() // 首个窗口注册为核心窗口（内部登记角色并设为主窗口）
        createTray()
        syncGlobalHotkey() // 系统全局快捷键（默认 Ctrl+Alt+H 回到主窗口）
        applyAutoLaunch(cfg.autoLaunch) // 开机自启：让系统登录项与本机设置保持一致

        // 有配置目录迁移计划时，先等渲染层把进度显示完、主进程搬完，再启动 dsh：
        // 否则 dsh 目录会在运行时被搬走。（无计划时立即返回。）
        await waitForConfigMigration()
        // 旧的平铺安装目录（<root>/node.exe、<root>/package、<root>/node_modules）迁移为版本化布局。
        await migrateLegacyInstalls(nodeVersionOf)
        startConfigWatchers()

        // Launch dsh only if it is present. When missing we do not show a
        // native prompt anymore — the renderer detects it on load and shows the
        // in-app install mask (installDsh starts dsh after a successful install).
        if (resolveInstall(cfg).present) {
            void restart()
        }

        // 打包后按设置自动检查 app 更新（静默，开发态自动跳过）。
        void startAutoCheckIfEnabled()

        app.on('activate', () => {
            // macOS convention: re-show the window when the dock icon is clicked.
            showMainWindow()
        })
    })

    // Closing hides to tray when a tray exists. If there is no tray (unavailable),
    // fall back to quitting when all windows are gone.
    app.on('window-all-closed', () => {
        if (!getTray()) app.quit()
    })

    // 优雅退出：先让 dsh 收到 SIGTERM 并等待其清场（落会话/释放插件），超时才强杀兜底。
    // `before-quit` 是同步事件、无法 await——用 preventDefault 拦截首轮退出，异步完成
    // 清理后再 app.quit()；此时 cleanExitDone 已置位，`before-quit` 放行，真正退出。
    let cleanExitDone = false
    async function cleanExit(): Promise<void> {
        if (cleanExitDone) return
        cleanExitDone = true
        setQuitting(true)
        // 走得到这里说明主进程是正常退出（不是崩溃），别把这次启动记成「新版启动失败」
        noteGracefulExit()
        try {
            await stopDshGracefully()
        } catch {
            /* best effort; the force cleanup below covers any stragglers */
        }
        killAllChildren() // 收尾其余在跑子进程（如正在进行的 npm）
        try {
            await stopLoader() // 逆序卸载扩展：先让扩展自己清场，再撤贡献与能力
        } catch {
            /* 卸载失败不该挡住退出 */
        }
        await runModuleQuit() // 各模块逆序收尾（停 watcher、清资源）
        destroyTray()
    }
    const requestCleanExit = (): void => {
        if (cleanExitDone) {
            app.quit()
            return
        }
        void cleanExit().then(() => app.quit())
    }

    app.on('before-quit', (e) => {
        if (cleanExitDone) return // second pass: let the real quit proceed
        e.preventDefault()
        requestCleanExit()
    })

    // 最后一道兜底：真正退出时不留孤儿进程（dsh 通常已在上面的优雅停中退出）。
    process.on('exit', () => {
        killServer()
        killAllChildren()
    })
    process.on('SIGINT', () => {
        setQuitting(true)
        requestCleanExit()
    })
}
