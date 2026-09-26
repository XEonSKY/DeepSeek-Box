/**
 * 下载模块的**跨端契约**：渲染层（「下载」设置面板）与主进程（`main/download/`）共用。
 *
 * 与 `main/download/types.ts` 的分工：那边是主进程内部的任务模型（含 `TaskRecord` 这类
 * 「落盘形状」，渲染层不该看）；这里只留**穿过 IPC 的那几个形状**。
 * 两边刻意保持结构兼容（`DownloadTaskView` 与主进程的 `TaskView` 同形），
 * 于是端点实现可以直接把内部形状返回出去，不必写映射。
 */

/**
 * 下载可用的「代理档位」。
 *
 * 与 `dsh/http.ts` 的 `HttpScope` 同源，但只暴露三档：`update` 是应用自更新的专属
 * session、`registry` 只服务于注册表查询，都不该被下载任务使用。
 */
export type DownloadProxyScope = 'app' | 'npm' | 'node'

/** 并发连接数：'auto' = 按本机算力自适应，或 1–16 的具体值。 */
export type DownloadThreadsOption = 'auto' | number

/** 任务状态。 */
export type DownloadTaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'error' | 'canceled'

/** 界面看到的下载任务。 */
export interface DownloadTaskView {
    id: string
    url: string
    /** 最终文件名（不含目录）。 */
    fileName: string
    /** 最终落盘目录。 */
    destDir: string
    /** 服务端声明的总大小（0 = 未知）。 */
    total: number
    /** 已完成字节数。 */
    downloaded: number
    /** 并发连接数。 */
    threads: DownloadThreadsOption
    /** 代理档位。 */
    proxyScope: DownloadProxyScope
    /** 本任务限速（字节/秒；0 = 跟随全局）。 */
    speedLimit: number
    status: DownloadTaskStatus
    /** 最近一次失败原因。 */
    error?: string
    /** 0–100。 */
    percent: number
    /** 当前速度（字节/秒）。 */
    speed: number
    createdAt: number
    updatedAt: number
}

/** 下载模块配置。 */
export interface DownloadConfig {
    /** 默认下载目录（空串 = 系统下载目录）。 */
    defaultDir: string
    /** 同时进行的任务数上限。 */
    maxConcurrent: number
    /** 全局限速（字节/秒；0 = 不限）。 */
    speedLimit: number
    /** 默认并发连接数。 */
    threads: DownloadThreadsOption
}

/** 状态快照（端点返回；也用于进度推送的载荷）。 */
export interface DownloadStatus {
    /** 引擎是否可用。 */
    available: boolean
    config: DownloadConfig
    /** 当前配置生效的并发连接数（'auto' 解析后的值）。 */
    effectiveThreads: number
    /** 当前正在下载的任务数。 */
    activeCount: number
    tasks: DownloadTaskView[]
}

/** 新建下载任务的入参。 */
export interface CreateDownloadOptions {
    url: string
    /** 落盘目录（缺省用配置的默认目录）。 */
    destDir?: string
    /** 文件名（缺省按 URL 推断）。 */
    fileName?: string
    threads?: DownloadThreadsOption
    proxyScope?: DownloadProxyScope
    /** 本任务限速（0 = 跟随全局）。 */
    speedLimit?: number
    /** 是否立即开始（缺省 true）。 */
    start?: boolean
}
