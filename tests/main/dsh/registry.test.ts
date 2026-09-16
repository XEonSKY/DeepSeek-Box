import { describe, expect, it } from 'vitest'
import { REGISTRY_IDS, pickFastestRegistry, rankRegistries, registryBase } from '@main/dsh/registry'
import type { RegistrySpeedSample } from '@shared/types'

/**
 * 「简易安装」会自动挑最快的 registry，挑错的代价是用户整个安装过程慢一个数量级。
 * 这里守两件事：URL 基址没写反，以及**失败样本不会被误判成最快**。
 */

const s = (registry: RegistrySpeedSample['registry'], ms: number | null): RegistrySpeedSample => ({ registry, ms })

describe('registryBase', () => {
    it('两个源各自的基址正确且不互换', () => {
        expect(registryBase('npmjs')).toBe('https://registry.npmjs.org')
        expect(registryBase('npmmirror')).toBe('https://registry.npmmirror.com')
    })

    it('候选列表覆盖全部 NpmRegistry 取值', () => {
        expect([...REGISTRY_IDS].sort()).toEqual(['npmjs', 'npmmirror'])
    })
})

describe('rankRegistries', () => {
    it('可用的按延迟升序排在前面', () => {
        expect(rankRegistries([s('npmjs', 300), s('npmmirror', 80)]).map((x) => x.registry)).toEqual(['npmmirror', 'npmjs'])
    })

    it('失败的样本排在可用样本之后', () => {
        const r = rankRegistries([s('npmjs', null), s('npmmirror', 500)])
        expect(r.map((x) => x.registry)).toEqual(['npmmirror', 'npmjs'])
    })

    it('两个都失败时顺序稳定（不抛错）', () => {
        expect(rankRegistries([s('npmjs', null), s('npmmirror', null)])).toHaveLength(2)
    })

    it('不修改入参数组', () => {
        const input = [s('npmjs', 300), s('npmmirror', 80)]
        rankRegistries(input)
        expect(input.map((x) => x.registry)).toEqual(['npmjs', 'npmmirror'])
    })
})

describe('pickFastestRegistry', () => {
    it('取延迟最小的那个', () => {
        expect(pickFastestRegistry([s('npmjs', 120), s('npmmirror', 40)])).toBe('npmmirror')
        expect(pickFastestRegistry([s('npmjs', 40), s('npmmirror', 120)])).toBe('npmjs')
    })

    it('只有一个可用时选它，哪怕另一个是失败', () => {
        expect(pickFastestRegistry([s('npmjs', null), s('npmmirror', 900)])).toBe('npmmirror')
    })

    it('全部失败返回 null（调用方保留用户当前设置，而不是乱选一个）', () => {
        expect(pickFastestRegistry([s('npmjs', null), s('npmmirror', null)])).toBe(null)
        expect(pickFastestRegistry([])).toBe(null)
    })

    it('ms = 0 是合法耗时，不会被当成缺失值', () => {
        expect(pickFastestRegistry([s('npmjs', 5), s('npmmirror', 0)])).toBe('npmmirror')
    })

    it('负数 / NaN / Infinity 视为不可用', () => {
        expect(pickFastestRegistry([s('npmjs', -1), s('npmmirror', 50)])).toBe('npmmirror')
        expect(pickFastestRegistry([s('npmjs', NaN), s('npmmirror', Infinity)])).toBe(null)
    })
})
