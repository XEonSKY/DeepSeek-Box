import { describe, expect, it } from 'vitest'
import { decideBootGuard } from '@main/app/bootguard'

/**
 * 守卫判定是「回退是否会失控」的总闸门：这里钉住五条结论，
 * 尤其是「每轮待安装记录至多回退一次」——线上那次无限重启就是缺了这条。
 */

const MAX = 3
const decide = (running: string, pending: { to: string; attempts: number; rollbacks?: number } | null) =>
    decideBootGuard({ running, pending, maxAttempts: MAX })

describe('启动守卫判定', () => {
    it('没有待安装记录 → 什么都不做', () => {
        expect(decide('0.1.6-alpha.4', null)).toEqual({ kind: 'idle' })
    })

    it('记录与当前版本不符（安装没发生 / 回退已生效）→ 清掉记录', () => {
        expect(decide('0.1.6-alpha.4', { to: '0.1.6-beta.1', attempts: 2 })).toEqual({ kind: 'clear' })
    })

    it('未超阈值 → 记一次启动', () => {
        expect(decide('0.1.6-beta.1', { to: '0.1.6-beta.1', attempts: 0 })).toEqual({ kind: 'count', attempts: 1 })
        expect(decide('0.1.6-beta.1', { to: '0.1.6-beta.1', attempts: 2 })).toEqual({ kind: 'count', attempts: 3 })
    })

    it('超过阈值 → 回退', () => {
        expect(decide('0.1.6-beta.1', { to: '0.1.6-beta.1', attempts: 3 })).toEqual({ kind: 'rollback', attempts: 4 })
    })

    it('已经回退过一次仍是同一版本 → 放弃，绝不再回退（防无限重启）', () => {
        expect(decide('0.1.6-beta.1', { to: '0.1.6-beta.1', attempts: 4, rollbacks: 1 })).toEqual({
            kind: 'giveup',
            reason: 'alreadyRolledBack'
        })
        // 次数已经涨到很大时同样是放弃，且优先级高于 rollback
        expect(decide('0.1.6-beta.1', { to: '0.1.6-beta.1', attempts: 16, rollbacks: 2 })).toEqual({
            kind: 'giveup',
            reason: 'alreadyRolledBack'
        })
    })
})
