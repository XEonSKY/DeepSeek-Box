import { describe, expect, it, beforeEach } from 'vitest'
import { provideService, useService, hasService, resetServices, SERVICE } from '@main/kernel/services'

/**
 * 服务槽 —— 微内核用来打断「模块间静态依赖环」的机制。
 *
 * 模块 A 需要模块 B 的动作时不在源码里 import B（那会形成环），而是：
 *   B 在 onReady 里 provideService(名字, 函数)，A 在请求时 useService(名字) 取用。
 * 这里测三条硬约束：重复注册要抛、未注册要抛、reset 要清干净。
 */

beforeEach(() => {
    resetServices()
})

describe('kernel 服务槽', () => {
    it('注册后能取回同一个函数', () => {
        const fn = (): string => 'restarted'
        provideService(SERVICE.RESTART_DSH, fn)
        expect(useService(SERVICE.RESTART_DSH)).toBe(fn)
        expect(hasService(SERVICE.RESTART_DSH)).toBe(true)
    })

    it('重复注册同名服务 → 抛错（避免悄悄覆盖）', () => {
        provideService(SERVICE.RESTART_DSH, () => undefined)
        expect(() => provideService(SERVICE.RESTART_DSH, () => undefined)).toThrow(/重复注册/)
    })

    it('未注册就取用 → 抛错（暴露装配顺序错误）', () => {
        expect(hasService(SERVICE.RESTART_DSH)).toBe(false)
        expect(() => useService(SERVICE.RESTART_DSH)).toThrow(/尚未注册/)
    })

    it('resetServices 清空已注册项', () => {
        provideService(SERVICE.RESTART_DSH, () => undefined)
        resetServices()
        expect(hasService(SERVICE.RESTART_DSH)).toBe(false)
    })
})
