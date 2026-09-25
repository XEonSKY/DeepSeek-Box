import path from 'node:path'
import pino from 'pino'
import type { Logger } from 'pino'

/**
 * kernel：全进程唯一的日志入口。
 *
 * 收口之前，主进程的诊断日志散落着约 40 处裸 `console.*`，没有级别、没有时间戳、
 * 也不落盘 —— 打包后用户遇到问题，除了界面上的终端流之外什么都留不下。这里把它们
 * 统一到一个 pino 实例上：
 *
 *  - **控制台**：开发态走 `pino-pretty`（可读的单行彩色输出），发行态走 pino 默认
 *    JSON —— pino-pretty 是 devDependency，打包产物里**没有**它，所以只在开发态才把它
 *    作为 transport 目标（见 `consoleTarget`），否则发行版一启动就 MODULE_NOT_FOUND。
 *  - **文件**：`pino-roll` 按大小轮转写到 `<配置目录>/logs/dsbox.log`，避免长期运行
 *    把磁盘写满。
 *
 * 刻意**不 import Electron / app/settings**：kernel 是机制层，不认业务目录。
 * 输出目录由启动方（`index.ts`，那里本来就有 configDir）通过 `initLogger` 注入。
 */

/** 当前 logger；`initLogger` 之前是 null，日志退化成 console 直出。 */
let root: Logger | null = null

/** 是否已初始化（重复调用是 no-op，避免测试 / 热重载重复建流）。 */
let initialized = false

/**
 * 控制台目标。
 *
 * 开发态套 pino-pretty 的 transport（它内部起 worker，输出人类可读的单行日志）；
 * 发行态直接用 pino 默认的 stdout JSON。
 *
 * **为什么按 `NODE_ENV` 分支而不是 try/catch 探测**：pino-pretty 是 devDependency，
 * 打包产物里根本没有它 —— 只要在发行态指向它就会 MODULE_NOT_FOUND。而 `NODE_ENV` 是
 * 可靠的信号：`electron-vite dev` 设成 development、打包态固定 production。开发态
 * 它必然已安装（npm install 装了 devDependencies），无需再探测，也就避免了在
 * ESM/CJS 边界上折腾 `require.resolve`。
 */
function consoleTarget(): pino.TransportTargetOptions {
    if (!isDev()) {
        return { target: 'pino/file', options: { destination: 1 }, level: 'debug' }
    }
    return {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
            singleLine: true
        },
        level: 'debug'
    }
}

/** 是否开发态（`electron-vite dev` 会设 NODE_ENV=development）。 */
function isDev(): boolean {
    return process.env.NODE_ENV === 'development'
}

/**
 * 初始化日志：控制台 +（可选）按大小轮转的日志文件。
 *
 * @param dir 日志目录的父目录（通常是配置目录）；传 null 表示只输出控制台，
 *            用于启动极早期还不知道配置目录、或纯探针场景。
 */
export function initLogger(dir: string | null, level: string = 'debug'): Logger {
    if (initialized && root) return root

    const targets: pino.TransportTargetOptions[] = [consoleTarget()]
    if (dir) {
        targets.push(fileTarget(path.join(dir, 'logs', 'dsbox.log')))
    }

    try {
        root = pino({ level, transport: { targets } })
    } catch (err) {
        // transport 起不来（例如 pino-pretty 的 worker 挂了）时不能连日志都没有：
        // 回落到不带 transport 的裸 pino，保证进程还能说出来话。
        root = pino({ level })
        root.error({ err }, 'logger transport init failed; falling back to plain console output')
    }
    initialized = true
    return root
}

/**
 * 日志文件目标：按大小轮转。
 *
 * 只给 `size`（5 MB 到顶即轮转）；不给 `frequency`，避免同一份日志既按时间又按大小
 * 切出过多碎片。`limit.count = 5` 表示最多保留 5 个历史文件 + 1 个当前文件；
 * `mkdir` 让 pino-roll 自己建 `<配置目录>/logs/`（首次运行时它还不存在）。
 */
function fileTarget(file: string): pino.TransportTargetOptions {
    return {
        target: 'pino-roll',
        options: {
            file,
            size: '5m',
            limit: { count: 5 },
            mkdir: true
        },
        level: 'debug'
    }
}

/**
 * 取一个带模块标签的子 logger。
 *
 * 标签沿用原来的 `[Manager]` / `[Core]` / `[ext]` 文本，落在 pino 的 `tag` 字段上，
 * 这样 pino-pretty 的输出形态与改造前几乎一致，历史日志习惯不用改。
 */
export function logger(tag?: string): Logger {
    const base = root ?? pino({ level: 'debug' })
    return tag ? base.child({ tag }) : base
}

/**
 * 渲染层上报的一条日志。
 *
 * 渲染层的 pino 是 **browser 构建**：它能分级、能带 tag，但写不出文件。所以它把
 * 「级别 + tag + 消息」这三样交给主进程，由主进程用**自己**的 logger 重新记一遍 ——
 * 这样渲染层的记录与主进程记录带同一种时间戳来源，落在同一份文件里，也能被 pino-roll
 * 一起轮转。
 */
export interface RemoteLogRecord {
    /** pino 标准级别号（10=trace … 60=fatal）；未知值按 info(30) 处理。 */
    level: number
    /** 模块 / 扩展标签，落在 `tag` 字段，与主进程子 logger 一致。 */
    tag?: string
    /** 已序列化的消息文本（渲染层不再传结构体，避免跨进程类型漂移）。 */
    message: string
}

/**
 * 写入一条来自渲染层的日志。
 *
 * 按级别号映射到对应方法，未知级别退化成 info。`from: 'renderer'` 是固定标记，
 * 便于在日志里一眼区分这条是渲染层报上来的。
 */
export function writeRemoteLog(rec: RemoteLogRecord): void {
    if (!root) return
    const child = rec.tag ? root.child({ tag: rec.tag, from: 'renderer' }) : root.child({ from: 'renderer' })
    const msg = String(rec.message ?? '')
    if (rec.level >= 60) child.fatal(msg)
    else if (rec.level >= 50) child.error(msg)
    else if (rec.level >= 40) child.warn(msg)
    else if (rec.level >= 30) child.info(msg)
    else if (rec.level >= 20) child.debug(msg)
    else child.trace(msg)
}

/** 关闭日志流（退出时调用，让 pino-roll 把缓冲刷盘、worker 收干净）。 */
export function closeLogger(cb?: (err?: Error) => void): void {
    try {
        // transport 模式下 pino 会把 flush 透传到 worker；无 transport 时该调用是 no-op。
        root?.flush?.(cb)
    } catch {
        cb?.()
    }
    root = null
    initialized = false
}
