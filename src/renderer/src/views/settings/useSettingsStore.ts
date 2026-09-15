import { reactive, watch } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { Settings, Theme } from '@shared/types'
import { applyTheme, applyColorScheme } from '../../lib/theme'
import { tt } from '../../lib/locales'
import { payloadFrom, type SettingsState, type SettingsActions } from './settingsStore'
import { createDshActions } from './actions/dshActions'
import { createDshManageActions } from './actions/dshManageActions'

/**
 * 设置页数据与动作（Pinia setup store）。
 * 状态集中在 `state`(reactive)，操作集中在 `actions`；watchers 在 store 内建立，
 * 外部自动同步订阅与防抖清理通过返回的 `dispose()` 在卸载时释放。
 */
export const useSettingsStore = defineStore('settings', () => {
    const state = reactive<SettingsState>({
        workspace: '',
        portMode: 'auto',
        manualPort: 3080,
        dshBin: '',
        timeoutMs: DEFAULT_SETTINGS.timeoutMs,
        closeKeepRunning: true,
        theme: DEFAULT_SETTINGS.theme,
        autoCheckUpdate: DEFAULT_SETTINGS.autoCheckUpdate,
        autoCheckPrerelease: DEFAULT_SETTINGS.checkPrerelease,
        npmRegistry: DEFAULT_SETTINGS.npmRegistry,
        appAutoUpdate: DEFAULT_SETTINGS.appAutoUpdate,
        appCheckPrerelease: DEFAULT_SETTINGS.appCheckPrerelease,
        devMode: DEFAULT_SETTINGS.devMode,
        dshSource: DEFAULT_SETTINGS.dshSource,
        nodeRuntime: DEFAULT_SETTINGS.nodeRuntime,
        npmSource: DEFAULT_SETTINGS.npmSource,
        proxyEnabled: DEFAULT_SETTINGS.proxyEnabled,
        proxyProtocol: DEFAULT_SETTINGS.proxyProtocol,
        proxyHost: DEFAULT_SETTINGS.proxyHost,
        proxyPort: DEFAULT_SETTINGS.proxyPort,
        proxyScope: [...DEFAULT_SETTINGS.proxyScope],
        downloadThreads: DEFAULT_SETTINGS.downloadThreads,
        zoomPercent: DEFAULT_SETTINGS.zoomPercent,
        ignoreSystemScale: DEFAULT_SETTINGS.ignoreSystemScale,
        funLocale: DEFAULT_SETTINGS.funLocale,
        searchEngine: DEFAULT_SETTINGS.searchEngine,
        newTabMode: DEFAULT_SETTINGS.newTabMode,
        newTabUrl: DEFAULT_SETTINGS.newTabUrl,
        shortcuts: [...DEFAULT_SETTINGS.shortcuts],
        hotkeyFocusWindow: DEFAULT_SETTINGS.hotkeyFocusWindow,
        hotkeyToggleTerminal: DEFAULT_SETTINGS.hotkeyToggleTerminal,
        hotkeyDevTools: DEFAULT_SETTINGS.hotkeyDevTools,
        hardwareAcceleration: DEFAULT_SETTINGS.hardwareAcceleration,
        autoLaunch: DEFAULT_SETTINGS.autoLaunch,
        openDshInBrowser: DEFAULT_SETTINGS.openDshInBrowser,
        webviewUserAgent: DEFAULT_SETTINGS.webviewUserAgent,
        colorScheme: DEFAULT_SETTINGS.colorScheme,
        appIcon: DEFAULT_SETTINGS.appIcon,
        modelsCredConsent: DEFAULT_SETTINGS.modelsCredConsent,
        dshRunning: false,
        applying: false,
        updating: false,
        updatingDsh: false,
        version: null,
        versions: [],
        versionsLoading: false,
        switchingDsh: false,
        uninstalling: false,
        selectedVersion: ''
    })

    function fillFrom(s: Settings): void {
        state.workspace = s.workspace ?? ''
        state.dshBin = s.dshBin ?? ''
        state.timeoutMs = s.timeoutMs ?? DEFAULT_SETTINGS.timeoutMs
        state.closeKeepRunning = s.closeToTray !== false
        state.theme = s.theme ?? DEFAULT_SETTINGS.theme
        state.autoCheckUpdate = s.autoCheckUpdate !== false
        state.autoCheckPrerelease = s.checkPrerelease === true
        state.npmRegistry = (s.npmRegistry ?? DEFAULT_SETTINGS.npmRegistry) as SettingsState['npmRegistry']
        state.appAutoUpdate = s.appAutoUpdate !== false
        state.appCheckPrerelease = s.appCheckPrerelease === true
        state.devMode = s.devMode === true
        state.dshSource = s.dshSource ?? DEFAULT_SETTINGS.dshSource
        state.nodeRuntime = s.nodeRuntime ?? DEFAULT_SETTINGS.nodeRuntime
        state.npmSource = s.npmSource ?? DEFAULT_SETTINGS.npmSource
        state.proxyEnabled = s.proxyEnabled === true
        state.proxyProtocol = s.proxyProtocol ?? DEFAULT_SETTINGS.proxyProtocol
        state.proxyHost = s.proxyHost ?? DEFAULT_SETTINGS.proxyHost
        state.proxyPort = s.proxyPort ?? DEFAULT_SETTINGS.proxyPort
        state.proxyScope = Array.isArray(s.proxyScope) ? [...s.proxyScope] : [...DEFAULT_SETTINGS.proxyScope]
        state.downloadThreads = s.downloadThreads ?? DEFAULT_SETTINGS.downloadThreads
        state.zoomPercent = s.zoomPercent ?? DEFAULT_SETTINGS.zoomPercent
        state.ignoreSystemScale = s.ignoreSystemScale === true
        state.funLocale = s.funLocale ?? DEFAULT_SETTINGS.funLocale
        state.searchEngine = s.searchEngine ?? DEFAULT_SETTINGS.searchEngine
        state.newTabMode = s.newTabMode ?? DEFAULT_SETTINGS.newTabMode
        state.newTabUrl = s.newTabUrl ?? ''
        state.shortcuts = Array.isArray(s.shortcuts)
            ? s.shortcuts.map((sc) => ({ title: sc.title || '', url: sc.url || '' }))
            : [...DEFAULT_SETTINGS.shortcuts]
        state.hotkeyFocusWindow = s.hotkeyFocusWindow ?? DEFAULT_SETTINGS.hotkeyFocusWindow
        state.hotkeyToggleTerminal = s.hotkeyToggleTerminal ?? DEFAULT_SETTINGS.hotkeyToggleTerminal
        state.hotkeyDevTools = s.hotkeyDevTools ?? DEFAULT_SETTINGS.hotkeyDevTools
        state.hardwareAcceleration = s.hardwareAcceleration !== false
        state.autoLaunch = s.autoLaunch === true
        state.openDshInBrowser = s.openDshInBrowser === true
        state.webviewUserAgent = s.webviewUserAgent ?? DEFAULT_SETTINGS.webviewUserAgent
        state.colorScheme = s.colorScheme ?? DEFAULT_SETTINGS.colorScheme
        state.appIcon = s.appIcon ?? DEFAULT_SETTINGS.appIcon
        state.modelsCredConsent = s.modelsCredConsent === true
        if (typeof s.port === 'number' && s.port > 0) {
            state.portMode = 'manual'
            state.manualPort = s.port
        } else {
            state.portMode = 'auto'
        }
    }

    // ---- Auto-save: edits persist to disk (debounced), no dsh restart. ---------
    let debounce: number | undefined
    /**
     * 本窗口最近一次保存的时刻。
     *
     * 主进程落盘后会把权威设置回放给所有窗口（`settings:changed`，见 ipc.ts 的 `settings:save`），
     * 用来让状态栏 / 内嵌网页等「派生状态」即时跟上。**发起保存的这个窗口必须忽略自己的回放**：
     * 回放内容比 `state` 旧一个保存周期，正好落在「刚改完又接着输入」的那个窗口里，会把用户的
     * 输入覆盖回去。时间窗与 main 侧抑制自身写入的做法（lastSelfSettingsWrite < 400）保持一致。
     */
    let lastSaveAt = 0
    async function persist(): Promise<void> {
        try {
            lastSaveAt = Date.now()
            await window.api.put('/settings', { body: payloadFrom(state) })
        } catch (err) {
            ElMessage.error(tt('msg.saveFail', { err: err instanceof Error ? err.message : String(err) }))
        }
    }
    function scheduleSave(): void {
        if (debounce) window.clearTimeout(debounce)
        debounce = window.setTimeout(() => void persist(), 500)
    }

    async function browseWorkspace(): Promise<void> {
        const p = await window.api.post('/dialog/directory')
        if (p) {
            state.workspace = p
        }
    }

    /** 全局模式下选择 dsh 启动器文件（dshBin）。 */
    async function browseDshBin(): Promise<void> {
        const p = await window.api.post('/dialog/file')
        if (p) state.dshBin = p
    }

    async function apply(): Promise<void> {
        state.applying = true
        try {
            if (debounce) {
                window.clearTimeout(debounce)
                debounce = undefined
            }
            await window.api.put('/settings', { body: payloadFrom(state) })
            await window.api.post('/settings/apply')
            ElMessage.success(tt('msg.applyOk'))
        } catch (err) {
            ElMessage.error(tt('msg.applyFail', { err: err instanceof Error ? err.message : String(err) }))
        } finally {
            state.applying = false
        }
    }

    async function resetAll(): Promise<void> {
        try {
            const d = await window.api.post('/settings/reset')
            fillFrom(d)
            applyTheme(d.theme)
            await window.api.post('/settings/apply')
            ElMessage.success(tt('msg.resetOk'))
        } catch (err) {
            ElMessage.error(tt('msg.resetFail', { err: err instanceof Error ? err.message : String(err) }))
        }
    }

    // 动作按关注点分模块（见 ./actions/）；本 store 只保留与表单/防抖保存强耦合的部分。
    const dshActions = createDshActions(state)
    const dshManageActions = createDshManageActions(state)

    const actions: SettingsActions = {
        ...dshActions,
        ...dshManageActions,
        browseWorkspace,
        browseDshBin,
        apply,
        resetAll,
        fillFrom
    }

    // ---- 自动保存 watch：任何影响运行的设置变更都（防抖）落盘。 ----
    // 直接以 payloadFrom(state) 为观察源：新增设置字段时**无需**再回来补进字段列表，
    // 而且保证「被观察的集合」与「被持久化的集合」永远是同一个（此前是手写 29 项，易漏）。
    watch(() => JSON.stringify(payloadFrom(state)), scheduleSave)
    // 缩放即时生效（写主进程窗口 zoom；webview 缩放由 WebHost 订阅 settings:changed 同步）。
    watch(() => state.zoomPercent, (v) => void window.api.put('/windows/zoom', { body: { percent: v } }))
    // 主题即时生效（dsh 自己 watch 同步的 settings.yaml，无需手动刷新）。
    watch(() => state.theme, (t: Theme) => applyTheme(t))
    // 配色方案即时生效（外部改动经 fillFrom 改 state 时这个 watch 也会跑）。
    watch(() => state.colorScheme, (id) => applyColorScheme(id))
    // 预发布开关或 npm 镜像源变化时重建版本列表。
    watch([() => state.autoCheckPrerelease, () => state.npmRegistry], () => void dshManageActions.loadVersions())

    // ---- 外部配置自动同步：settings.json / dsh 的 settings.yaml 被外部改动。 ----
    const offSettingsChanged = window.api.on('settings:changed', (s) => {
        // 自己刚保存的那次回放跳过（见 lastSaveAt）：它是同一份内容、但比 state 旧一个保存周期。
        if (Date.now() - lastSaveAt < 400) return
        fillFrom(s)
    })
    const offThemeChanged = window.api.on('settings:theme', (t) => {
        state.theme = t
        applyTheme(t)
    })

    /**
   * 释放外部订阅并清理防抖。
   *
   * 注意：本 store 是 Pinia setup store，setup 体只在**渲染进程**内执行一次（不是每次
   * 组件挂载），所以订阅与 store 同寿。因此**不能**在 SettingsView 的 onBeforeUnmount 里
   * 调用它——那会在用户离开设置页后永久掐断主题/外部 settings.json 同步。
   * 真正的终点是本窗口（渲染进程）销毁，故在此把 dispose 接到 beforeunload 上。
   */
    let disposeDone = false
    function dispose(): void {
        if (disposeDone) return
        disposeDone = true
        if (debounce) window.clearTimeout(debounce)
        offSettingsChanged()
        offThemeChanged()
    }
    window.addEventListener('beforeunload', dispose, { once: true })

    return { state, actions, dispose }
})
