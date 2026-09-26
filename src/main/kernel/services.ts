/**
 * kernel：极小的**服务槽**，用于打破模块间的直接 import。
 *
 * 微内核原则是「模块互不认识」，但总有少数跨模块的**动作**需要触达（例如设置页要
 * 「重启 dsh」、外壳要「聚焦核心窗口」）。若让 `modules/settings.ts` 直接
 * `import { restart } from '../dsh/dsh'`，就会形成
 * `modules/settings → dsh/dsh → app/settings` 的静态环 —— 能跑，但脆弱：
 * 任何一边新增依赖都可能把环闭死。
 *
 * 这里的做法是**控制反转**：提供方在自己的模块 `onReady` 里注册能力，消费方按名字取用。
 * 于是依赖方向恒为「模块 → kernel」，模块之间零 import，环不可能出现。
 *
 * 刻意保持极简（一个 Map + 两个函数）：
 *  - 只存**函数**，不存对象 / 状态 —— 状态该放 kernel 的专门模块（如 operations）；
 *  - 取用时若未注册就抛错（装配顺序错误必须立刻暴露，而不是静默 no-op）。
 */

type ServiceFn = (...args: never[]) => unknown

const services = new Map<string, ServiceFn>()

/**
 * 注册一个服务。同名重复注册直接抛错 —— 两个模块抢同一个名字是装配错误。
 * 一般在提供方模块的 `onReady` 里调用（此时 Electron 已就绪，能力已可用）。
 */
export function provideService<K extends string>(name: K, fn: ServiceFn): void {
    if (services.has(name)) throw new Error(`服务重复注册：${name}`)
    services.set(name, fn)
}

/** 取一个已注册的服务；未注册则抛错（提示检查装配顺序 / 模块是否登记）。 */
export function useService<K extends string>(name: K): ServiceFn {
    const fn = services.get(name)
    if (!fn) throw new Error(`服务尚未注册：${name}（检查提供它的模块是否已加入 modules/index.ts）`)
    return fn
}

/** 服务是否已注册（用于可选能力的判断）。 */
export function hasService(name: string): boolean {
    return services.has(name)
}

/**
 * 本项目已注册的服务名清单（新增时在这里登记，避免各处散落字符串）。
 *
 * 之所以集中列出：服务名是模块之间的**隐式契约**，散落在各处会变成「拼错名字编译期不报错、
 * 运行期才炸」的陷阱。集中一处至少便于审查有哪些跨模块动作。
 */
export const SERVICE = {
    /** 重启 dsh 子进程（提供方：dsh 模块）。 */
    RESTART_DSH: 'restart-dsh'
} as const
