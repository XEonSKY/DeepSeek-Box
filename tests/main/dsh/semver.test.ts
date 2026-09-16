import { describe, expect, it } from 'vitest'
import { compareVersions, filterByPrerelease, pickLatest, sortVersionsDesc } from '@main/dsh/semver'

/**
 * dsh / Node / npm 的「有没有新版本」判断全部经过这里。
 * 判错一个版本号的后果是：要么提示用户升级到更旧的版本，要么永远不提示升级。
 */

describe('compareVersions', () => {
    it('主版本优先', () => {
        expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
        expect(compareVersions('1.9.9', '2.0.0')).toBeLessThan(0)
    })

    it('次版本 / 修订号依次比较', () => {
        expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
        expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
    })

    it('相同版本返回 0', () => {
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    })

    it('预发布版小于同号正式版', () => {
        expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
        expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    })

    it('预发布序号按数字比较，不是字符串比较', () => {
        expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBeGreaterThan(0)
    })

    it('非法版本号按原语义返回 0（不抛异常）', () => {
        expect(compareVersions('latest', '1.0.0')).toBe(0)
        expect(compareVersions('1.0.0', '')).toBe(0)
        expect(compareVersions('abc', 'def')).toBe(0)
    })
})

describe('pickLatest', () => {
    it('取最大版本', () => {
        expect(pickLatest(['1.0.0', '2.0.0', '1.5.0'])).toBe('2.0.0')
    })

    it('忽略非法项', () => {
        expect(pickLatest(['1.0.0', 'latest', '2.0.0', ''])).toBe('2.0.0')
    })

    it('空列表或全是非法项 → null', () => {
        expect(pickLatest([])).toBe(null)
        expect(pickLatest(['x', 'y'])).toBe(null)
    })

    it('预发布版与正式版一起排时，正式版更大', () => {
        expect(pickLatest(['1.0.0-beta.1', '1.0.0'])).toBe('1.0.0')
    })
})

describe('filterByPrerelease', () => {
    const versions = ['1.0.0', '2.0.0-beta.1', '1.5.0']

    it('要求含预发布时原样返回', () => {
        expect(filterByPrerelease(versions, true)).toEqual(versions)
    })

    it('不要预发布时剔除预发布项', () => {
        expect(filterByPrerelease(versions, false)).toEqual(['1.0.0', '1.5.0'])
    })

    it('全部是预发布时回退全量 —— 有得选好过空下拉框', () => {
        expect(filterByPrerelease(['2.0.0-beta.1'], false)).toEqual(['2.0.0-beta.1'])
    })
})

describe('sortVersionsDesc', () => {
    it('降序排列', () => {
        expect(sortVersionsDesc(['1.0.0', '3.0.0', '2.0.0'], true)).toEqual(['3.0.0', '2.0.0', '1.0.0'])
    })

    it('默认剔除预发布', () => {
        expect(sortVersionsDesc(['1.0.0', '2.0.0-beta.1', '1.5.0'], false)).toEqual(['1.5.0', '1.0.0'])
    })

    it('剔除非法版本号', () => {
        expect(sortVersionsDesc(['1.0.0', 'latest', '2.0.0'], true)).toEqual(['2.0.0', '1.0.0'])
    })

    it('预发布排在同号正式版之前（降序）', () => {
        expect(sortVersionsDesc(['1.0.0', '1.0.0-rc.1'], true)).toEqual(['1.0.0', '1.0.0-rc.1'])
    })

    it('不修改入参数组', () => {
        const input = ['1.0.0', '2.0.0']
        sortVersionsDesc(input, true)
        expect(input).toEqual(['1.0.0', '2.0.0'])
    })
})
