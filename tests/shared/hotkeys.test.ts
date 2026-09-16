import { describe, expect, it } from 'vitest'
import { buildAccelerator, matchesAccelerator, prettyAccelerator } from '@shared/hotkeys'
import type { HotkeyEvent } from '@shared/hotkeys'

/**
 * hotkeys.ts 的解析规则必须两端一致：渲染层录制出的字符串，主进程要能匹配上。
 * 这里覆盖的是「写错不会报错、只是永远匹配不上」的那类失效。
 */

function ev(partial: Partial<HotkeyEvent> & { key: string }): HotkeyEvent {
    return { control: false, meta: false, alt: false, shift: false, ...partial }
}

describe('buildAccelerator', () => {
    it('Windows/Linux：Ctrl + 字母 → CommandOrControl（跨平台写法）', () => {
        expect(buildAccelerator(ev({ key: 't', control: true }), false)).toBe('CommandOrControl+T')
    })

    it('macOS：Cmd + 字母 → CommandOrControl', () => {
        expect(buildAccelerator(ev({ key: 't', meta: true }), true)).toBe('CommandOrControl+T')
    })

    it('macOS 上按住 Ctrl（而非 Cmd）时单独记成 Control，不猜用户意图', () => {
        expect(buildAccelerator(ev({ key: 't', control: true }), true)).toBe('Control+T')
    })

    it('非 mac 上按 Win/Cmd 键记成 Super', () => {
        expect(buildAccelerator(ev({ key: 't', meta: true }), false)).toBe('Super+T')
    })

    it('修饰键顺序固定：CommandOrControl → Control → Super → Alt → Shift → 主键', () => {
        expect(buildAccelerator(ev({ key: 'j', control: true, alt: true, shift: true }), false)).toBe('CommandOrControl+Alt+Shift+J')
    })

    it('主键统一大写；数字原样保留', () => {
        expect(buildAccelerator(ev({ key: 'j', control: true }), false)).toBe('CommandOrControl+J')
        expect(buildAccelerator(ev({ key: '3', control: true }), false)).toBe('CommandOrControl+3')
    })

    it('功能键 F1–F24 支持，F25 与 F0 不支持', () => {
        expect(buildAccelerator(ev({ key: 'f12', control: true }), false)).toBe('CommandOrControl+F12')
        expect(buildAccelerator(ev({ key: 'F24', control: true }), false)).toBe('CommandOrControl+F24')
        expect(buildAccelerator(ev({ key: 'F25', control: true }), false)).toBe(null)
        expect(buildAccelerator(ev({ key: 'F0', control: true }), false)).toBe(null)
    })

    it('没有任何修饰键 → null（裸字母会把打字全吃掉）', () => {
        expect(buildAccelerator(ev({ key: 't' }), false)).toBe(null)
        expect(buildAccelerator(ev({ key: '5' }), false)).toBe(null)
    })

    it('Shift 单独作为修饰键是合法的（Shift+T 是常用组合）', () => {
        expect(buildAccelerator(ev({ key: 't', shift: true }), false)).toBe('Shift+T')
    })

    it('只按修饰键本身 → null', () => {
        for (const k of ['Control', 'Shift', 'Alt', 'Meta', 'OS']) {
            expect(buildAccelerator(ev({ key: k }), false)).toBe(null)
        }
    })

    it('不受支持的主键 → null（宁可拒绝录制，也别存下永远匹配不上的组合）', () => {
        for (const k of ['Escape', 'ArrowUp', 'Space', 'F13x', 'ab', '']) {
            expect(buildAccelerator(ev({ key: k, control: true }), false)).toBe(null)
        }
    })
})

describe('matchesAccelerator', () => {
    it('CommandOrControl 在非 mac 上要求 Ctrl、在 mac 上要求 Cmd', () => {
        const ctrlT = ev({ key: 't', control: true })
        const cmdT = ev({ key: 't', meta: true })
        expect(matchesAccelerator('CommandOrControl+T', ctrlT, false)).toBe(true)
        expect(matchesAccelerator('CommandOrControl+T', cmdT, false)).toBe(false)
        expect(matchesAccelerator('CommandOrControl+T', cmdT, true)).toBe(true)
        expect(matchesAccelerator('CommandOrControl+T', ctrlT, true)).toBe(false)
    })

    it('修饰键必须完全一致：Ctrl+Shift+T 不能被 Ctrl+T 抢走', () => {
        expect(matchesAccelerator('CommandOrControl+T', ev({ key: 't', control: true, shift: true }), false)).toBe(false)
        expect(matchesAccelerator('CommandOrControl+Shift+T', ev({ key: 't', control: true, shift: true }), false)).toBe(true)
    })

    it('多按一个修饰键也算不匹配（不能「包含即命中」）', () => {
        expect(matchesAccelerator('CommandOrControl+T', ev({ key: 't', control: true, alt: true }), false)).toBe(false)
    })

    it('主键大小写不敏感', () => {
        expect(matchesAccelerator('CommandOrControl+T', ev({ key: 'T', control: true }), false)).toBe(true)
    })

    it('支持别名：ctrl / cmd / option / super', () => {
        expect(matchesAccelerator('ctrl+t', ev({ key: 't', control: true }), false)).toBe(true)
        expect(matchesAccelerator('CommandOrControl+option+t', ev({ key: 't', control: true, alt: true }), false)).toBe(true)
        expect(matchesAccelerator('super+t', ev({ key: 't', meta: true }), false)).toBe(true)
    })

    it('无法识别的修饰键 → 整体判为无效，不匹配任何按键', () => {
        expect(matchesAccelerator('Hyper+T', ev({ key: 't', control: true }), false)).toBe(false)
    })

    it('空串 / 只有修饰键 / 主键非法 → false', () => {
        expect(matchesAccelerator('', ev({ key: 't', control: true }), false)).toBe(false)
        expect(matchesAccelerator('CommandOrControl', ev({ key: 't', control: true }), false)).toBe(false)
        expect(matchesAccelerator('CommandOrControl+Escape', ev({ key: 'Escape', control: true }), false)).toBe(false)
    })

    it('buildAccelerator 产出的一定能被 matchesAccelerator 命中（录制↔匹配闭环）', () => {
        const combos: Array<[HotkeyEvent, boolean]> = [
            [ev({ key: 'r', control: true, shift: true }), false],
            [ev({ key: 'd', meta: true, alt: true }), true],
            [ev({ key: 'F5', control: true }), false]
        ]
        for (const [e, isMac] of combos) {
            const accel = buildAccelerator(e, isMac)
            expect(accel).not.toBe(null)
            expect(matchesAccelerator(accel as string, e, isMac)).toBe(true)
        }
    })
})

describe('prettyAccelerator', () => {
    it('按平台把 CommandOrControl 显示成 Cmd / Ctrl', () => {
        expect(prettyAccelerator('CommandOrControl+T', false)).toBe('Ctrl + T')
        expect(prettyAccelerator('CommandOrControl+T', true)).toBe('Cmd + T')
    })

    it('Alt 在 mac 上显示为 Option', () => {
        expect(prettyAccelerator('CommandOrControl+Alt+T', true)).toBe('Cmd + Option + T')
        expect(prettyAccelerator('CommandOrControl+Alt+T', false)).toBe('Ctrl + Alt + T')
    })

    it('空串返回空串', () => {
        expect(prettyAccelerator('', false)).toBe('')
        expect(prettyAccelerator('   ', false)).toBe('')
    })
})
