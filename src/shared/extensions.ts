/**
 * 扩展体系的**共享契约**：主进程、渲染层、扩展作者三方共用。
 *
 * 三层的角色（对照 Minecraft : NeoForge : Mods 的模型）：
 *
 *   内核 kernel/        —— 机制，完全不认识扩展（本文件不属于内核）
 *   加载器 loader/      —— 发现 / 排序 / 注入 / 提供 ctx，独立一层
 *   扩展 extensions/    —— 内容，只依赖加载器给的 ctx
 *
 * **依赖方向单向固定**：扩展 → 加载器 → 内核。内核不 import 本文件之外的扩展相关内容。
 *
 * 这里有三个概念要分清楚，它们的差别决定了加载器的实现：
 *
 *  - **级别 kind**（system / builtin / external）：描述「扩展从哪来、有多可信」；
 *  - **状态 status**（active / disabled / failed / skipped）：描述「当前跑没跑」；
 *  - **能力 capability**：系统能力(如 fs/net) 或扩展对外提供的能力，都需要显式申请。
 */

// ---------------------------------------------------------------------------
// 级别：扩展的来源与信任度
// ---------------------------------------------------------------------------

/**
 * 扩展的三级来源。级别决定了加载路径、能否被停用、以及失败时的处理方式。
 *
 *  - `system`  系统扩展：把内核已有能力**包装成扩展形态**（「说是扩展其实是系统能力抽象化的体现」）。
 *              随内核一同释放，**不可停用、不可卸载**，也不受崩溃禁用与安全模式影响
 *              —— 它没有「出问题就关掉」的语义，因为关掉它等于内核能力凭空消失。
 *  - `builtin` 内置扩展：源码在 `./src/{main,renderer/src}/extensions/`，进构建产物随安装包发布。
 *  - `external` 外部扩展：装在 `~/.dsbox/{channel}/extensions/` 下的用户代码，可装卸、可启停。
 */
export type ExtKind = 'system' | 'builtin' | 'external'

// ---------------------------------------------------------------------------
// 状态：当前运行情况
// ---------------------------------------------------------------------------

/**
 * 扩展的加载状态。
 *
 *  - `active`   已加载并在运行；
 *  - `disabled` 被用户停用（或未启用），不加载；
 *  - `failed`   加载或激活时抛错，本次不生效（**不影响其它扩展**）；
 *  - `skipped`  因安全模式、或硬依赖缺失而未尝试加载。
 */
export type ExtStatus = 'active' | 'disabled' | 'failed' | 'skipped'

/**
 * 一个扩展在界面上需要的全部信息（`GET /extensions` 的返回项）。
 *
 * 刻意**不含**入口路径以外的实现细节：渲染层只需要「列出来、能启停」，不需要知道它内部结构。
 */
export interface ExtInfo {
    /** 扩展唯一标识，也是能力与通道的命名空间前缀。 */
    id: string
    /** 展示名（扩展自报，缺省回落 id）。 */
    name: string
    /** 版本号（扩展自报，仅用于展示与排查）。 */
    version: string
    /** 来源级别。 */
    kind: ExtKind
    /** 当前状态。 */
    status: ExtStatus
    /** 状态说明：失败原因 / 被跳过原因（成功时为空串）。 */
    message: string
    /** 该扩展申请的能力名（用于界面展示与排查）。 */
    capabilities: ExtCapability[]
    /** 依赖的其它扩展 id（硬依赖）。 */
    dependencies: string[]
    /**
     * 该扩展声明的贡献点。
     *
     * 之所以要放进列表返回给渲染层：渲染层是**呈现**贡献点的地方（标签页 / 设置面板），
     * 它需要知道"有哪些扩展贡献了什么"。主进程只做裁决与登记，不替渲染层记内容 ——
     * 否则两边各存一份贡献点，卸载时容易出现"主进程撤了、渲染层还留着"的不一致。
     */
    contributions?: ExtContributions
    /** 磁盘位置（内置扩展为源码目录，外部扩展为安装目录）。 */
    dir: string
    /** 是否可被用户停用（系统扩展为 false）。 */
    removable: boolean
}

/** `GET /extensions` 的完整返回。 */
export interface ExtensionsInfo {
    /** 全部已发现扩展（含被停用 / 失败的，便于排查）。 */
    entries: ExtInfo[]
    /** 当前是否处于安全模式（跳过加载器启动）。 */
    safeMode: boolean
    /** 外部扩展安装根目录（`~/.dsbox/{channel}/extensions`）。 */
    externalDir: string
}

// ---------------------------------------------------------------------------
// 能力：系统能力与扩展能力的统一命名
// ---------------------------------------------------------------------------

/**
 * 系统能力名（由**系统扩展**提供）。
 *
 * 按能力域拆开而不是合成一个大扩展：授权与排查都需要**粒度**，
 * 「要么全给要么全不给」会让能力申请失去意义。命名域与实现一一对应：
 *
 *  - `fs`      文件读写与整目录删除（包装 kernel/treeops）
 *  - `net`     主进程 HTTP 请求（包装 dsh/http 的 httpFetch）
 *  - `proc`    子进程（包装 dsh/child 的 runChild）
 *  - `app`     应用内服务（包装 kernel/services 的服务槽）
 *  - `ui`      对外壳界面的受控操作（标签页 / 设置页注册由渲染层 loader 承接）
 *  - `webview` 内嵌页面所处的会话（defaultSession）配置：UserAgent / 代理 / 权限策略
 *              （包装 Electron 的 session API）。单独成一个域，因为它是**唯一**
 *              能改变「任意站点在内嵌页面里的行为」的能力，审计价值最高。
 *  - `extmanage` 扩展层自身的管理（重载单个 / 全部扩展、列扩展）。包装加载器的
 *              `reloadExt` / `reloadAll` / `info`，供扩展生态内部协作（改完代码立刻生效）。
 */
export type SysCapability = 'fs' | 'net' | 'proc' | 'app' | 'ui' | 'webview' | 'extmanage'

/** 全部系统能力名（加载器与系统扩展共用，避免字符串散落各处）。 */
export const SYS_CAPABILITIES: readonly SysCapability[] = ['fs', 'net', 'proc', 'app', 'ui', 'webview', 'extmanage']

/**
 * 扩展可申请的能力名：系统能力，或「某个扩展对外提供的能力」。
 *
 * 约定 `ext:<extId>/<name>` 指向另一个扩展提供的能力 —— 这类能力由**加载器**持有，
 * 不走系统扩展（见 loader/capability.ts 的说明）。
 */
export type ExtCapability = SysCapability | `ext:${string}`

// ---------------------------------------------------------------------------
// 清单：扩展的自我描述
// ---------------------------------------------------------------------------

/**
 * 贡献点：扩展往外挂的东西。
 *
 * 渲染层**只有两个控制点**（标签页、设置页），主进程**只有两条通路**（专用 IPC、封装后的本地能力）
 * —— 所以贡献点的种类是**可枚举的、故意很少的**。想加新的贡献点等于扩能力面，
 * 要先想清楚它是否真的必要：能力面越窄，授权与审计才有落点。
 */
export interface ExtContributions {
    /** 标签页：在标题栏标签条里注册一个扩展自有标签页。 */
    tabs?: ExtTabContribution[]
    /** 设置页：在设置侧栏追加一个面板（追加在内置项**之后**，不插入内置项中间）。 */
    settings?: ExtSettingsContribution[]
}

/** 扩展注册的标签页（渲染层控制点 1）。 */
export interface ExtTabContribution {
    /** 标签页 key（同一扩展内唯一）。 */
    key: string
    /** 标签页标题：i18n 文案键，由扩展自己提供，避免硬编码中文。 */
    titleKey: string
    /** 承载内容的 URL（可为内置的伪链接，由扩展自行解释）。声明了 `view` 时不需要。 */
    url?: string
    /**
     * 本地视图实现名 —— **程序内置标签页视图**（关键约束与设置面板的 `view` 完全相同：
     * 只有内置 / 系统扩展能解析，外部扩展填了也会被忽略）。
     *
     * 用途是让扩展提供一个**不经过 webview** 的标签页界面。目前只有一个落点：
     * 外壳的「新建标签页」页 —— 它从内建的 Vue 页面改为由扩展贡献
     * （见 `xeonsky.browser` 的 `newtab`），扩展停用时外壳回落到自带的极简页。
     *
     * 注意带 `view` 的贡献**不会**被当成普通标签页打开（`registerExtTabs` 会跳过），
     * 它只是一个「视图注册声明」，由外壳在需要时按名字挂载。
     */
    view?: string
    /** 是否随扩展启用就打开一次（仅对 URL 型贡献有意义）。 */
    openOnStart?: boolean
}

/** 扩展注册的设置面板（渲染层控制点 2）。 */
export interface ExtSettingsContribution {
    /** 面板 key：决定了路由 `/settings/<key>` 与侧栏高亮。 */
    key: string
    /** 侧栏文案键（扩展自备）。 */
    titleKey: string
    /** 图标名（可选；由外壳映射到具体图标组件，扩展不能直接传组件）。 */
    icon?: string
    /**
     * 面板视图的来源。
     *
     * 关键约束：**外部扩展不能提供 Vue 组件** —— 那等于让它在与外壳同一个 DOM 与 JS
     * 上下文里执行任意代码，风险远高于主进程侧的能力申请。因此这个字段只对**内置 / 系统**
     * 扩展有意义（它们随构建进包，受编译期检查），格式为外壳已登记的实现名（如 `extensions`）。
     * 外部扩展填了也会被忽略，落到通用容器视图。
     */
    view?: string
}

/**
 * 启动前配置：**内核必须在 `app.whenReady()` 之前**就落地的一组开关。
 *
 * 之所以要单独一条契约（而不是等扩展 `activate()` 时再设置）：Electron 有一批设置在
 * 「进程启动就绪」那一刻就被固化，之后调用静默无效 —— 典型如 `app.disableHardwareAcceleration()`。
 * 而扩展层的加载（`startLoader()`）本身就在 ready **之后**，等它跑到已经晚了。
 *
 * 因此做法反过来：内核在 ready **之前**扫一遍**内置 / 系统**扩展的静态清单（源码随构建进包，
 * 无需磁盘发现），把这里申报的值先应用掉。扩展 `activate()` 时无需再管这些项。
 *
 * **限制**：只有内置 / 系统扩展能申报 —— 外部扩展装在磁盘上，ready 前读它的 manifest
 * 需要同步 IO 且信任度不足，不做（外部扩展调用这些 API 静默无效，与 Electron 行为一致）。
 */
export interface ExtPreReadyConfig {
    /**
     * 是否禁用硬件加速。
     *
     * 注意语义是**「禁用」**而非常见的「启用」：Electron 原生 API 只有
     * `disableHardwareAcceleration()`，且用户设置里的默认态是「开启硬件加速」。
     * 用 `disable` 表述可以避免「未申报」与「申报为 false」两种情况的歧义 ——
     * 未申报 = 不介入，沿用 Electron 默认（即开启）。
     */
    disableHardwareAcceleration?: boolean
}

/**
 * 扩展清单：`manifest.json` 的内容，也是加载器排序与授权的唯一依据。
 *
 * 只声明「我是谁、要什么、给什么」，不含任何行为 —— 行为在入口模块里。
 */
export interface ExtManifest {
    /** 稳定唯一标识（同 id 冲突时先发现的生效，后者跳过并报因）。 */
    id: string
    /** 展示名。 */
    name?: string
    /** 版本号。 */
    version?: string
    /** 兼容的扩展 API 版本（加载器按它决定是否加载；不匹配则跳过）。 */
    apiVersion?: number
    /**
     * 硬依赖：这些扩展**必须**先加载成功，否则本扩展不加载（并报出缺失原因）。
     * 软依赖请自行用 `ctx.has()` 判断，不要写在这里。
     */
    dependencies?: string[]
    /** 申请的能力（系统能力或其它扩展提供的能力）。 */
    capabilities?: ExtCapability[]
    /** 贡献点。 */
    contributions?: ExtContributions
    /** 主进程入口（相对扩展目录；内置扩展可缺省，由加载器约定默认文件名）。 */
    main?: string
    /** 渲染层入口（相对扩展目录）。 */
    renderer?: string
    /**
     * 启动前配置：内核在 ready 之前预读并应用（见 {@link ExtPreReadyConfig}）。
     * 仅内置 / 系统扩展有效。
     */
    preReady?: ExtPreReadyConfig
}

/**
 * 当前扩展 API 版本。
 *
 * **一旦对外暴露就需要维护兼容**：内核重构不能直接改 ctx 的形状，
 * 要么加兼容层、要么升这个版本号让老扩展被明确跳过（而不是运行到一半崩）。
 */
export const EXT_API_VERSION = 1

// ---------------------------------------------------------------------------
// 崩溃与安全模式
// ---------------------------------------------------------------------------

/**
 * 崩溃计数与安全模式判定用的阈值。
 *
 * 语义：**同一个扩展**在最近 `WINDOW` 次启动里失败达到 `THRESHOLD` 次即进安全模式，
 * 全部内置 / 外部扩展都不加载（系统扩展不受影响）。
 *
 * 之所以按「启动次数」而不按「运行时长」计：扩展崩溃绝大多数发生在加载 / 激活阶段，
 * 按启动计能立刻收敛，不会让用户连续启动十几次都在同一个地方崩。
 */
export const EXT_CRASH_WINDOW = 3
export const EXT_CRASH_THRESHOLD = 2

/** 落盘的崩溃记录（`~/.dsbox/{channel}/extensions-state.json`）。 */
export interface ExtStateFile {
    /** 结构版本，便于将来迁移。 */
    version: number
    /**
     * 崩溃记录：扩展 id → 最近若干次启动的失败次数。
     * 达到阈值即进安全模式；用户在扩展页手动启用任一扩展时清零（视为「我已知道并要试一次」）。
     */
    crashes: Record<string, number>
    /** 被用户停用的扩展 id（系统扩展不会出现在这里）。 */
    disabled: string[]
    /** 上次进入安全模式的原因说明（用于界面提示；一旦成功启动一次即清空）。 */
    safeModeReason?: string
}
