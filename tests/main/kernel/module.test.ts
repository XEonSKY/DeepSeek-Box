import { describe, expect, it, beforeEach } from 'vitest'
import { defineModule, ModuleRegistry } from '@main/kernel/module'
import { Router } from '@main/kernel/router'

/**
 * 模块契约与注册表 —— 微内核的装配半边。
 *
 * 这里不测端点行为（那要跑 Electron 运行时），只测**装配期**的两条硬约束：
 *  1. 全部模块的路由能被统一挂上，且按方法 / 路径正确分发；
 *  2. 跨模块端点重名会在装配期抛错 —— 否则两个模块抢同一条路径会「后挂载的悄悄覆盖前一个」，
 *     表现成「某个功能偶尔失灵」，极难排查。
 */

/** 造一个只有一条 GET 端点的模块（路径必须是 ApiRoutes 里真实存在的 —— 类型会拦住编造的路径）。 */
function modWith(id: string, path: '/settings' | '/logs' | '/operations', value: unknown) {
    return defineModule({
        id,
        routes: { GET: { [path]: () => value } as never }
    })
}

beforeEach(() => {
    // 每个用例独立，无需清理全局（Router / Registry 都是新建的）
})

describe('ModuleRegistry 装配', () => {
    it('按方法 + 路径分发到对应模块的处理器', async () => {
        const router = new Router()
        const registry = new ModuleRegistry([
            defineModule({ id: 'a', routes: { GET: { '/operations': () => [] } } }),
            defineModule({ id: 'b', routes: { GET: { '/logs': () => [] } } })
        ])
        registry.mountRoutes(router)

        // 直接调 handle：传入伪造的 IpcMainInvokeEvent（处理器不碰 event）
        const ev = {} as never
        await expect(router.handle(ev, { method: 'GET', path: '/operations' })).resolves.toEqual([])
        await expect(router.handle(ev, { method: 'GET', path: '/logs' })).resolves.toEqual([])
        // 未登记的路径应抛「未知路由」
        await expect(router.handle(ev, { method: 'GET', path: '/nonexistent' })).rejects.toThrow(/未知的 IPC 路由/)
    })

    it('跨模块端点重名 → 装配期抛错', () => {
        const router = new Router()
        const registry = new ModuleRegistry([modWith('x', '/settings', {}), modWith('y', '/settings', {})])
        expect(() => registry.mountRoutes(router)).toThrow(/重复的 IPC 端点/)
    })

    it('同模块内同一路径只挂一次（不报重名）', () => {
        const router = new Router()
        const registry = new ModuleRegistry([modWith('x', '/settings', {})])
        expect(() => registry.mountRoutes(router)).not.toThrow()
    })

    it('onReady 按登记顺序调用，onQuit 逆序', async () => {
        const order: string[] = []
        const registry = new ModuleRegistry([
            defineModule({ id: '1', routes: {}, onReady: () => void order.push('r1'), onQuit: () => void order.push('q1') }),
            defineModule({ id: '2', routes: {}, onReady: () => void order.push('r2'), onQuit: () => void order.push('q2') })
        ])
        await registry.runReady()
        await registry.runQuit()
        expect(order).toEqual(['r1', 'r2', 'q2', 'q1'])
    })

    it('onReady / onQuit 可省略', async () => {
        const registry = new ModuleRegistry([defineModule({ id: 'bare', routes: {} })])
        await expect(registry.runReady()).resolves.toBeUndefined()
        await expect(registry.runQuit()).resolves.toBeUndefined()
    })

    it('list() 返回全部已登记模块', () => {
        const registry = new ModuleRegistry([modWith('a', '/settings', {}), modWith('b', '/logs', [])])
        expect(registry.list().map((m) => m.id)).toEqual(['a', 'b'])
    })
})
