import pino from 'pino'

/**
 * 渲染层的日志入口，与主进程 `kernel/logger` 对称。
 *
 * 渲染层跑在浏览器上下文里，没有文件系统，所以这里用 pino 的 **browser 构建**
 * （package.json 的 `browser` 字段指向 browser.js，Vite 会自动选中）：它保留
 * 分级、子 logger、结构化字段这些能力，输出走 `console`。
 *
 * 光进控制台不够 —— 用户机器上没开 devtools，出事之后什么都留不下。所以每次写入
 * 额外**上报一条给主进程**（`POST /logs/renderer`），由主进程用同一个 pino 实例
 * 再记一遍，于是渲染层的记录和主进程记录带同一种时间戳、落在同一份可轮转的文件里。
 *
 * 上报有三条自律（都在下面 `reportToMain` 里体现）：
 *  1. **只上报 warn 及以上**。info/debug 量大且多数无排查价值，逐条走 IPC 不值当。
 *  2. **失败必须静默**。日志上报自己绝不能抛错 —— 那会把「记录一个问题」变成「制造一个问题」。
 *  3. **先 console 后上报**。控制台是同步的、必然可见；IPC 是异步的，可能还没到进程就退了。
 */

/**
 * 需要上报到主进程的级别（连同其数字级别号）。
 *
 * 只覆盖 warn 及以上：info/debug 量大且多数无排查价值，逐条走 IPC 不值当。
 */
const REMOTE_LEVELS: Array<['fatal' | 'error' | 'warn', number]> = [
    ['fatal', 60],
    ['error', 50],
    ['warn', 40]
]

/**
 * 把一条日志转发给主进程落盘。
 *
 * 刻意不 await、也不上报失败：这是一条「尽力而为」的旁路。`window.api` 在极早期
 * （preload 尚未注入）或确认子窗口等场景可能缺席，此时直接放弃即可。
 */
function reportToMain(level: number, tag: string | undefined, message: string): void {
    try {
        void window.api?.post?.('/logs/renderer', { body: { level, tag, message } })?.catch?.(() => undefined)
    } catch {
        /* 上报失败不该影响调用方 */
    }
}

/**
 * 给一个 pino 实例挂上「warn 及以上转发到主进程」的钩子。
 *
 * 做法是替换各级别方法：pino browser 构建内部最终都走 `console`，没有官方的自定义
 * destination 口子（`pino({ browser: { write } })` 在 v10 已不是稳定选项），
 * 所以这里用最直白的方式包一层 —— 保留原方法的行为与返回的 logger，额外做一次转发。
 */
function withRemote(logger: pino.Logger, tag: string | undefined): pino.Logger {
    const patched = Object.create(logger) as pino.Logger
    for (const [name, level] of REMOTE_LEVELS) {
        const original = logger[name] as (...args: unknown[]) => void
        if (typeof original !== 'function') continue
        ;(patched as unknown as Record<string, unknown>)[name] = (...args: unknown[]): void => {
            original.apply(logger, args)
            // pino 的第一个参数可能是「合并对象」或「消息」；取最后一段文本作为上报内容。
            const text = args
                .map((a) => (typeof a === 'string' ? a : typeof a === 'object' && a ? safeStringify(a) : ''))
                .filter(Boolean)
                .join(' ')
            reportToMain(level, tag, text)
        }
    }
    return patched
}

/** 结构化字段的安全序列化（循环引用等异常不能把日志本身弄崩）。 */
function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value)
    } catch {
        return '[unserializable]'
    }
}

/**
 * 根 logger。
 *
 * 开发态 `debug`（控制台可见全部细节），发行态抬到 `warn` —— 发行版不该把一堆 info
 * 刷进用户的 devtools（虽然默认没人看，但那仍是噪音与开销）。
 */
const root = pino({
    level: import.meta.env.DEV ? 'debug' : 'warn',
    browser: { asObject: false }
})

/**
 * 取一个带模块标签的子 logger。
 *
 * 与主进程 `logger(tag)` 用法一致：`logger('[shell]').warn('…')`。
 */
export function logger(tag?: string): pino.Logger {
    return withRemote(tag ? root.child({ tag }) : root, tag)
}
