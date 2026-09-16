import { describe, expect, it } from 'vitest'
import { REGISTRY_IDS, bestOfRounds, pickFastestRegistry, rankRegistries, registryBase, summarizeRounds } from '@main/dsh/registry'
import type { RegistrySpeedSample } from '@shared/types'

/**
 * 「简易安装」会自动挑最快的 registry，挑错的代价是用户整个安装过程慢一个数量级。
 * 这里守两件事：URL 基址没写反，以及**失败样本不会被误判成最快**。
 */

/** 只关心代表值 ms 的样本；多轮明细对本组用例无关，给一个自洽的填充值。 */
const s = (registry: RegistrySpeedSample['registry'], ms: number | null): RegistrySpeedSample => ({
    registry,
    ms,
    rounds: ms === null ? [null] : [ms],
    okRounds: ms === null ? 0 : 1,
    totalRounds: 1
})

describe('registryBase', () => {
    it('两个源各自的基址正确且不互换', () => {
        expect(registryBase('npmjs')).toBe('https://registry.npmjs.org')
        expect(registryBase('npmmirror')).toBe('https://registry.npmmirror.com')
    })

    it('候选列表覆盖全部 NpmRegistry 取值', () => {
        expect([...REGISTRY_IDS].sort()).toEqual(['npmjs', 'npmmirror'])
    })
})

describe('bestOfRounds', () => {
    it('取最小值而不是平均值：单次抖动不该决定排名', () => {
        // 平均值 160 会输给一个稳定 100 的源，但最小轮 80 才是它稳定能给到的速度
        expect(bestOfRounds([80, 100, 300])).toBe(80)
    })

    it('忽略失败的轮', () => {
        expect(bestOfRounds([null, 120, null])).toBe(120)
    })

    it('全部失败返回 null', () => {
        expect(bestOfRounds([null, null])).toBe(null)
    })

    it('空数组返回 null（不抛错）', () => {
        expect(bestOfRounds([])).toBe(null)
    })

    it('0ms 是合法耗时，不会被当成缺失', () => {
        expect(bestOfRounds([0, 50])).toBe(0)
    })

    it('负数 / NaN / Infinity 视为失败轮', () => {
        expect(bestOfRounds([-5, 30])).toBe(30)
        expect(bestOfRounds([NaN, Infinity])).toBe(null)
    })
})

describe('summarizeRounds', () => {
    it('同时给出代表值与轮数统计', () => {
        const s = summarizeRounds('npmjs', [120, null, 90])
        expect(s.registry).toBe('npmjs')
        expect(s.ms).toBe(90)
        expect(s.okRounds).toBe(2)
        expect(s.totalRounds).toBe(3)
    })

    it('保留逐轮明细且不改动入参', () => {
        const rounds = [120, null, 90]
        expect(summarizeRounds('npmjs', rounds).rounds).toEqual([120, null, 90])
        expect(rounds).toEqual([120, null, 90])
    })

    it('全部失败时 ms 为 null 但轮数仍如实记录', () => {
        const s = summarizeRounds('npmmirror', [null, null])
        expect(s.ms).toBe(null)
        expect(s.okRounds).toBe(0)
        expect(s.totalRounds).toBe(2)
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
