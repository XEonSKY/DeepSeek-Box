/**
 * 扩展 API 面 **ctx** —— 扩展唯一被允许触达内核的方式。
 *
 * 这是「API 面稳定」的实现方式，对应 NeoForge 的角色：扩展只依赖加载器给的 ctx，
 * **不直接 import 内核**。于是内核内部重构（比如这次把 `dsh/cancel.ts` 并进
 * `kernel/operations.ts`）不会波及任何扩展 —— 只要 ctx 的形状不变。
 *
 * ctx 刻意很**窄**：能力面是固定的 ——
 *  - 渲染侧扩展只有两个控制点（标签页、设置页）；
 *  - 主进程扩展只有两条通路（专用 IPC 接口、封装后的本地环境能力）。
 * 所以这里不提供 `ctx.kernel`、不给 Router 实例、不给 fs —— 想要能力必须**申请**。
 *
 * 本文件只定义**形状**与构造逻辑；实际的加载/注入编排在 loader/index.ts。
 */

import { format } from 'node:util'
import type { ExtCapability, ExtKind, ExtSettingsContribution, ExtTabContribution } from '@shared/extensions'
import { logger } from '../../kernel/logger'
import * as capability from './capability'
import * as registry from './registry'

/**
 * 把扩展 logger 的可变参压成一条消息。
 *
 * pino 的第一个参数是「合并对象」或「消息字符串」，不像 console 那样接受任意个参数；
 * 扩展 API 的 `ExtLogger` 沿用了 console 风格的可变参，所以这里先归一：
 * 首个字符串之外的内容用 `util.format` 拼进同一条消息，保证扩展作者不用改写法。
 */
function formatArgs(message: unknown, rest: unknown[]): string {
    return rest.length === 0 ? String(message) : format(String(message), ...rest)
}

/**
 * 扩展可以调用的能力接口。
 *
 * `call` 只在扩展**申请过**该能力时可用（申请由加载器在激活前校验）。
 * 之所以不直接暴露被包装的函数（如 `fs.removeTree`），而是要经 `call('fs', 'removeTree', ...)`：
 * 这样能力面在类型上是一张**可枚举的表**，而不是一堆散落的函数引用 ——
 * 授权、审计、将来加日志/限流，都只需要动这一个入口。
 */
export interface ExtCapabilityAccess {
    /** 该能力是否已申请且可用（软依赖判定用，缺失即降级）。 */
    has(name: ExtCapability): boolean
    /** 调用已申请的能力；未申请或未提供则抛错。 */
    call<T = unknown>(name: ExtCapability, action: string, ...args: unknown[]): T
}

/** 扩展在标签页控制点上能做的事（渲染侧生效；主进程侧为登记）。 */
export interface ExtTabsAccess {
    /** 注册一个标签页（同一扩展内 key 唯一）。 */
    register(contribution: ExtTabContribution): void
}

/** 扩展在设置页控制点上能做的事。 */
export interface ExtSettingsAccess {
    /** 注册一个设置面板（key 会拼进 `/settings/<key>` 路由）。 */
    registerPanel(contribution: ExtSettingsContribution): void
}

/**
 * 专用 IPC 通路（主进程扩展的通路 1）。
 *
 * 扩展声明自己的端点，经内核 `Router` 挂到唯一通道上。两条硬约束：
 *  - 通道按扩展 id 做命名空间隔离（见 `channelOf`），扩展 A 无法响应扩展 B 的消息；
 *  - **不可监听/拦截内置端点** —— 这不是靠约定，而是结构使然：
 *    内核 `Router.listen()` 只有一个 `ipcMain.handle`，扩展端点必须挂进同一个 Router，
 *    路径重名会在装配期被 `ModuleRegistry` 的 `claim()` 拦下抛错。
 */
export interface ExtIpcAccess {
    /**
     * 声明一个扩展自有端点。
     *
     * @param action 动作名（同一扩展内唯一），最终通道为 `ext:<extId>:<action>`
     */
    handle(action: string, handler: (...args: unknown[]) => unknown | Promise<unknown>): void
    /** 往渲染侧同名扩展发消息（走 preload 的 DIY 自定义通信口）。 */
    emit(action: string, payload?: unknown): void
    /** 本扩展的通道前缀（供扩展拼自定义通道名用）。 */
    readonly prefix: string
}

/** 扩展的日志出口（带上扩展 id 前缀，便于 dsh 日志与终端里定位来源）。 */
export interface ExtLogger {
    info(message: string, ...rest: unknown[]): void
    warn(message: string, ...rest: unknown[]): void
    error(message: string, ...rest: unknown[]): void
}

/**
 * 资源登记：把「需要归还的东西」交给加载器兜底。
 *
 * 内核只能保证**调用顺序**（逆序卸载），无法强制扩展真去释放定时器/句柄。
 * 所以提供一个登记口：卸载时加载器会替它执行一遍。这是「同进程无隔离」下的必要兜底 ——
 * 扩展的 bug 不该让整个应用留下悬挂资源。
 */
export interface ExtDisposables {
    /** 登记一个释放函数，卸载本扩展时逆序执行。 */
    add(dispose: () => void): void
}

/** 传给扩展入口的上下文。 */
export interface ExtContext {
    /** 本扩展的 id 与级别。 */
    readonly id: string
    readonly kind: ExtKind
    /** 本扩展所在目录（读写自己的文件可用；写盘请走 fs 能力）。 */
    readonly dir: string
    /** 本次加载的扩展 API 版本。 */
    readonly apiVersion: number
    readonly capabilities: ExtCapabilityAccess
    readonly tabs: ExtTabsAccess
    readonly settings: ExtSettingsAccess
    readonly ipc: ExtIpcAccess
    readonly log: ExtLogger
    readonly disposables: ExtDisposables
}

/** 扩展入口模块的导出形状：`activate` 必填，`deactivate` 可选。 */
export interface ExtModule {
    /** 激活扩展（异步允许）；抛错会被加载器捕获并只停用本扩展。 */
    activate(ctx: ExtContext): void | Promise<void>
    /** 可选：卸载时的清理（在 disposables 之前执行）。 */
    deactivate?(): void | Promise<void>
}

/** 生成某扩展的 IPC 通道前缀。 */
export function channelOf(extId: string): string {
    return `ext:${extId}`
}

/**
 * 构造一个 ctx。
 *
 * 实现上的关键点：**所有登记类操作都先经 registry/capability 记账再落地**，
 * 这样 `revokeAll(owner)` 能完整撤销 —— 卸载的完整性靠这里，不靠扩展自觉。
 */
export function createContext(options: {
    id: string
    kind: ExtKind
    dir: string
    apiVersion: number
    /** 已申请且校验通过的能力名。 */
    granted: ReadonlySet<ExtCapability>
    /** 各能力的动作表：能力名 → 动作名 → 实现。由系统扩展在激活时注入。 */
    actions: ReadonlyMap<string, ReadonlyMap<string, (...args: never[]) => unknown>>
    /** 端点登记的实际落点（由 loader 注入，避免本文件依赖内核 Router）。返回撤销函数。 */
    registerIpc: (action: string, handler: (...args: never[]) => unknown) => () => void
    /** 往渲染侧发消息（由 loader 注入，避免本文件依赖 kernel/runtime）。 */
    emitToRenderer: (action: string, payload: unknown) => void
    /** 标签页贡献的落点，返回撤销函数。 */
    registerTab: (contribution: ExtTabContribution) => () => void
    /** 设置面板贡献的落点，返回撤销函数。 */
    registerPanel: (contribution: ExtSettingsContribution) => () => void
}): ExtContext {
    const { id, kind, dir, apiVersion, granted, actions } = options
    const prefix = channelOf(id)

    const capabilities: ExtCapabilityAccess = {
        has: (name) => granted.has(name) && actions.has(name),
        call: <T,>(name: ExtCapability, action: string, ...args: unknown[]): T => {
            if (!granted.has(name)) throw new Error(`扩展 ${id} 未申请能力：${name}`)
            const table = actions.get(name)
            if (!table) throw new Error(`能力未就绪：${name}（提供它的扩展可能未加载）`)
            const fn = table.get(action)
            if (!fn) throw new Error(`能力 ${name} 不支持动作：${action}`)
            return fn(...(args as never[])) as T
        }
    }

    const tabs: ExtTabsAccess = {
        register: (contribution) => {
            // 落地 → 拿到撤销函数 → 交给注册表记账。
            // 顺序不能反：注册表的 dispose 参数是「怎么撤销」，不是「怎么落地」。
            const undo = options.registerTab(contribution)
            registry.register(id, 'tab', `${id}/${contribution.key}`, undo)
        }
    }

    const settings: ExtSettingsAccess = {
        registerPanel: (contribution) => {
            const undo = options.registerPanel(contribution)
            registry.register(id, 'settings-panel', `${id}/${contribution.key}`, undo)
        }
    }

    const ipc: ExtIpcAccess = {
        prefix,
        handle: (action, handler) => {
            const undo = options.registerIpc(action, handler as never)
            registry.register(id, 'ipc', `${prefix}:${action}`, undo)
        },
        emit: (action, payload) => options.emitToRenderer(action, payload)
    }

    const disposables: ExtDisposables = {
        add: (dispose) => {
            registry.register(id, 'disposable', `${id}/${registry.size()}`, dispose)
        }
    }

    // 扩展自己的日志：走主进程统一日志入口（pino），tag 带上扩展 id 便于检索。
    const tag = `[ext:${id}]`
    const extLog = logger(tag)
    const log: ExtLogger = {
        info: (message, ...rest) => extLog.info(formatArgs(message, rest)),
        warn: (message, ...rest) => extLog.warn(formatArgs(message, rest)),
        error: (message, ...rest) => extLog.error(formatArgs(message, rest))
    }

    return { id, kind, dir, apiVersion, capabilities, tabs, settings, ipc, log, disposables }
}

/** 当前已提供的能力快照（供加载器在构造 ctx 前收集动作表）。 */
export function capabilitySnapshot(): Array<{ name: string; owner: string }> {
    return capability.snapshot()
}

/** 停止某个扩展时：撤销它的全部贡献与能力。 */
export function releaseOwner(owner: string): { contributions: number; capabilities: number } {
    const capabilities = capability.revoke(owner)
    const contributions = registry.revokeAll(owner)
    return { contributions, capabilities }
}
