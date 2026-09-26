/** Settings persisted in the app's config dir: ~/.dsbox/{release,dev}/settings.json. */
export interface Settings {
    /**
   * 设置结构版本，**仅用于一次性迁移**，界面不展示。
   * 缺失（老配置）时按第 1 版处理，见 settings.ts 的 normalizeProxyScope 等归一化函数：
   * 只有真正的老配置才做键名拆分与默认值升级，用户后来手填的值不会被反复改写。
   */
    settingsVersion?: number
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
    /**
   * 关闭窗口后的行为：true = 隐藏到系统托盘、后台继续运行；false = 直接退出。
   * 界面在「设置 → 常规」里呈现为「关闭程序后继续运行后台扩展和应用」。
   */
    closeToTray: boolean
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
   *  - 'local'（默认）：应用按架构下载解压到配置目录的 Node（<configDir>/node），
   *    初始化向导默认选中最新 LTS。
   *  - 'system'：系统 Node（要求 ≥ 20）。
   *
   * 旧版的 'electron'（用 Electron 自带 Node 冒充）已移除，老配置由
   * loadSettings 的归一化迁移为 'local'（见 normalizeNodeRuntime）。
   */
    nodeRuntime: NodeRuntimeKind
    /**
   * 本地 dsh 安装时使用的 npm：
   *  - 'system'（默认）：用系统 npm。
   *  - 'bundled'：内置 npm（首次在线拉取并缓存到应用目录）。
   *  - 'localnode'：用部署在配置目录的本地 Node 自带的 npm（未部署时不可选）。
   */
    npmSource: NpmSource
    /** dsh 插件安装用的 pnpm：'system' ｜ 'bundled'（默认，应用代管）。 */
    pnpmSource: PnpmSource
    /** 代理开关。 */
    proxyEnabled: boolean
    /** 代理协议。 */
    proxyProtocol: ProxyProtocol
    /** 代理主机。 */
    proxyHost: string
    /** 代理端口。 */
    proxyPort: number | null
    /** 代理范围：见 ProxyScope；只勾选到的范围才走代理。 */
    proxyScope: ProxyScope[]
    /** 界面缩放百分比（50–200，默认 100）。 */
    zoomPercent: number
    /** 忽略操作系统显示缩放（默认关）。 */
    ignoreSystemScale: boolean
    /** 扩展翻译风格/区域变体（仅当前语言生效）：off ｜ anime/wenyan/hant(zh) ｜ pirate/shakespeare(en)。 */
    funLocale: FunLocale
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
    /** 开机自启（「设置 → 系统与性能」的「启动增强」）。 */
    autoLaunch: boolean
    /** 启动时隐藏到系统托盘，并用系统默认浏览器打开 DSH 界面。 */
    openDshInBrowser: boolean
    /** 配色方案 id（预制方案见 renderer 的 `lib/theme.ts`；同时决定主色与页面/侧栏底色）。 */
    colorScheme: ColorSchemeId
    /**
   * 程序图标：'' = 内置 Logo（随深浅色切换）；'diy/<文件>' = `resources/diy` 下的预制图标；
   * 'user/<文件>' = 用户自行上传（存于 <configDir>/icons）。见 main/app/appicon.ts。
   */
    appIcon: string
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

/** 扩展翻译：关闭、语言风格项（anime/wenyan 属 zh；pirate/shakespeare 属 en），
 *  或中文区域文本变体（hant=繁体中文，文本文件覆盖）。 */
export type FunLocale = 'off' | 'anime' | 'wenyan' | 'hant' | 'pirate' | 'shakespeare'

/** Node 运行时选择：'system'(≥20) ｜ 'local'(按架构下载部署，默认)。 */
export type NodeRuntimeKind = 'system' | 'local'

/** 代理协议。 */
export type ProxyProtocol = 'http' | 'socks5'

/**
 * 代理范围项。**一个键对应一处独立的网络出口**，互不牵连：
 *  - 'app'      程序本体：主进程自身的联网（模型 / 余额查询）+ 内嵌网页（defaultSession）
 *  - 'update'   程序更新：应用自更新（electron-updater 与 GitHub Releases API）
 *  - 'dsh'      DSH 本体：dsh 子进程自己的联网（注入代理环境变量）
 *  - 'npm'      npm 安装 / 下载（npm 子进程与内置 npm 包）
 *  - 'node'     Node 下载部署（发行索引与安装包）
 *  - 'registry' 版本查询（npm registry 上的版本列表 / 更新检查）
 */
export type ProxyScope = 'app' | 'update' | 'dsh' | 'npm' | 'node' | 'registry'

/** ProxyScope 的稳定顺序（界面按它排列，设置读取时按它校验并还原顺序）。 */
export const PROXY_SCOPE_IDS: readonly ProxyScope[] = ['app', 'update', 'dsh', 'npm', 'node', 'registry']

/** 本地安装所用 npm：'system' ｜ 'bundled'(内置) ｜ 'localnode'(本地 Node 自带)。 */
export type NpmSource = 'system' | 'bundled' | 'localnode'

/**
 * dsh 插件安装所用 pnpm：'system'（系统 PATH 上的 pnpm）｜ 'bundled'（应用代管的内置 pnpm）。
 *
 * 没有 'localnode' 这一档 —— Node 不自带 pnpm（对照 npm 的三档，见 NpmSource）。
 */
export type PnpmSource = 'system' | 'bundled'

/** Which npm registry to use for dsh version listing / install. */
export type NpmRegistry = 'npmjs' | 'npmmirror'

/** 单个 npm registry 的测速样本（多轮实测的汇总）。 */
export interface RegistrySpeedSample {
    registry: NpmRegistry
    /**
     * 用于**排名**的代表值（取整毫秒）；请求全部失败或超时为 null。
     *
     * 取多轮里的**最小值**而不是平均值：单次 HTTPS 往返的抖动大多来自
     * DNS、连接建立、TLS 握手这些一次性开销，这些恰好是「换一个源要不要重新付」
     * 的成本；平均值会被偶发的网络毛刺抬高，而最小轮更接近该源的稳定能力。
     */
    ms: number | null
    /** 各轮实测毫秒数（按时间顺序，失败的轮记为 null）；仅用于展示。 */
    rounds: (number | null)[]
    /** 有效轮数 / 总轮数，供 UI 说明「测了几次」。 */
    okRounds: number
    totalRounds: number
}

/**
 * registry 测速汇总，供向导的「简易安装」自动挑最快的源。
 * `samples` 已按「可用的在前、延迟升序」排好，`fastest` 就是其中第一项。
 */
export interface RegistrySpeedResult {
    samples: RegistrySpeedSample[]
    /** 最快且可用的 registry；两个都不可用时为 null（此时沿用用户当前设置）。 */
    fastest: NpmRegistry | null
}

export type Theme = 'system' | 'light' | 'dark'

/**
 * dsh 的 `locale` 配置（patch 条目 `config.preference`）使用的两字母语言码。
 * 界面语言以此为单一存储来源（见 src/main/settings.ts 的 dsh locale 读写）。
 */
export type LocaleCode = 'zh' | 'en'

/** 应用内部实际语言（两字母，与 vue-i18n / element-plus 语言名对应）。 */
export type ResolvedLocale = 'zh' | 'en'

/**
 * 设置结构版本。
 *
 *  - 2 = 代理范围拆出 'app' / 'dsh' / 'registry'，下载并发数默认 'auto'；
 *  - 3 = （历史）原样；
 *  - 4 = `webviewUserAgent` 迁出 —— webview 功能独立为内置扩展 `xeonsky.browser` 后，
 *        该 UA 设置存在扩展自己的数据目录里。第 4 版在 loadSettings 里做一次性搬移
 *        （把旧值写进扩展的 config.json），搬完即从设置结构中删除该字段。
 *  - 5 = `searchEngine` / `shortcuts` 同样迁出（新标签页导航整体成为 `xeonsky.browser` 的
 *        标签页视图），`newTabMode` / `newTabUrl` 直接删除（新标签页恒为内置导航视图）。
 *  - 6 = `downloadThreads` 字段删除：下载并发固定自动（内核下载模块 resolveThreads 按
 *        本机核心数自适应；「下载」页里下载模块自己的配置 threads 不受影响）。
 *
 * 每次做「改键名 / 改默认值」的迁移时 +1，见 settings.ts 的 loadSettings。
 */
export const SETTINGS_VERSION = 6

export const DEFAULT_SETTINGS: Settings = {
    settingsVersion: SETTINGS_VERSION,
    host: '127.0.0.1',
    port: null,
    workspace: null,
    timeoutMs: 90000,
    dshBin: null,
    closeToTray: true,
    theme: 'system',
    autoCheckUpdate: true,
    checkPrerelease: false,
    npmRegistry: 'npmjs',
    appAutoUpdate: true,
    appCheckPrerelease: false,
    devMode: false,
    dshSource: 'local',
    nodeRuntime: 'local',
    npmSource: 'system',
    // 系统上不一定装了 pnpm，而插件安装依赖它 —— 默认用应用代管的内置 pnpm 最稳。
    pnpmSource: 'bundled',
    proxyEnabled: false,
    proxyProtocol: 'http',
    proxyHost: '',
    proxyPort: null,
    proxyScope: [...PROXY_SCOPE_IDS],
    zoomPercent: 100,
    ignoreSystemScale: false,
    funLocale: 'off',
    hotkeyFocusWindow: 'CommandOrControl+Alt+H',
    hotkeyToggleTerminal: 'CommandOrControl+T',
    hotkeyDevTools: 'F12',
    hardwareAcceleration: true,
    autoLaunch: false,
    openDshInBrowser: false,
    colorScheme: 'default',
    appIcon: '',
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

/** 程序图标列表项（「设置 → 外观」的图标选择器）。 */
export interface AppIconInfo {
    /** '' = 内置 Logo；'diy/<文件>' = 预制图标；'user/<文件>' = 用户上传。 */
    id: string
    /** 展示名（内置 Logo 由界面本地化，其余为文件名）。 */
    name: string
    source: 'default' | 'diy' | 'user'
    /** 缩略后的预览图（data URL，可直接喂给 <img>）。 */
    dataUrl: string
}

/** 当前生效的程序图标：id + 预览图（id 为 '' 表示内置 Logo）。 */
export interface AppIconState {
    id: string
    dataUrl: string
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

/**
 * 独立确认子窗口的请求载荷。
 *
 * 文案由渲染层调用方先 i18n（`tt()`）再传入；主进程只负责开窗与回传结果，
 * 不做任何翻译，也不感知业务语义。
 */
export interface ConfirmDialogRequest {
    title: string
    message: string
    /** 可选的补充说明，以更弱的次要文字展示。 */
    detail?: string
    /** 确认按钮文案；缺省时由界面兜底。 */
    confirmText?: string
    /** 取消按钮文案；缺省时由界面兜底。 */
    cancelText?: string
    /** 危险操作：确认按钮用警示色。 */
    danger?: boolean
}

/** 下载部署本地 Node 的结果。 */
export interface NodeDeployResult {
    ok: boolean
    message: string
    version: string | null
    /** 是否因用户取消而中止。 */
    canceled?: boolean
}

/** 可版本化的安装对象：Node / 内置 npm / 内置 pnpm / dsh。 */
export type InstallKind = 'node' | 'npm' | 'pnpm' | 'dsh'

/** 安装进度广播：下载阶段带百分比 / 速度，解压阶段前端显示不确定动画。 */
export interface NodeDeployProgress {
    phase: 'download' | 'extract'
    percent: number
    downloaded: number
    total: number
    /** 瞬时下载速度（bytes/s）。 */
    speed: number
}

/** 会报进度的操作种类。必须区分：npm 与 pnpm 的下载曾共用一条通道，进度会互相串台。 */
export type OperationKind = 'node' | 'npm' | 'pnpm'

/**
 * 「进行中的操作」当前状态。
 *
 * 与 `NodeDeployProgress` 的区别是多了 `kind` 与 `startedAt`：状态由**主进程**持有，
 * 渲染层切页 / 重挂面板后可以重新取快照（`GET /operations`），操作结束时主进程清空。
 * 进度本身只活在面板的 ref 里时，切一次页面就再也看不到正在跑的操作了。
 */
export interface OperationProgress extends NodeDeployProgress {
    kind: OperationKind
    /** 操作开始时间（epoch ms）。 */
    startedAt: number
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

/** 单个 pnpm 来源的版本状态（设置 → 环境页的 pnpm 一节）。 */
export interface PnpmRuntimeStatus {
    present: boolean
    /** 形如 10.8.2；尚未下载时为 null。 */
    version: string | null
    /** 落后于 registry 上的最新版。拿不到最新版或读不到当前版本时一律为 false。 */
    outdated: boolean
}

/** pnpm 来源探测结果：系统 / 内置的版本 + registry 上的最新版。 */
export interface PnpmStatus {
    /** registry 上的最新 pnpm 版本（跟随 npmRegistry 设置）；取不到时为 null。 */
    latest: string | null
    /** 系统 PATH 上的 pnpm（未安装 → present: false）。 */
    system: PnpmRuntimeStatus
    /** 应用下载到配置目录的内置 pnpm。 */
    bundled: PnpmRuntimeStatus
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

/** 「模型」页列表的一行：**一个令牌 = 一个供应商**（多个路由解析到同一密钥时合并成一行）。 */
export interface ProviderEntryInfo {
    /** 供应商路由名（settings 的键）。 */
    provider: string
    /** 供应商展示名。 */
    providerName: string
    /** 该供应商（即该令牌）的余额。 */
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

/** 「模型」页的数据：**每个令牌一行**的供应商列表（不再按模型展开）。密钥明文绝不进入该结构。 */
export interface ModelsInfo {
    entries: ProviderEntryInfo[]
    /**
     * 顶层错误码：no-consent ｜ settings-missing ｜ dsh-missing ｜ settings-parse ｜ no-provider ｜
     * internal；正常为 null。
     */
    errorCode: string | null
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

/**
 * 一行用户输入的解析结果（地址栏 / 导航页输入框）。
 *
 * 规则在浏览器扩展 `xeonsky.browser` 里（它才是「怎么浏览」的归属者），
 * 外壳只负责把原文递过去、按结论行事。放在 shared 是因为它要跨 IPC 传输，
 * 且渲染层两端（`/shell/resolve-input` 的返回、UI 的分派）都要用到这个形状。
 */
export interface ResolveResult {
    /** `url` 内嵌页面加载；`external` 交系统默认程序；`none` 空输入。 */
    kind: 'url' | 'external' | 'none'
    /** 目标；`kind === 'none'` 时缺省。 */
    url?: string
}
