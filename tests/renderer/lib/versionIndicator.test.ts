import { describe, expect, it } from 'vitest'
import { indicatorState } from '@/lib/versionIndicator'
import type { VersionLineState } from '@/lib/versionIndicator'

/**
 * 状态栏版本项的指示文本：程序 / dsh 两条线归并成**唯一一句话**。
 *
 * 这里守两件容易出错的事：
 *  1. 只有一边还在查时不要显示「检查中」—— 否则程序先回来、dsh 还在查的那一瞬间，
 *     文字会从上次结论闪成「检测中」再闪回去；
 *  2. 都还没查过（idle）时返回 null 让状态栏留白，而不是硬报「已是最新」。
 */

/** 造一条只关心 state 的版本线。 */
function line(state: VersionLineState) {
    return { state }
}

describe('indicatorState', () => {
    it('两边都还没结论时返回 null（状态栏留白）', () => {
        expect(indicatorState(line('idle'), line('idle'))).toBeNull()
    })

    it('只有一边在查：沿用已有结论，不显示「检查中」', () => {
        expect(indicatorState(line('latest'), line('checking'))).toBe('latest')
        expect(indicatorState(line('checking'), line('available'))).toBe('available')
        // 一边在查、另一边还没结论：仍无话可说。
        expect(indicatorState(line('checking'), line('idle'))).toBeNull()
    })

    it('两边都在查才算「检查中」', () => {
        expect(indicatorState(line('checking'), line('checking'))).toBe('checking')
    })

    it('正在安装压过一切', () => {
        expect(indicatorState(line('downloaded'), line('downloaded'), true)).toBe('installing')
        expect(indicatorState(line('checking'), line('checking'), true)).toBe('installing')
        expect(indicatorState(line('idle'), line('idle'), true)).toBe('installing')
    })

    it('等待重启压过「有新版本」：程序下好了，dsh 就算有新版也先让用户重启', () => {
        expect(indicatorState(line('downloaded'), line('available'))).toBe('downloaded')
        expect(indicatorState(line('available'), line('downloaded'))).toBe('downloaded')
    })

    it('任一有新版本就是「检测到新版本」', () => {
        expect(indicatorState(line('available'), line('latest'))).toBe('available')
        expect(indicatorState(line('latest'), line('available'))).toBe('available')
    })

    it('一边已是最新、另一边失败：仍报「已是最新」', () => {
        // 已经拿到一个明确结论，不该被另一条线的失败改写。
        expect(indicatorState(line('latest'), line('error'))).toBe('latest')
        expect(indicatorState(line('error'), line('latest'))).toBe('latest')
    })

    it('只有一边失败、另一边还没结论：失败也是有效结论', () => {
        expect(indicatorState(line('error'), line('idle'))).toBe('error')
        expect(indicatorState(line('checking'), line('error'))).toBe('error')
    })

    it('都没更新就是「已是最新」', () => {
        expect(indicatorState(line('latest'), line('latest'))).toBe('latest')
    })
})
