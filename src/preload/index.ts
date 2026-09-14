import { contextBridge, ipcRenderer } from 'electron'
import type { AppUpdateEvent, ConfigMigrationProgress, HotkeyState, LocaleCode, LogEntry, NodeDeployProgress, RendererApi, Settings, Theme } from '@shared/types'

/**
 * 订阅一个 main → renderer 频道，返回退订函数。
 *
 * `RendererApi` 里的所有 `onXxx` 都是「注册监听 + 返回 removeListener」这同一套样板，
 * 之前每处都逐字重复一遍；这里收敛为唯一实现，新增频道只需一行。
 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
    const listener = (_e: unknown, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
}

/** 无载荷（仅通知）频道的订阅。 */
function subscribeVoid(channel: string, cb: () => void): () => void {
    const listener = (): void => cb()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
}

const api: RendererApi = {
    platform: process.platform,
    versions: {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome
    },

    getSettings: () => ipcRenderer.invoke('settings:get'),
    getUiLocale: () => ipcRenderer.invoke('i18n:get'),
    setUiLocale: (locale) => ipcRenderer.invoke('i18n:set', locale),
    saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
    applySettings: () => ipcRenderer.invoke('settings:apply'),
    resetSettings: () => ipcRenderer.invoke('settings:reset'),
    getLogHistory: () => ipcRenderer.invoke('log:history'),
    getDshUrl: () => ipcRenderer.invoke('dsh:url:get'),
    isDshRunning: () => ipcRenderer.invoke('dsh:running'),
    startDsh: () => ipcRenderer.invoke('dsh:start'),
    stopDsh: () => ipcRenderer.invoke('dsh:stop'),
    restartDsh: () => ipcRenderer.invoke('dsh:restart'),
    setWindowZoom: (percent) => ipcRenderer.invoke('zoom:set', percent),
    relaunch: () => ipcRenderer.send('app:relaunch'),
    getDshVersion: () => ipcRenderer.invoke('dsh:version'),
    isDshInstalled: () => ipcRenderer.invoke('dsh:installed'),
    listVersions: (opts) => ipcRenderer.invoke('dsh:versions', opts),
    checkForUpdates: (opts) => ipcRenderer.invoke('update:check', opts),
    getAppMeta: () => ipcRenderer.invoke('appupdate:meta'),
    getAppUpdateState: () => ipcRenderer.invoke('appupdate:state'),
    triggerAppUpdate: (opts) => ipcRenderer.invoke('appupdate:trigger', opts),
    restartAndInstall: () => ipcRenderer.send('appupdate:restart'),
    getAppSlots: () => ipcRenderer.invoke('appupdate:slots'),
    rollbackAppUpdate: () => ipcRenderer.invoke('appupdate:rollback'),
    updateDsh: (opts) => ipcRenderer.invoke('dsh:update', opts),
    installDsh: (opts) => ipcRenderer.invoke('dsh:install', opts),
    uninstallDsh: () => ipcRenderer.invoke('dsh:uninstall'),

    // ---- main → renderer 订阅 ----
    onAppUpdateEvent: (cb) => subscribe<AppUpdateEvent>('appupdate:event', cb),
    onNodeDeployProgress: (cb) => subscribe<NodeDeployProgress>('nodeenv:deploy-progress', cb),
    onNpmDeployProgress: (cb) => subscribe<NodeDeployProgress>('npmenv:progress', cb),
    onConfigMigrationProgress: (cb) => subscribe<ConfigMigrationProgress>('configdir:migration', cb),
    onDshUrl: (cb) => subscribe<string>('dsh:url', cb),
    onLog: (cb) => subscribe<LogEntry>('dsh:log', cb),
    onSettingsChanged: (cb) => subscribe<Settings>('settings:changed', cb),
    onThemeChanged: (cb) => subscribe<Theme>('settings:theme', cb),
    onLocaleChanged: (cb) => subscribe<LocaleCode>('settings:locale', cb),
    onNewTab: (cb) => subscribe<string>('ui:new-tab', cb),
    onShellRole: (cb) => subscribe<boolean>('shell:core', cb),
    onTabDragHover: (cb) => subscribe<boolean>('tab-drag-hover', (on) => cb(!!on)),
    onToggleView: (cb) => subscribeVoid('ui:toggle-view', cb),
    onAskClose: (cb) => subscribeVoid('ui:ask-close', cb),
    onDshMissing: (cb) => subscribeVoid('dsh:missing', cb),
    onReloadDsh: (cb) => subscribeVoid('ui:reload-dsh', cb),
    onTabDragMoved: (cb) => subscribeVoid('tab-drag:moved', cb),
    onWindowMaximized: (cb) => subscribe<boolean>('win:maximized', (on) => cb(!!on)),
    onHotkeyState: (cb) => subscribe<HotkeyState>('hotkey:state', cb),

    resolveClose: (decision) => ipcRenderer.send('win:close-resolve', decision),

    reloadDsh: () => ipcRenderer.send('web:reload'),

    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    probeEnv: () => ipcRenderer.invoke('env:probe'),
    getNodeStatus: () => ipcRenderer.invoke('nodeenv:status'),
    listNodeVersions: (opts) => ipcRenderer.invoke('nodeenv:versions', opts),
    deployLocalNode: (opts) => ipcRenderer.invoke('nodeenv:deploy', opts),
    getNpmStatus: () => ipcRenderer.invoke('npmenv:status'),
    listNpmVersions: (opts) => ipcRenderer.invoke('npmenv:versions', opts),
    updateNpm: (opts) => ipcRenderer.invoke('npmenv:update', opts),
    ensureBundledNpm: (opts) => ipcRenderer.invoke('npmenv:ensure', opts),
    cancelInstall: () => ipcRenderer.invoke('install:cancel'),
    listInstalledVersions: (kind) => ipcRenderer.invoke('versions:list', kind),
    useInstalledVersion: (kind, version) => ipcRenderer.invoke('versions:use', kind, version),
    removeInstalledVersion: (kind, version) => ipcRenderer.invoke('versions:remove', kind, version),
    getHotkeyState: () => ipcRenderer.invoke('hotkey:state'),
    getWebviewInfo: () => ipcRenderer.invoke('webview:info'),
    getModelsInfo: () => ipcRenderer.invoke('models:info'),
    getCurrentBalance: () => ipcRenderer.invoke('models:balance'),
    getConfigDir: () => ipcRenderer.invoke('configdir:get'),
    setConfigDir: (dir) => ipcRenderer.invoke('configdir:set', dir),
    revertConfigDir: () => ipcRenderer.invoke('configdir:revert'),
    runConfigMigration: () => ipcRenderer.invoke('configdir:migrate-run'),
    cancelConfigMigration: () => ipcRenderer.invoke('configdir:migrate-cancel'),
    getShellMeta: () => ipcRenderer.invoke('shell:meta'),
    openWebWindow: (url) => ipcRenderer.invoke('shell:open-url', url),
    focusCoreWindow: () => ipcRenderer.invoke('shell:focus-core'),
    takeOpenIntent: () => ipcRenderer.invoke('shell:take-open-intent'),
    setShellTitle: (title) => ipcRenderer.send('shell:set-title', title),
    moveTabToWindow: (url) => ipcRenderer.invoke('shell:move-tab', url),

    tabDragBegin: (target) => ipcRenderer.invoke('tab-drag:begin', { target }),
    tabDragHover: (targetId) => ipcRenderer.send('tab-drag:hover', { targetId }),
    tabDragEnd: () => ipcRenderer.send('tab-drag:end'),
    tabDragDropTo: (targetId) => ipcRenderer.send('tab-drag:drop-to', { targetId }),

    quit: () => ipcRenderer.send('app:quit'),

    windowMinimize: () => ipcRenderer.send('win:minimize'),
    windowToggleMaximize: () => ipcRenderer.send('win:maximize-toggle'),
    windowClose: () => ipcRenderer.send('win:close'),
    isWindowMaximized: () => ipcRenderer.invoke('win:is-maximized')
}

contextBridge.exposeInMainWorld('api', api)
