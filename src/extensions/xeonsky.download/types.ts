/**
 * 扩展 `xeonsky.download` 的能力契约与任务模型。
 *
 * 放在扩展自己的目录里（而不是 `src/shared/`）的原因与 `xeonsky.zip/types.ts` 相同：
 * 这些形状只服务本扩展，不是内核契约。内核的 `src/shared/api.ts` 是**内置端点**的
 * 唯一事实来源，而扩展对外提供的能力走 `ext:<id>` 命名空间，形状由扩展自己持有。
 *
 * 三类东西：
 *  - **任务模型**（{@link TaskRecord} / {@link TaskView}）—— 持久化的形状与界面看到的形状；
 *  - **能力入参出参**（{@link CreateOptions} / {@link DownloadResult} …）—— 能力面契约；
 *  - **配置**（{@link DownloadConfig}）—— 并发、限速、默认目录。
 */

// ---------------------------------------------------------------------------
// 代理范围
// ---------------------------------------------------------------------------

/**
 * 下载可用的「代理档位」。
 *
 * 与 `system.net` 的 `HttpScope` 同源，但**只暴露三档**：`update` 是应用自更新的专属
 * session、`registry` 只服务于注册表查询，都不该被下载任务使用。
 * 默认 `npm`（历史上的下载只服务于 npm / dsh 包）。
 */
export type ProxyScope = 'app' | 'npm' | 'node'

/** 并发连接数：'auto' = 按本机算力自适应，或 1–16 的具体值。 */
export type DownloadThreads = 'auto' | number

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

/** 任务状态。 */
export type TaskStatus =
    /** 排队中（等待并发槽位）。 */
    | 'queued'
    /** 正在下载。 */
    | 'running'
    /** 已暂停（保留 .part 与进度，可续传）。 */
    | 'paused'
    /** 已完成并落位。 */
    | 'done'
    /** 出错（保留已下载部分，可重试续传）。 */
    | 'error'
    /** 已取消。 */
    | 'canceled'

/** 分段进度：`done` 是**下一个待写字节**的偏移（即 [start, done) 已完成）。 */
export interface SegmentProgress {
    start: number
    end: number
    done: number
}

/**
 * 任务的**持久化**形状（写进 `dataDir/tasks.json`）。
 *
 * 只存「重启后仍需要」的东西；实时速度、进度这类派生物不落盘（见 {@link TaskView}）。
 */
export interface TaskRecord {
    id: string
    url: string
    /** 最终文件名（不含目录）。 */
    fileName: string
    /** 最终落盘目录。 */
    destDir: string
    /** 分段临时文件所在目录（默认 dataDir/tmp）。 */
    tmpDir: string
    /** 服务端声明的总大小（0 = 未知）。 */
    total: number
    /** 已完成字节数（含上次会话续传来的部分）。 */
    downloaded: number
    /** 服务端是否支持 Range（决定能不能续传）。 */
    acceptRanges: boolean
    /** 校验标识（ETag / Last-Modified）：变化时不能续传，必须重下。 */
    etag: string
    lastModified: string
    /** 并发连接数。 */
    threads: DownloadThreads
    /** 代理档位。 */
    proxyScope: ProxyScope
    /**
     * 本任务的限速（字节/秒；0 = 跟随全局）。
     *
     * 注意：分段进度的**权威记录**在 `.part.json` 侧车里（见 engine.ts），
     * 任务表只留 `downloaded` 这个汇总值 —— 两处都存分段表会互相打架，
     * 而侧车本来就是给引擎用的，没必要再复制一份进来。
     */
    speedLimit: number
    status: TaskStatus
    /** 最近一次失败原因。 */
    error?: string
    createdAt: number
    updatedAt: number
}

/** 界面看到的任务（在持久化形状上补实时字段）。 */
export interface TaskView extends TaskRecord {
    /** 0–100。 */
    percent: number
    /** 当前速度（字节/秒）。 */
    speed: number
}

/** 进度回调的形状（与内核 `dsh/downloader.ts` 历史形状一致，便于调用方平滑迁移）。 */
export interface DownloadProgress {
    total: number
    downloaded: number
    /** 0–100 */
    percent: number
    /** bytes/s */
    speed: number
}

/** 一次阻塞式下载的结果。 */
export interface DownloadResult {
    ok: boolean
    canceled?: boolean
    message?: string
    /** 落盘后的绝对路径。 */
    file: string
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 扩展配置（存 `dataDir/config.json`）。 */
export interface DownloadConfig {
    /** 默认下载目录（空串 = 系统下载目录）。 */
    defaultDir: string
    /** 同时进行的任务数上限。 */
    maxConcurrent: number
    /** 全局限速（字节/秒；0 = 不限）。 */
    speedLimit: number
    /** 默认并发连接数。 */
    threads: DownloadThreads
}

/** 配置默认值。 */
export const DEFAULT_CONFIG: DownloadConfig = {
    defaultDir: '',
    maxConcurrent: 2,
    speedLimit: 0,
    threads: 'auto'
}

// ---------------------------------------------------------------------------
// 能力面入参
// ---------------------------------------------------------------------------

/** 新建任务的入参。 */
export interface CreateOptions {
    url: string
    /** 落盘目录（缺省用配置的默认目录）。 */
    destDir?: string
    /** 文件名（缺省按 URL 推断）。 */
    fileName?: string
    threads?: DownloadThreads
    proxyScope?: ProxyScope
    /** 本任务限速（0 = 跟随全局）。 */
    speedLimit?: number
    /** 是否立即开始（缺省 true；false = 以 queued/paused 状态入队）。 */
    start?: boolean
}

/**
 * 阻塞式下载的入参 —— 形状刻意与内核历史上 `dsh/downloader.ts` 的 `DownloadFileOpts`
 * 保持一致，于是 `dsh/nodeenv` / `npmRunner` / `pnpmRunner` 换后端时**一行都不用改**。
 */
export interface DownloadFileOptions {
    url: string
    destDir: string
    fileName?: string
    /** 临时文件目录。 */
    tmpDir?: string
    onProgress?: (p: DownloadProgress) => void
    threads?: DownloadThreads
    proxyScope?: ProxyScope
    /** 外部取消信号。 */
    signal?: AbortSignal
}

/** 状态快照（界面与自检用）。 */
export interface DownloadStatus {
    /** 引擎是否可用。 */
    available: boolean
    config: DownloadConfig
    /** 当前配置生效的并发连接数（'auto' 解析后的值）。 */
    effectiveThreads: number
    /** 当前正在下载的任务数。 */
    activeCount: number
    tasks: TaskView[]
}

/** 本扩展对外提供的动作名（与 main.ts 的 provides.register 表一致）。 */
export const CAPABILITY_ACTIONS = [
    'status',
    'list',
    'get',
    'create',
    'start',
    'pause',
    'resume',
    'cancel',
    'remove',
    'retry',
    'setConfig',
    'download'
] as const
