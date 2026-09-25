import type { HttpMethod, PathOf, ResultOfRoute, RouteKey } from '@shared/api'
import type { RouteContext, Router } from './router'

/**
 * 微内核的**模块契约**。
 *
 * 核心只提供机制（路由分发、广播、生命周期），具体功能一律由模块提供策略。
 * 一个模块 = 一个 `defineModule()` 调用，自己声明：
 *
 *   - `id`：模块名（用于日志与重名检查）；
 *   - `routes`：该功能自己的端点，写法与直接链式调 Router 一致，但**类型由 ApiRoutes 校验**
 *     （写错路径 / 返回值在编译期就报错，和以前一样）；
 *   - `onReady` / `onQuit`：可选的生命周期钩子，由装配器在对应时机调用。
 *
 * 关键约束：**模块之间互不 import**。需要共享的东西放 kernel（见 `runtime.ts` /
 * `operations.ts` / `treeops.ts`），或由调用方从模块数组里取（见 `modules/index.ts` 的
 * `allModules()`）。这样任何一个模块都能被单独删掉，而核心不受影响。
 */

/** 挂载端点的固定顺序（也用于日志 / 重名检查的可预测顺序）。 */
const MOUNT_ORDER: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** 模块可声明的生命周期钩子。 */
export interface ModuleHooks {
    /**
     * `app.whenReady()` 之后、建窗之前调用（IPC 已挂载）。
     * 用于需要 Electron 就绪态才能做的初始化。可以是 async。
     */
    onReady?: () => void | Promise<void>
    /** 真正退出时调用（`before-quit` 走完清理后）。用于停 watcher、清资源。 */
    onQuit?: () => void | Promise<void>
}

/**
 * 一个主进程功能模块。
 *
 * `routes` 是必填项（哪怕为空对象）：模块的存在意义就是提供端点。写法：
 *
 * ```ts
 * export default defineModule({
 *     id: 'settings',
 *     routes: {
 *         GET: { '/settings': () => loadSettings() },
 *         PUT: { '/settings': ({ body }) => persistSettings(body) }
 *     }
 * })
 * ```
 *
 * 键是 HTTP 方法，值是「路径 → 处理函数」的表。这样比链式 `.get().put()` 更适合
 * 按方法分组、也让每个模块的端点一眼可数。
 */
export interface MainModule extends ModuleHooks {
    readonly id: string
    readonly routes: ModuleRoutes
}

/**
 * 模块端点表：按方法分组，值为「路径 → 处理函数」。
 *
 * 每一组都用 `ApiRoutes` 里对应方法的路由键做**强类型约束** —— 写错路径、传错 body、
 * 返回值类型对不上，都会在模块自己的文件里编译期报错（与旧版链式写法同样的保障）。
 *
 * 之所以逐方法展开、而不是写 `{ [M in HttpMethod]: {...} }`：后者在 `MainModule` 的
 * 具体实现位置上无法把 `M` 收窄成单一字面量，`RouteAt<M, P>` 会退化成一个过宽的联合，
 * 类型检查直接失败。展开写既避开了这个坑，也让「每个模块声明了哪些端点」一眼可数。
 */
export interface ModuleRoutes {
    GET?: MethodRouteTable<'GET'>
    POST?: MethodRouteTable<'POST'>
    PUT?: MethodRouteTable<'PUT'>
    PATCH?: MethodRouteTable<'PATCH'>
    DELETE?: MethodRouteTable<'DELETE'>
}

/** 某个方法下的端点表：路径 → 处理函数（类型从 ApiRoutes 推导）。 */
type MethodRouteTable<M extends HttpMethod> = {
    [K in RouteKeysOfMethod<M> as PathOf<K>]?: RouteHandlerFor<K>
}

/** 某方法下的全部路由键（从 ApiRoutes 直接取，不经过 RoutesByPath 的多层索引）。 */
type RouteKeysOfMethod<M extends HttpMethod> = Extract<RouteKey, `${M} ${string}`>

/** 某路由键的处理函数签名。 */
type RouteHandlerFor<K extends RouteKey> = (context: RouteContext<K>) => ResultOfRoute<K> | Promise<ResultOfRoute<K>>

/** 定义模块（只做类型收窄，返回原对象）。 */
export function defineModule(mod: MainModule): MainModule {
    return mod
}

/**
 * 模块注册表：装配期收集全部模块，负责统一挂载路由与调用生命周期钩子。
 *
 * 刻意不 import 任何具体模块 —— 模块由调用方（`modules/index.ts`）传进来，
 * 核心因此保持「不认识任何功能」。
 */
export class ModuleRegistry {
    private readonly mods: MainModule[] = []
    /** 已挂载的 `"<METHOD> <path>"`，用于跨模块重名检查。 */
    private readonly mounted = new Set<string>()

    constructor(mods: readonly MainModule[]) {
        this.mods = [...mods]
    }

    /** 已登记的模块（只读副本）。 */
    list(): MainModule[] {
        return [...this.mods]
    }

    /**
     * 把全部模块的路由挂到 router 上。
     *
     * 跨模块路径重名直接抛错 —— 两个模块抢同一个端点属于装配错误，必须在启动期暴露，
     * 而不是让后挂载的悄悄覆盖前一个（那会表现成「某个功能偶尔失灵」）。
     */
    mountRoutes(router: Router): void {
        for (const mod of this.mods) {
            for (const method of MOUNT_ORDER) {
                const table = mod.routes[method] as Record<string, (context: never) => unknown> | undefined
                if (!table) continue
                for (const path of Object.keys(table)) {
                    this.claim(mod.id, method, path)
                    router.add(method, path, table[path])
                }
            }
        }
    }

    /** 依次调用各模块的 onReady（按登记顺序；前一个完成再进下一个，避免抢资源）。 */
    async runReady(): Promise<void> {
        for (const mod of this.mods) await mod.onReady?.()
    }

    /** 依次调用各模块的 onQuit（逆序：后建立的先拆，与初始化对称）。 */
    async runQuit(): Promise<void> {
        for (let i = this.mods.length - 1; i >= 0; i--) await this.mods[i].onQuit?.()
    }

    private claim(moduleId: string, method: HttpMethod, path: string): void {
        const key = `${method} ${path}`
        if (this.mounted.has(key)) throw new Error(`重复的 IPC 端点：${key}（模块 ${moduleId}）`)
        this.mounted.add(key)
    }
}
