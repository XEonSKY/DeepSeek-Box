/**
 * IPC 的「网络层」契约：把主进程与渲染层之间的通信建模成一个 REST 服务。
 *
 * - 渲染层 → 主进程是**请求**：统一走 `ipc:request` 通道，信封为 `IpcRequest`
 *   (`{ method, path, query?, body? }`)，由主进程的 Router 按「方法 + 路径」分发。
 *   前端拿到完整的五个动词：`api.get / post / put / patch / delete`。
 * - 主进程 → 渲染层是**推送**：统一走 `ipc:event` 通道，信封为 `IpcEvent`
 *   (`{ event, payload }`)，渲染层按键名订阅。
 *
 * `ApiRoutes` 是全部端点的唯一事实来源：主进程按它校验路由与返回值，渲染层的
 * `window.api` 也按它推导每个调用的入参与返回值类型。新增端点时先在这里登记。
 */

import type {
    AppIconInfo,
    AppIconState,
    AppMeta,
    AppSlotsState,
    AppUpdateEvent,
    ConfigDirInfo,
    ConfigMigrationProgress,
    ConfirmDialogRequest,
    CurrentBalanceInfo,
    DshActionResult,
    EnvProbe,
    HotkeyState,
    InstalledVersions,
    LocaleCode,
    LogEntry,
    ModelsInfo,
    NodeDeployResult,
    OperationProgress,
    NodeStatus,
    NpmRegistry,
    NpmSource,
    PnpmSource,
    NpmStatus,
    PnpmStatus,
    RegistrySpeedResult,
    ResolvedLocale,
    ResolveResult,
    Settings,
    Theme,
    ToolActionResult,
    UpdateResult
} from './types'
import type { ExtensionsInfo } from './extensions'
import type { CreateDownloadOptions, DownloadConfig, DownloadStatus, DownloadTaskView } from './download'

// ---------------------------------------------------------------------------
// 传输层：通道与信封
// ---------------------------------------------------------------------------

/** 渲染层 → 主进程的请求通道（`ipcRenderer.invoke`）。 */
export const IPC_REQUEST_CHANNEL = 'ipc:request'

/** 主进程 → 渲染层的推送通道（`webContents.send`）。 */
export const IPC_EVENT_CHANNEL = 'ipc:event'

/** 请求方法（语义对齐 HTTP 动词）。 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** 一个 IPC 请求的信封。 */
export interface IpcRequest {
    method: HttpMethod
    /** 具体路径，路径参数已由客户端 URL 编码后填入（如 `/versions/node`）。 */
    path: string
    /** 查询参数（等价于 URL query）。 */
    query?: Record<string, unknown>
    /** 请求体（等价于 HTTP body）。 */
    body?: unknown
}

/** 主进程推送给渲染层的事件信封。 */
export interface IpcEvent<T = unknown> {
    event: string
    payload: T
}

// ---------------------------------------------------------------------------
// 路由表：全部端点的唯一事实来源
// ---------------------------------------------------------------------------

/**
 * 每个键是 `"<METHOD> <path>"`，值是这次请求的入参 / 出参类型：
 * - `query`：`?a=b` 形式的查询参数
 * - `body`：请求体（JSON 可序列化）
 * - `result`：返回值（`void` 表示只发不收）
 *
 * 路径里的 `:name` 是路径参数（如 `/versions/:kind/:version`）。
 */
export interface ApiRoutes {
    // ---- 设置 / 界面语言 ----
    'GET /settings': { result: Settings }
    'PUT /settings': { body: Settings; result: Settings }
    'POST /settings/apply': { result: void }
    'POST /settings/reset': { result: Settings }
    'GET /locale': { result: ResolvedLocale }
    'PUT /locale': { body: ResolvedLocale; result: ResolvedLocale }

    // ---- 日志 ----
    'GET /logs': { result: LogEntry[] }
    /**
     * 渲染层把一条日志上报给主进程，落进同一份日志文件（见 main/modules/settings.ts）。
     *
     * 渲染层没有文件系统，它的 pino 是 browser 构建，输出只能进 devtools 控制台；
     * 上报到主进程后，「渲染层报错」才和主进程其它日志一样可被事后排查。
     * 只传「级别 + tag + 消息」三样，由主进程用自己的 logger 重记一遍 ——
     * 这样时间戳来源统一、也能被 pino-roll 一起轮转。
     */
    'POST /logs/renderer': { body: { level: number; tag?: string; message: string }; result: void }

    /**
     * 正在进行中的操作快照（Node / npm / pnpm 下载、插件安装…）。
     *
     * 渲染层用它做「切页回来仍有进度」：面板卸载后重新挂载时先取一次快照，再靠事件续上。
     * 操作结束（成功 / 失败 / 取消）时主进程清空对应条目，所以快照里有的就是真的在跑。
     */
    'GET /operations': { result: OperationProgress[] }

    // ---- dsh 本体（子进程）----
    'GET /dsh/url': { result: string | null }
    'GET /dsh/running': { result: boolean }
    'GET /dsh/version': { result: string | null }
    'GET /dsh/installed': { result: boolean }
    'GET /dsh/versions': { query: { prerelease: boolean; registry: NpmRegistry }; result: string[] }
    'GET /dsh/update-check': { query: { prerelease?: boolean; registry?: NpmRegistry }; result: UpdateResult }
    'POST /dsh/start': { result: void }
    'POST /dsh/stop': { result: void }
    'POST /dsh/restart': { result: void }
    'POST /dsh/update': { body?: { registry?: NpmRegistry }; result: DshActionResult }
    'POST /dsh/install': { body?: { version?: string | null; registry?: NpmRegistry }; result: DshActionResult }
    'DELETE /dsh': { result: DshActionResult }
    /** 请核心窗口重新加载内嵌的 dsh UI（标题栏刷新按钮）。 */
    'POST /dsh/reload': { result: void }

    // ---- 应用元信息 / 自动更新 ----
    'GET /app/meta': { result: AppMeta }
    'GET /app/update/state': { result: AppUpdateEvent | null }
    'POST /app/update/check': { body: { prerelease: boolean }; result: { ok: boolean; message: string } }
    'GET /app/update/slots': { result: AppSlotsState }
    'POST /app/update/rollback': { result: { ok: boolean; message: string } }
    'POST /app/update/restart': { result: void }
    'POST /app/relaunch': { result: void }
    'POST /app/quit': { result: void }

    // ---- 运行环境 / Node ----
    'GET /env': { result: EnvProbe }
    'GET /node/status': { result: NodeStatus }
    'GET /node/versions': { query: { includeNonLts?: boolean }; result: string[] }
    'POST /node/deploy': { body?: { version?: string }; result: NodeDeployResult }

    // ---- npm ----
    /** 实测各 npm registry 的速度，供向导「简易安装」挑最快的源。 */
    'POST /registries/speed': { result: RegistrySpeedResult }
    'GET /npm/status': { result: NpmStatus }
    'GET /npm/versions': { query: { prerelease?: boolean }; result: string[] }
    'POST /npm/update': { body?: { source?: NpmSource; version?: string }; result: ToolActionResult }
    'POST /npm/ensure': { body?: { version?: string }; result: ToolActionResult }

    // ---- pnpm（dsh 插件安装转发给 pnpm 时使用；来源同 npm 一样可选：系统自带 / 内置）----
    'GET /pnpm/status': { result: PnpmStatus }
    'GET /pnpm/versions': { query: { prerelease?: boolean }; result: string[] }
    /** source 缺省为 'bundled'（应用代管）；'system' 时用系统 npm 装全局 pnpm。 */
    'POST /pnpm/update': { body?: { source?: PnpmSource; version?: string }; result: ToolActionResult }
    'POST /pnpm/ensure': { body?: { version?: string }; result: ToolActionResult }

    // ---- 安装取消 / 版本管理（node · npm · dsh 通用）----
    'POST /installs/cancel': { result: boolean }
    'GET /versions/:kind': { result: InstalledVersions }
    /** 切换某个工具的生效版本（不重装）。 */
    'PUT /versions/:kind/active': { body: { version: string }; result: ToolActionResult }
    /** 删除某个已安装版本。 */
    'DELETE /versions/:kind/:version': { result: ToolActionResult }

    // ---- 配置目录 ----
    'GET /config-dir': { result: ConfigDirInfo }
    'PUT /config-dir': { body: { dir: string | null }; result: ConfigDirInfo }
    'POST /config-dir/revert': { result: ConfigDirInfo }
    'POST /config-dir/migration': { result: void }
    'DELETE /config-dir/migration': { result: void }

    // ---- 只读状态 ----
    // 注：原 `GET /webview/info` 已随 webview 功能迁到内置扩展 xeonsky.browser
    // （走它的扩展自有通道 `ext:xeonsky.browser:config`），内核不再提供。
    'GET /hotkeys/state': { result: HotkeyState }
    'GET /models/info': { result: ModelsInfo }
    'GET /models/balance': { result: CurrentBalanceInfo | null }

    // ---- 程序图标 ----
    'GET /icons': { result: AppIconInfo[] }
    'GET /icons/current': { result: AppIconState }
    'POST /icons': { body: { name: string; data: Uint8Array }; result: { id: string; list: AppIconInfo[] } }
    'DELETE /icons/:id': { result: AppIconInfo[] }

    // ---- 扩展管理 ----
    /** 列出全部已发现扩展（含失败 / 跳过 / 停用的）与安全模式状态。 */
    'GET /extensions': { result: ExtensionsInfo }
    /** 停用 / 启用某扩展（写盘，重启后生效；系统扩展不可停用）。 */
    'PUT /extensions/:id/enabled': { body: { enabled: boolean }; result: ExtensionsInfo }
    /** 清掉某扩展的崩溃计数并解除停用（「我已知道并要试一次」）。 */
    'POST /extensions/:id/forgive': { result: ExtensionsInfo }
    /**
     * 重载单个扩展：卸载 → 按当前磁盘状态重新激活（改完扩展代码立刻生效）。
     *
     * 注意：重载「被别的扩展依赖」的扩展时，依赖方仍持有旧的动作表 ——
     * 要一并刷新请用 `POST /extensions/reload-all`。
     */
    'POST /extensions/:id/reload': { result: ExtensionsInfo }
    /** 重载全部扩展：卸载全部 → 重新走一遍完整加载（等价于重启加载器，不重启 Electron）。 */
    'POST /extensions/reload-all': { result: ExtensionsInfo }
    /** 退出安全模式并清空崩溃计数（要求重新加载全部扩展）。 */
    'POST /extensions/exit-safe-mode': { result: ExtensionsInfo }
    /** 打开外部扩展安装目录（在文件管理器里定位）。 */
    'POST /extensions/open-dir': { result: void }

    // ---- 下载 ----
    // 下载是内核模块（`main/download/`）：装 Node 运行时 / npm / pnpm 都指着它，
    // 因此它有内核端点而不是走扩展的 DIY 通道。任务列表 / 操作与「下载」设置面板共用。
    /** 状态快照：配置 + 全部任务（含实时进度）。 */
    'GET /download': { result: DownloadStatus }
    /** 新建一个下载任务。 */
    'POST /download/tasks': { body: CreateDownloadOptions; result: DownloadTaskView }
    /** 开始一个任务（不改变排队语义）。 */
    'POST /download/tasks/:id/start': { result: DownloadTaskView | null }
    /** 暂停（保留已下载部分，可继续）。 */
    'POST /download/tasks/:id/pause': { result: DownloadTaskView | null }
    /** 继续 / 重试。 */
    'POST /download/tasks/:id/resume': { result: DownloadTaskView | null }
    /** 取消（保留已下载部分）。 */
    'POST /download/tasks/:id/cancel': { result: DownloadTaskView | null }
    /** 删除任务；`deleteFile` 为真时一并删掉落盘文件。 */
    'DELETE /download/tasks/:id': { query: { deleteFile?: boolean }; result: boolean }
    /** 更新下载配置（并发数 / 限速 / 默认目录 / 默认连接数）。 */
    'PUT /download/config': { body: Partial<DownloadConfig>; result: DownloadConfig }

    // ---- 原生对话框 ----
    'POST /dialog/directory': { result: string | null }
    'POST /dialog/file': { result: string | null }

    // ---- 独立确认子窗口（自建无边框窗口，取代内嵌确认弹层）----
    /** 弹出一个独立确认窗口并等待用户选择。 */
    'POST /dialog/confirm': { body: ConfirmDialogRequest; result: { confirmed: boolean } }
    /** 确认窗挂载后拉取自己的载荷（避免 did-finish-load 与订阅的时序竞态）。 */
    'GET /dialog/confirm/context': { result: ConfirmDialogRequest | null }
    /** 确认窗回传结果；主进程据此关窗并 resolve。 */
    'POST /dialog/confirm/reply': { body: { confirmed: boolean }; result: void }

    // ---- 外壳窗口 / 标签 ----
    /** 交系统默认程序打开一个 URI（协议白名单见 main/app/openlink.ts）。 */
    'POST /shell/open-external': { body: { url: string }; result: void }
    /**
     * 解析地址栏输入：网址就跳、否则按浏览器扩展配置的默认搜索引擎搜。
     * 规则整体在扩展 `xeonsky.browser` 里；扩展不可用时一律回落为 external（交系统浏览器）。
     */
    'POST /shell/resolve-input': { body: { raw: string }; result: ResolveResult }
    /** 解析导航页输入（纯跳转语义，不搜索）。 */
    'POST /shell/resolve-target': { body: { raw: string }; result: ResolveResult }
    'POST /shell/open-url': { body: { url: string }; result: void }
    'POST /shell/focus-core': { result: void }
    'GET /shell/meta': { result: { winId: number; isCore: boolean } }
    /** 取走本窗口的「开页意图」（创建副窗口时若带 URL，据此开一个动态标签页）。 */
    'POST /shell/open-intent': { result: string | null }
    'PUT /shell/title': { body: { title: string }; result: void }
    'POST /shell/move-tab': { body: { url: string }; result: boolean }

    // ---- 跨窗口拖标签 ----
    'POST /tab-drag': { body: { target: string }; result: Array<{ id: number; x: number; y: number; w: number; h: number }> }
    /** 报告当前「指针悬停的目标窗口」。 */
    'PATCH /tab-drag': { body: { targetId: number | null }; result: void }
    /** 结束 / 取消拖拽。 */
    'DELETE /tab-drag': { result: void }
    'POST /tab-drag/drop': { body: { targetId: number }; result: void }

    // ---- 窗口控制 ----
    'PUT /windows/zoom': { body: { percent: number }; result: void }
    'GET /windows/maximized': { result: boolean }
    'POST /windows/minimize': { result: void }
    'POST /windows/maximize-toggle': { result: void }
    'POST /windows/close': { result: void }
}

/** 主进程推送给渲染层的全部事件及其载荷类型。 */
export interface AppEvents {
    'appupdate:event': AppUpdateEvent
    // 进度载荷都带 kind（同一操作种类只有一条）：曾因 npm / pnpm 共用通道而串台。
    'nodeenv:deploy-progress': OperationProgress
    'npmenv:progress': OperationProgress
    'pnmenv:progress': OperationProgress
    'configdir:migration': ConfigMigrationProgress
    'dsh:url': string | null
    'dsh:log': LogEntry
    'settings:changed': Settings
    'settings:theme': Theme
    'settings:locale': LocaleCode
    'appicon:changed': AppIconState
    'hotkey:state': HotkeyState
    // 下载任务快照（节流推送；状态突变时立即推一次）。
    'download:progress': DownloadStatus
    'win:maximized': boolean
    'shell:core': boolean
    'tab-drag-hover': boolean
    'tab-drag:moved': void
    'ui:new-tab': string
    'ui:toggle-view': void
    'ui:reload-dsh': void
    'dsh:missing': void
    /** 扩展列表发生变化（启用 / 停用 / 安全模式切换后），设置页据此重新拉取。 */
    'extensions:changed': void
}

// ---------------------------------------------------------------------------
// 类型工具：从路由表推导每个端点的路径 / 入参 / 出参
// ---------------------------------------------------------------------------

/** 全部路由键。 */
export type RouteKey = keyof ApiRoutes

/** 某个 HTTP 方法下的全部路由键。 */
export type RouteKeys<Method extends HttpMethod> = Extract<RouteKey, `${Method} ${string}`>

/** 从路由键取出路径模板。 */
export type PathOf<Key extends RouteKey> = Key extends `${HttpMethod} ${infer Path}` ? Path : never

/** 按「路径 → 路由键」建索引：让客户端能从具体路径反查出路由定义。 */
export type RoutesByPath<Method extends HttpMethod> = { [Key in RouteKeys<Method> as PathOf<Key>]: Key }

/** 按路径查表（`Map` 作为裸类型参数，才能用 `keyof` 索引）。 */
type LookupPath<Map, Path extends string> = Path extends keyof Map ? Map[Path] : never

/** 某个方法下、某条具体路径对应的路由键。 */
export type RouteAt<Method extends HttpMethod, Path extends string> = LookupPath<RoutesByPath<Method>, Path>

/** 路径模板按 `/` 拆成的段（联合类型）。 */
type Segments<Template extends string> = Template extends `${infer Head}/${infer Tail}`
    ? Head | Segments<Tail>
    : Template

/** 单个路径段若是 `:name` 则取出 name。 */
type SegmentParam<Segment> = Segment extends `:${infer Name}` ? Name : never

/** 路径模板里的全部参数名。 */
export type PathParams<Template extends string> = SegmentParam<Segments<Template>>

/** 路由声明的查询参数类型（未声明则为 undefined）。 */
export type QueryOfRoute<Key extends RouteKey> = 'query' extends keyof ApiRoutes[Key]
    ? ApiRoutes[Key] extends { query?: infer Q } ? Q : never
    : undefined

/** 路由声明的请求体类型（未声明则为 undefined）。 */
export type BodyOfRoute<Key extends RouteKey> = 'body' extends keyof ApiRoutes[Key]
    ? ApiRoutes[Key] extends { body?: infer B } ? B : never
    : undefined

/** 路由声明的返回值类型。 */
export type ResultOfRoute<Key extends RouteKey> = ApiRoutes[Key] extends { result: infer R } ? R : never

/** 一次请求的可选项：路径参数按需必填，query / body 按路由声明。 */
export type RequestOptions<Key extends RouteKey> =
    (PathParams<PathOf<Key>> extends never
        ? { params?: undefined }
        : { params: Record<PathParams<PathOf<Key>>, string> })
    & { query?: QueryOfRoute<Key> }
    & { body?: BodyOfRoute<Key> }

/**
 * REST 风格客户端：方法与路径一对一，入参 / 出参由 `ApiRoutes` 推导。
 *
 * ```ts
 * api.get('/settings')
 * api.put('/settings', { body: settings })
 * api.get('/versions/:kind', { params: { kind: 'node' } })
 * api.delete('/icons/:id', { params: { id: 'user/abc.png' } })
 * ```
 */
export interface RestClient {
    get<Path extends keyof RoutesByPath<'GET'>>(
        path: Path,
        options?: RequestOptions<RouteAt<'GET', Path>>
    ): Promise<ResultOfRoute<RouteAt<'GET', Path>>>
    post<Path extends keyof RoutesByPath<'POST'>>(
        path: Path,
        options?: RequestOptions<RouteAt<'POST', Path>>
    ): Promise<ResultOfRoute<RouteAt<'POST', Path>>>
    put<Path extends keyof RoutesByPath<'PUT'>>(
        path: Path,
        options?: RequestOptions<RouteAt<'PUT', Path>>
    ): Promise<ResultOfRoute<RouteAt<'PUT', Path>>>
    patch<Path extends keyof RoutesByPath<'PATCH'>>(
        path: Path,
        options?: RequestOptions<RouteAt<'PATCH', Path>>
    ): Promise<ResultOfRoute<RouteAt<'PATCH', Path>>>
    delete<Path extends keyof RoutesByPath<'DELETE'>>(
        path: Path,
        options?: RequestOptions<RouteAt<'DELETE', Path>>
    ): Promise<ResultOfRoute<RouteAt<'DELETE', Path>>>
}

/** 渲染层可见的全部能力：REST 客户端 + 少量本地常量 + 事件订阅 + 扩展 DIY 通道。 */
export interface RendererApi extends RestClient {
    platform: string
    versions: { electron: string; node: string; chrome: string }
    /** 订阅主进程推送的事件，返回退订函数。 */
    on<Event extends keyof AppEvents>(event: Event, callback: (payload: AppEvents[Event]) => void): () => void
    /**
     * 扩展层的 **DIY 自定义通信接口**。
     *
     * 存在的理由：扩展端点（`/ext/<extId>/<action>`）是**运行期**才知道的，
     * 不可能写进 `ApiRoutes`（那是编译期契约，也是内置端点的唯一事实来源）。
     * 这个命名空间因此刻意**不受** `ApiRoutes` 约束 —— 通道名由扩展自己拼，
     * 返回类型由调用方自理。它是「能力面收窄」与「扩展可自由通信」之间的妥协口：
     *
     *  - `invoke(channel, payload)` —— 向主进程某扩展端点发一次请求。
     *    通道名必须是 `ext:<extId>:<action>`（由 {@link EXT_CHANNEL_PREFIX} 起始），
     *    主进程按同一 Router 分发，因此跨扩展无法冒充（前缀含 id）。
     *  - `on(channel, cb)` —— 订阅某扩展 push 过来的自定义事件。
     *
     * 之所以不把它做成五个 REST 动词：扩展的通道是"消息"而不是"资源"，
     * 一个动词（invoke）+ 一个订阅（on）正好对应「请求 / 推送」这对语义，
     * 也避免让扩展误以为它能声明任意 HTTP 路径。
     */
    ext: {
        /** 向主进程某扩展端点发一次请求；`channel` 形如 `ext:<extId>:<action>`。 */
        invoke(channel: string, payload?: unknown): Promise<unknown>
        /** 订阅某扩展自定义通道的推送，返回退订函数。 */
        on(channel: string, callback: (payload: unknown) => void): () => void
    }
}

/** 扩展自定义通道的固定前缀（与 `main/kernel/extroute.ts` 的 `EXT_ROUTE_PREFIX` 对应）。 */
export const EXT_CHANNEL_PREFIX = 'ext:'

/** 扩展自定义事件的通道前缀（主进程侧拼 `ext:<extId>:<action>` 后经事件通道推送）。 */
export const EXT_EVENT_PREFIX = 'ext:'
