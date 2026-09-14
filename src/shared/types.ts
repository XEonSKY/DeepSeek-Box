/** Settings persisted in the app's config dir: ~/.dsbox/{release,dev}/settings.json. */
export interface Settings {
    /** Bind host for dsh. dsh only allows 127.0.0.1 today. */
    host: string
    /**
   * Preferred starting port for auto-selection:
   *  - positive number: probe it and scan upward while busy
   *  - null/undefined : start from dsh's usual 3080 (still scans if busy)
   *  - 0             : hand the choice entirely to the OS
   */
    port: number | null
    /** Folder dsh boots from (its default file-system location). null => home. */
    workspace: string | null
    /** Milliseconds to wait for dsh to print its URL before giving up. */
    timeoutMs: number
    /** Absolute path to the dsh launcher when not on PATH. */
    dshBin: string | null
    /** When the window close button is pressed: hide to tray (true) or quit (false). */
    closeToTray: boolean
    /** Apply closeToTray without asking again. */
    rememberClose: boolean
    /** UI colour scheme. */
    theme: 'system' | 'light' | 'dark'
    /** Check for a newer @deepseek-ai/dsh automatically at startup. */
    autoCheckUpdate: boolean
    /** Also consider pre-release (-rc / -beta / …) dsh versions when checking. */
    checkPrerelease: boolean
    /** npm registry used to list versions, check and install/uninstall dsh. */
    npmRegistry: NpmRegistry
    /** App 自动更新：启动时自动检查新版本（默认开）。 */
    appAutoUpdate: boolean
    /** App 更新检查也把预发布版本当作候选（默认关）。 */
    appCheckPrerelease: boolean
    /**
   * App 自更新下载所用的 GitHub 公共镜像前缀（如 `https://ghproxy.com`）。
   * 空串 = 官方直连。只改写 GitHub **发布资产**的请求（安装包 / latest.yml / blockmap），
   * 版本元数据仍走官方 —— 这样即使镜像不支持 GitHub API 也不会让检查整体失效。
   */
    updateMirrorUrl: string
    /** 文件下载并发连接数：1 = 单线程，默认 4（可在「设置 → 网络」调整）。 */
    downloadThreads: number
    /** 开发模式：开启后 F12 才允许打开 DevTools 控制台（默认关）。 */
    devMode: boolean
    /**
   * dsh 来源：
   *  - 'local'（默认）：由应用把 @deepseek-ai/dsh 安装/运行在应用自己的目录
   *    （<configDir>/dsh），用所选 Node 运行。
   *  - 'global'：使用系统 npm install -g 装在 PATH 上的 @deepseek-ai/dsh。
   */
    dshSource: 'local' | 'global'
    /**
   * 运行 dsh / npm 的 Node 运行时：
   *  - 'electron'（默认）：Electron 自带 Node（ELECTRON_RUN_AS_NODE）。
   *  - 'system'：系统 Node（要求 ≥ 20）。
   *  - 'local'：应用按架构下载解压到配置目录的 Node（<configDir>/node）。
   */
    nodeRuntime: NodeRuntimeKind
    /**
   * 本地 dsh 安装时使用的 npm：
   *  - 'system'（默认）：用系统 npm。
   *  - 'bundled'：内置 npm（首次在线拉取并缓存到应用目录）。
   *  - 'localnode'：用部署在配置目录的本地 Node 自带的 npm（未部署时不可选）。
   */
    npmSource: NpmSource
    /** 代理开关。 */
    proxyEnabled: boolean
    /** 代理协议。 */
    proxyProtocol: ProxyProtocol
    /** 代理主机。 */
    proxyHost: string
    /** 代理端口。 */
    proxyPort: number | null
    /** 代理范围：npm(安装/下载) · node(Node 下载部署) · update(dsh 更新检查)。 */
    proxyScope: ProxyScope[]
    /** 界面缩放百分比（50–200，默认 100）。 */
    zoomPercent: number
    /** 忽略操作系统显示缩放（默认关）。 */
    ignoreSystemScale: boolean
    /** 扩展翻译风格/区域变体（仅当前语言生效）：off ｜ anime/wenyan/hant(zh) ｜ pirate/shakespeare(en)。 */
    funLocale: FunLocale
    /** 默认搜索引擎（地址栏/新标签页搜索用）。 */
    searchEngine: SearchEngineId
    /** 新标签页模式：'builtin'(内置导航页) ｜ 'url'(加载 newTabUrl)。 */
    newTabMode: NewTabMode
    /** 新标签页自定义 URL（newTabMode='url' 时生效）。 */
    newTabUrl: string
    /** 新标签页内置导航页的常用站点快捷方式。 */
    shortcuts: Shortcut[]
    /**
   * 系统全局快捷键：任何程序里按下都回到本应用主窗口（Electron accelerator，空串=禁用）。
   * 由主进程 `globalShortcut` 注册，可能被别的程序占用而注册失败。
   */
    hotkeyFocusWindow: string
    /** 应用内快捷键：在 DeepSeek UI 与「设置·终端」之间切换。 */
    hotkeyToggleTerminal: string
    /** 应用内快捷键：开关 DevTools（仅「开发模式」开启时生效）。 */
    hotkeyDevTools: string
    /** 内嵌 webview 是否启用硬件加速（默认开）。**改动需重启应用**（Electron 要求 ready 前决定）。 */
    hardwareAcceleration: boolean
    /** 内嵌 webview 的 UserAgent；**留空 = 用按平台/版本生成的默认 UA**。 */
    webviewUserAgent: string
    /** 配色方案 id（预制方案见 renderer 的 `lib/theme.ts`；同时决定主色与页面/侧栏底色）。 */
    colorScheme: ColorSchemeId
    /**
   * 「设置 → 模型」是否已获得读取本地凭据文件（`<dshHome>/.credentials.yaml`）的同意。
   * 首次进入该页时由用户确认并置 true；撤回后不再自动读取。
   */
    modelsCredConsent: boolean
}

/**
 * 预制配色方案的 id。
 * 具体色值在渲染层的 `lib/theme.ts`（只有那里需要颜色），这里只固化 id 集合，
 * 好让「设置里存了什么」与「有哪些方案」在类型上对得上。
 */
export type ColorSchemeId = 'default' | 'purple' | 'green' | 'cyan' | 'orange' | 'rose' | 'graphite'

export const COLOR_SCHEME_IDS: readonly ColorSchemeId[] = ['default', 'purple', 'green', 'cyan', 'orange', 'rose', 'graphite']

/** Webview 设置页需要的只读信息（默认 UA 由主进程按当前平台与版本生成）。 */
export interface WebviewInfo {
    /** 按平台 / Chromium 版本 / 程序版本生成的默认 UA。 */
    defaultUserAgent: string
    /** 实际生效的 UA（设置里留空时等于默认）。 */
    currentUserAgent: string
}

/** 扩展翻译：关闭、语言风格项（anime/wenyan 属 zh；pirate/shakespeare 属 en），
 *  或中文区域文本变体（hant=繁体中文，文本文件覆盖）。 */
export type FunLocale = 'off' | 'anime' | 'wenyan' | 'hant' | 'pirate' | 'shakespeare'

/** Node 运行时选择：'system'(≥20) ｜ 'electron'(自带) ｜ 'local'(下载部署)。 */
export type NodeRuntimeKind = 'system' | 'electron' | 'local'

/** 代理协议。 */
export type ProxyProtocol = 'http' | 'socks5'

/** 代理范围项：'npm' ｜ 'node' ｜ 'update'。 */
export type ProxyScope = 'npm' | 'node' | 'update'

/** 本地安装所用 npm：'system' ｜ 'bundled'(内置) ｜ 'localnode'(本地 Node 自带)。 */
export type NpmSource = 'system' | 'bundled' | 'localnode'

/** Which npm registry to use for dsh version listing / install. */
export type NpmRegistry = 'npmjs' | 'npmmirror'

export type Theme = 'system' | 'light' | 'dark'

/** 支持的搜索引擎。 */
export type SearchEngineId = 'baidu' | 'sogou' | '360' | 'bing' | 'google' | 'duckduckgo'

/** 新标签页内容：内置导航页 ｜ 自定义 URL。 */
export type NewTabMode = 'builtin' | 'url'

/** 常用站点快捷方式（标题 + URL）。 */
export interface Shortcut {
    title: string
    url: string
}

/**
 * dsh `settings.yaml` 里 `locale.preference` 使用的两字母语言码。
 * 界面语言以此为单一存储来源（见 src/main/settings.ts 的 dsh locale 读写）。
 */
export type LocaleCode = 'zh' | 'en'

/** 应用内部实际语言（两字母，与 vue-i18n / element-plus 语言名对应）。 */
export type ResolvedLocale = 'zh' | 'en'

export const DEFAULT_SETTINGS: Settings = {
    host: '127.0.0.1',
    port: null,
    workspace: null,
    timeoutMs: 90000,
    dshBin: null,
    closeToTray: true,
    rememberClose: false,
    theme: 'system',
    autoCheckUpdate: true,
    checkPrerelease: false,
    npmRegistry: 'npmjs',
    appAutoUpdate: true,
    appCheckPrerelease: false,
    updateMirrorUrl: '',
    downloadThreads: 4,
    devMode: false,
    dshSource: 'local',
    nodeRuntime: 'electron',
    npmSource: 'system',
    proxyEnabled: false,
    proxyProtocol: 'http',
    proxyHost: '',
    proxyPort: null,
    proxyScope: ['npm', 'node', 'update'],
    zoomPercent: 100,
    ignoreSystemScale: false,
    funLocale: 'off',
    searchEngine: 'bing',
    newTabMode: 'builtin',
    newTabUrl: '',
    shortcuts: [],
    hotkeyFocusWindow: 'CommandOrControl+Alt+H',
    hotkeyToggleTerminal: 'CommandOrControl+T',
    hotkeyDevTools: 'F12',
    hardwareAcceleration: true,
    webviewUserAgent: '',
    colorScheme: 'default',
    modelsCredConsent: false
}

/** Result of a dsh install / uninstall action. */
export interface DshActionResult {
    ok: boolean
    message: string
    version: string | null
    /** 是否因用户取消而中止。 */
    canceled?: boolean
}

export type LogKind = 'o' | 'e'

/** One buffered / streamed log entry carried to the renderer. */
export interface LogEntry {
    k: LogKind
    s: string
}

/** Result of an @deepseek-ai/dsh install/update check. */
export interface UpdateResult {
    status: 'ok' | 'update' | 'missing' | 'error'
    current: string | null
    latest: string | null
    message: string
}

/** 运行环境元信息（关于页展示当前版本/架构）。 */
export interface AppMeta {
    version: string | null
    arch: string | null
    platform: string | null
}

/** 已压缩保留的一个旧版本（A/B 双槽里的「上一版」）。 */
export interface AppSlotRecord {
    version: string
    /** 归档文件名（位于配置目录 `app-slots` 下）。 */
    archive: string
    createdAt: number
    bytes: number
}

/** 版本槽状态：当前版本 / 压缩保留的上一版 / 待重启安装的版本。 */
export interface AppSlotsState {
    current: string | null
    previous: AppSlotRecord | null
    pending: string | null
    canRollback: boolean
}

/** 一次待执行的配置目录迁移（重启引导阶段执行）。 */
export interface ConfigMigrationPlan {
    /** 旧配置目录（迁移前正在使用的）。 */
    from: string
    /** 新配置目录（迁移后使用）。 */
    to: string
    /** 迁移完成后是否把 `to` 记为显式覆盖；false 表示回归默认目录。 */
    override: boolean
}

/** 配置目录状态：当前有效 / 默认 / 显式覆盖值 / 待迁移计划。 */
export interface ConfigDirInfo {
    current: string
    default: string
    override: string | null
    pending: ConfigMigrationPlan | null
}

/** 配置目录迁移进度（main → renderer 广播）。 */
export interface ConfigMigrationProgress {
    /** scan=统计文件数，move=正在搬迁，done=结束。 */
    phase: 'scan' | 'move' | 'done'
    /** 当前正在处理的路径。 */
    current: string
    /** 已处理文件数。 */
    moved: number
    /** 总文件数（scan 阶段结束后有效）。 */
    total: number
    /** 0–100。 */
    percent: number
    done: boolean
    /** done 时有效：是否成功完成。 */
    ok: boolean
    /** done 时有效：是否被用户取消（已回滚）。 */
    canceled?: boolean
}

/** 首次安装向导探测到的本机运行环境。 */
export interface EnvProbe {
    platform: string
    arch: string
    /** 系统 Node：present 表示找到；version 形如 v20.11.1（null 表示读不到）。 */
    node: { present: boolean; version: string | null }
    /** 是否有系统 npm。 */
    npm: boolean
    /** 应用已部署到配置目录的 Node（nodeRuntime='local' 用）。 */
    local: { present: boolean; version: string | null }
}

/** 下载部署本地 Node 的结果。 */
export interface NodeDeployResult {
    ok: boolean
    message: string
    version: string | null
    /** 是否因用户取消而中止。 */
    canceled?: boolean
}

/** 可版本化的安装对象：Node / 内置 npm / dsh。 */
export type InstallKind = 'node' | 'npm' | 'dsh'

/** 安装进度广播：下载阶段带百分比 / 速度，解压阶段前端显示不确定动画。 */
export interface NodeDeployProgress {
    phase: 'download' | 'extract'
    percent: number
    downloaded: number
    total: number
    /** 瞬时下载速度（bytes/s）。 */
    speed: number
}

/** 某个工具的已安装版本与当前生效版本。 */
export interface InstalledVersions {
    /** 已安装版本（新 → 旧）。 */
    installed: string[]
    /** 当前生效版本（无则 null）。 */
    active: string | null
}

/** 单个 Node 运行时的版本状态（设置 → 环境页的标签）。 */
export interface NodeRuntimeStatus {
    present: boolean
    /** 形如 v22.14.0；进程跑不起来/读不到时为 null。 */
    version: string | null
    /** 落后于最新 LTS。拿不到最新版或读不到当前版本时一律为 false（不误报「可更新」）。 */
    outdated: boolean
}

/** 环境页探测结果：系统 / 本地部署 Node 的当前版本，以及可比较的最新 LTS。 */
export interface NodeStatus {
    /** 最新 LTS（形如 v22.14.0）；离线 / 代理不通时为 null。 */
    latest: string | null
    system: NodeRuntimeStatus
    local: NodeRuntimeStatus
}

/** 单个 npm 来源的版本状态（设置 → 环境页的 npm 标签）。 */
export interface NpmRuntimeStatus {
    present: boolean
    /** 形如 10.8.2；来源不可用（没有系统 npm / 尚未下载 / 未部署本地 Node）时为 null。 */
    version: string | null
    /** 落后于 registry 上的最新版。拿不到最新版或读不到当前版本时一律为 false。 */
    outdated: boolean
}

/** npm 来源探测结果：系统 / 内置 / 本地 Node 自带 npm 的版本 + registry 上的最新版。 */
export interface NpmStatus {
    /** registry 上的最新 npm 版本（跟随 npmRegistry 设置）；取不到时为 null。 */
    latest: string | null
    system: NpmRuntimeStatus
    bundled: NpmRuntimeStatus
    localnode: NpmRuntimeStatus
}

/** 通用「下载 / 安装」结果（与 NodeDeployResult 同构；npm 更新走它）。 */
export interface ToolActionResult {
    ok: boolean
    message: string
    version: string | null
    /** 是否因用户取消而中止。 */
    canceled?: boolean
}

/** 系统全局快捷键的注册状态（主进程 globalShortcut 的真实结果）。 */
export interface HotkeyState {
    /** 已生效的 accelerator；空串表示未注册或已禁用。 */
    accelerator: string
    /** 注册是否成功 —— 被别的程序占用时为 false。 */
    ok: boolean
}

/** 自动更新过程状态（由主进程 electron-updater 事件桥接而来）。 */
export interface AppUpdateEvent {
    kind: 'checking' | 'available' | 'not-available' | 'progress' | 'staging' | 'downloaded' | 'rollback' | 'error'
    version?: string | null
    /** progress 时的下载百分比 0-100。 */
    percent?: number
    /** progress 时的瞬时下载速度（bytes/s）。 */
    speed?: number
    /** progress 时已下载 / 总字节数。 */
    transferred?: number
    total?: number
    message?: string
    /** 当前是否保留了可回退的上一版（downloaded / rollback 时给出）。 */
    canRollback?: boolean
    /** 上一版版本号（若有）。 */
    previous?: string | null
}

/** 供应商余额（配额）的查询状态。 */
export type ModelBalanceState = 'ok' | 'unsupported' | 'no-key' | 'error'

/** 一次联网查询得到的供应商余额。只含展示字段，**不含任何密钥**。 */
export interface ModelBalanceInfo {
    state: ModelBalanceState
    /** 币种（如 CNY）；未知为 null。 */
    currency: string | null
    /** 总额度 / 余额。 */
    total: string | null
    /** 赠送额度。 */
    granted: string | null
    /** 充值额度。 */
    toppedUp: string | null
    /** state 为 error 时的可展示说明（如 `HTTP 401`），不含密钥。 */
    message: string | null
}

/** 「模型」页列表的一行：一个模型 + 它所属供应商的展示名与余额。 */
export interface ModelEntryInfo {
    /** 模型 id；供应商未公布任何模型时为空串（界面显示占位）。 */
    id: string
    /** 供应商路由名（settings 的键）。 */
    provider: string
    /** 供应商展示名。 */
    providerName: string
    /** 该供应商的余额；同一供应商的所有行相同。 */
    balance: ModelBalanceInfo
}

/** 状态栏用：当前默认模型所属供应商的余额。 */
export interface CurrentBalanceInfo {
    /** 供应商路由名（settings 的键）。 */
    provider: string
    /** 供应商展示名。 */
    providerName: string
    /** 该供应商的余额。 */
    balance: ModelBalanceInfo
}

/** 「模型」页的数据：跨供应商展开的模型列表。密钥明文绝不进入该结构。 */
export interface ModelsInfo {
    entries: ModelEntryInfo[]
    /** 顶层错误码：settings-missing ｜ settings-parse ｜ no-provider ｜ internal；正常为 null。 */
    errorCode: string | null
}

/** Everything the renderer (shell UI) can ask of the main process. */
export interface RendererApi {
    platform: string
    versions: { electron: string; node: string; chrome: string }

    getSettings(): Promise<Settings>
    /** 当前界面语言：读取 dsh settings.yaml 的 locale.preference（zh/en；未设则跟随系统解析）。 */
    getUiLocale(): Promise<ResolvedLocale>
    /** 把界面语言写回 dsh settings.yaml 的 locale.preference（两字母码）。 */
    setUiLocale(locale: ResolvedLocale): Promise<void>
    /** Persist settings to disk only (no restart). */
    saveSettings(s: Settings): Promise<Settings>
    /** (Re)start dsh using the persisted settings so they take effect. */
    applySettings(): Promise<void>
    /** Reset all settings to defaults (persisted) and return them. */
    resetSettings(): Promise<Settings>
    getLogHistory(): Promise<LogEntry[]>
    getDshUrl(): Promise<string | null>
    /** Whether a dsh server instance is currently running in the main process. */
    isDshRunning(): Promise<boolean>
    /** Start / restart the dsh server (start is a no-op-ish restart). */
    startDsh(): Promise<void>
    /** Stop the running dsh server and clear its URL. */
    stopDsh(): Promise<void>
    /** Restart the dsh server with current settings. */
    restartDsh(): Promise<void>
    /** 设置外壳窗口缩放百分比（50–200）。 */
    setWindowZoom(percent: number): Promise<void>
    /** 重启应用（用于需重启生效的设置）。 */
    relaunch(): void
    /** Current installed @deepseek-ai/dsh version (from the local module). */
    getDshVersion(): Promise<string | null>
    /** Whether @deepseek-ai/dsh is present on this machine. */
    isDshInstalled(): Promise<boolean>
    /** List published dsh versions (descending), filtered by prerelease flag. */
    listVersions(opts: { prerelease: boolean; registry: NpmRegistry }): Promise<string[]>
    /** Check @deepseek-ai/dsh version/update in the main process. */
    checkForUpdates(opts?: { prerelease?: boolean; registry?: NpmRegistry }): Promise<UpdateResult>
    /**
   * Upgrade the installed @deepseek-ai/dsh to the newest considered
   * version (runs `npm install -g`). Resolves when the install finishes.
   */
    updateDsh(opts?: { registry?: NpmRegistry }): Promise<DshActionResult>
    /** 运行环境元信息（关于页显示当前版本/架构）。 */
    getAppMeta(): Promise<AppMeta>
    /** 触发一次 app 自动更新检查；有可用更新时由主进程后台自动下载。 */
    triggerAppUpdate(opts: { prerelease: boolean }): Promise<{ ok: boolean; message: string }>
    /** 最近一次自动更新状态；页面挂载晚于事件时据此补齐（从未有过事件则为 null）。 */
    getAppUpdateState(): Promise<AppUpdateEvent | null>
    /** 订阅主进程的自动更新事件（检查中/可用/下载进度/下载完成/出错）。 */
    onAppUpdateEvent(cb: (e: AppUpdateEvent) => void): () => void
    /** 立即重启并安装已下载的更新。 */
    restartAndInstall(): void
    /** 版本槽状态：当前版本、压缩保留的上一版、待重启安装的版本。 */
    getAppSlots(): Promise<AppSlotsState>
    /** 回退到压缩保留的上一版（会重启应用）。 */
    rollbackAppUpdate(): Promise<{ ok: boolean; message: string }>
    /**
   * Install / switch dsh to a specific version (or latest when no
   * version is given). If nothing was installed, dsh is started afterwards.
   */
    installDsh(opts?: { version?: string | null; registry?: NpmRegistry }): Promise<DshActionResult>
    /** Uninstall @deepseek-ai/dsh (stops dsh first). */
    uninstallDsh(): Promise<DshActionResult>

    /** A dsh server URL is (re)available; the shell should show it in the webview. */
    onDshUrl(cb: (url: string) => void): () => void
    /** Stream live dsh stdout/stderr lines. */
    onLog(cb: (entry: LogEntry) => void): () => void
    /**
   * The app's own settings.json changed on disk (edited outside the shell);
   * re-sync the whole settings form with the authoritative persisted values.
   */
    onSettingsChanged(cb: (s: Settings) => void): () => void
    /**
   * dsh's own settings.yaml (ui-theme.preference) changed on disk
   * (e.g. the theme was changed inside the dsh UI); adopt it in the shell.
   */
    onThemeChanged(cb: (theme: Theme) => void): () => void
    /**
   * dsh's own settings.yaml (locale.preference) changed on disk
   * (e.g. the language was changed inside the dsh UI); adopt it in the shell.
   */
    onLocaleChanged(cb: (locale: LocaleCode) => void): () => void
    /** Main asks the renderer to flip between the Web view and the log view. */
    onToggleView(cb: () => void): () => void
    /** Main asks the renderer to show the (Element Plus) close-behaviour prompt. */
    onAskClose(cb: () => void): () => void
    /** A webview asked to open a URL in a new window/tab; the shell opens an in-app tab. */
    onNewTab(cb: (url: string) => void): () => void
    /** Main informs this window its role changed (e.g. it became the new core window). */
    onShellRole(cb: (isCore: boolean) => void): () => void
    /** Renderer reports the user's close decision back to the main process. */
    resolveClose(decision: { action: 'hide' | 'quit'; remember: boolean }): void
    /** Main detected that dsh was removed/never installed; show the install mask. */
    onDshMissing(cb: () => void): () => void

    /** Ask the main process to request a reload of the dsh UI (title-bar refresh). */
    reloadDsh(): void
    /** The shell should reload the dsh UI when this fires. */
    onReloadDsh(cb: () => void): () => void

    openExternal(url: string): Promise<void>
    /** Open a native directory picker; resolves the chosen path or null. */
    openDirectory(): Promise<string | null>
    /** Open a native file picker (e.g. for the dsh launcher); resolves the chosen path or null. */
    openFile(): Promise<string | null>
    /** Probe whether a system Node / npm is installed on this machine. */
    probeEnv(): Promise<EnvProbe>
    /** 环境页用：系统 / 本地部署 Node 的当前版本 + 最新 LTS 对比（会联网取 index.json）。 */
    getNodeStatus(): Promise<NodeStatus>
    /** 可安装的 Node 版本列表（新 → 旧；来自 nodejs.org 发行索引）。 */
    listNodeVersions(opts: { includeNonLts: boolean }): Promise<string[]>
    /** 下载并按当前平台/架构把 Node（默认最新 LTS，可指定版本）部署到配置目录。 */
    deployLocalNode(opts?: { version?: string }): Promise<NodeDeployResult>
    /** 环境页用：三个 npm 来源（系统 / 内置 / 本地 Node 自带）的当前版本 + registry 最新版对比。 */
    getNpmStatus(): Promise<NpmStatus>
    /** 可安装的 npm 版本列表（新 → 旧；来自所选 registry）。 */
    listNpmVersions(opts: { prerelease: boolean }): Promise<string[]>
    /** 按来源下载 / 切换 npm 版本（不传 version 为最新版）。 */
    updateNpm(opts: { source: NpmSource; version?: string }): Promise<ToolActionResult>
    /** 首次安装向导用：确保「程序内置」npm 已就绪（不传 version 时已缓存即免下载）。 */
    ensureBundledNpm(opts?: { version?: string }): Promise<ToolActionResult>
    /** 系统全局快捷键的注册状态（设置 → 快捷键页）。 */
    getHotkeyState(): Promise<HotkeyState>
    /** 系统全局快捷键注册状态变化（改设置后重新注册的结果）。 */
    onHotkeyState(cb: (s: HotkeyState) => void): () => void
    /** Webview 设置页用：默认 UA 与实际生效的 UA。 */
    getWebviewInfo(): Promise<WebviewInfo>
    /** 「设置 → 模型」用：读取 dsh 配置并联网查询各供应商余额（密钥明文绝不离开主进程）。 */
    getModelsInfo(): Promise<ModelsInfo>
    /** 状态栏用：当前供应商余额；未同意读取或无法解析时返回 null。 */
    getCurrentBalance(): Promise<CurrentBalanceInfo | null>
    /** 本地 Node 部署进度广播。 */
    onNodeDeployProgress(cb: (p: NodeDeployProgress) => void): () => void
    /** 「程序内置」npm 下载 / 解压进度广播。 */
    onNpmDeployProgress(cb: (p: NodeDeployProgress) => void): () => void
    /** 取消正在进行的 Node / npm / dsh 安装（下载与解压阶段）。 */
    cancelInstall(): Promise<boolean>
    /** 某个工具的已安装版本与生效版本（Node / npm / dsh）。 */
    listInstalledVersions(kind: InstallKind): Promise<InstalledVersions>
    /** 切换某个工具的生效版本（不重装）。 */
    useInstalledVersion(kind: InstallKind, version: string): Promise<ToolActionResult>
    /** 删除某个已安装版本。 */
    removeInstalledVersion(kind: InstallKind, version: string): Promise<ToolActionResult>
    /** 配置目录状态：当前有效 / 默认 / 覆盖值 / 待迁移计划。 */
    getConfigDir(): Promise<ConfigDirInfo>
    /** 设置自选配置目录（传 null 恢复默认）；旧目录有内容时返回带 pending 的状态，需重启迁移。 */
    setConfigDir(dir: string | null): Promise<ConfigDirInfo>
    /** 撤销尚未执行的配置目录迁移，固定回原目录。 */
    revertConfigDir(): Promise<ConfigDirInfo>
    /** 开始执行待迁移计划（重启引导阶段由渲染层触发）。 */
    runConfigMigration(): Promise<void>
    /** 请求取消正在执行的迁移（已搬内容会回滚）。 */
    cancelConfigMigration(): Promise<void>
    /** 配置目录迁移进度广播（进度条 + 当前文件）。 */
    onConfigMigrationProgress(cb: (p: ConfigMigrationProgress) => void): () => void
    /** 本窗口元信息：窗口 id 与是否核心窗口（核心窗口才承载 dsh UI）。 */
    getShellMeta(): Promise<{ winId: number; isCore: boolean }>
    /** 把一个 URL 开到一个独立（副）窗口（右键“在新窗口打开 / 移动”）。 */
    openWebWindow(url: string): Promise<void>
    /** 聚焦核心窗口（副窗口“跳转核心窗口”按钮）；无核心窗口时重建一个。 */
    focusCoreWindow(): Promise<void>
    /** 取走本窗口的“开页意图”（创建副窗口时若带 URL，据此开一个动态标签页）。 */
    takeOpenIntent(): Promise<string | null>
    /** 把本窗口“当前标签页标题”同步给主进程，用于命名本（副）窗口为：<标题> - 软件名。 */
    setShellTitle(title: string): void
    /** “移动到其它窗口”：主进程弹目标选择（其它壳窗口）。true=已移走（本窗口应移除对应标签）；false=取消。 */
    moveTabToWindow(url: string): Promise<boolean>
    /** 跨窗口拖标签：源窗口开始拖拽某标签，登记并取回“其它壳窗口”的屏幕几何供算落点。target 为 URL 或内置导航页伪链接。 */
    tabDragBegin(target: string): Promise<Array<{ id: number; x: number; y: number; w: number; h: number }>>
    /** 源窗口报告当前“指针悬停的目标窗口 id”（null=没有）。主进程让那个窗口亮起可接收遮罩。 */
    tabDragHover(targetId: number | null): void
    /** 结束/取消拖拽（源窗口未移入其它窗口时）。 */
    tabDragEnd(): void
    /** 源窗口决定把被拖标签移入某目标窗口。 */
    tabDragDropTo(targetId: number): void
    /** 主进程通知源窗口：被拖标签已移入其它窗口，应移除本地那个标签。 */
    onTabDragMoved(cb: () => void): () => void
    /** 主进程通知本窗口：是否正被某跨窗口拖拽“悬停”为目标（用于亮可接收遮罩）。 */
    onTabDragHover(cb: (on: boolean) => void): () => void
    quit(): void

    // Frameless-window controls (drawn by the renderer's custom title bar).
    windowMinimize(): void
    windowToggleMaximize(): void
    windowClose(): void
    /** 本窗口当前是否最大化（自定义标题栏据此在「最大化 / 还原」之间切换图标与提示）。 */
    isWindowMaximized(): Promise<boolean>
    /** 主进程通知本窗口：最大化状态变化（双击拖动区 / 系统快捷键 / Aero Snap 也会触发）。 */
    onWindowMaximized(cb: (maximized: boolean) => void): () => void
}

/**
 * 内置「新建标签页」（导航页）在窗口间流转时的伪链接。它不是一个可加载的网址，而是表示
 * “在这里打开一个内置导航页”。当把一个 newtab 标签“在新窗口/其它窗口打开”或移入其它窗口时，
 * 就以这个值作为目标传递；收到方据此开一个内置导航页（而非 webview URL）。
 */
export const NEWTAB_URL = 'dssh://about:blank'

/** 目标是否表示“打开内置导航页”（NEWTAB_URL）。 */
export function isNewTabTarget(target: string | null | undefined): boolean {
    return typeof target === 'string' && target === NEWTAB_URL
}
