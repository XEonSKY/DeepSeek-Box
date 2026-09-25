import { describe, expect, it, beforeEach } from 'vitest'
import {
    MIN_INTERVAL_MS,
    beginOperation,
    currentProgress,
    endOperation,
    isOperationRunning,
    operationsSnapshot,
    pushProgress,
    resetOperations
} from '@main/kernel/operations'

/**
 * 「进行中的操作」注册表 —— 解决两个真实问题：
 *
 *  1. 进度此前只活在面板组件的 ref 里，切页卸载即丢（切回来只剩空进度条）；
 *     注册表让**主进程**记住状态，任何页面都能靠快照重新取回。
 *  2. npm 与 pnpm 共用一个广播通道会串台，所以每条进度都带 kind。
 *
 * 另外这里做节流：下载是每个数据块回调一次，全部转发会给渲染层灌几千条 IPC。
 */

beforeEach(() => {
    resetOperations()
})

/** 造一条进度（默认下载阶段）。 */
function p(over: Partial<{ phase: 'download' | 'extract'; percent: number }> = {}): {
    phase: 'download' | 'extract'
    percent: number
    downloaded: number
    total: number
    speed: number
} {
    return { phase: 'download', percent: 0, downloaded: 0, total: 0, speed: 0, ...over }
}

describe('beginOperation / endOperation', () => {
    it('开始后进入快照，结束后立刻消失', () => {
        beginOperation('npm', 1000)
        expect(isOperationRunning('npm')).toBe(true)
        expect(operationsSnapshot()).toHaveLength(1)

        expect(endOperation('npm')).toBe(true)
        expect(isOperationRunning('npm')).toBe(false)
        // 结束必须从快照里摘掉：否则切页回来会看到一条「永远在跑」的假进度
        expect(operationsSnapshot()).toHaveLength(0)
    })

    it('重复结束返回 false（不报错）', () => {
        beginOperation('node')
        expect(endOperation('node')).toBe(true)
        expect(endOperation('node')).toBe(false)
    })

    it('同 kind 再次 begin 覆盖旧记录（上一次 finally 没走到时的兜底）', () => {
        beginOperation('npm', 1000)
        pushProgress('npm', p({ percent: 50 }), 2000)
        const fresh = beginOperation('npm', 5000)
        expect(fresh.percent).toBe(0)
        expect(fresh.startedAt).toBe(5000)
        expect(operationsSnapshot()).toHaveLength(1)
    })

    it('不同 kind 互不干扰（这是「不串台」的核心）', () => {
        beginOperation('npm')
        beginOperation('pnpm')
        expect(operationsSnapshot()).toHaveLength(2)
        endOperation('npm')
        // 结束 npm 不能带走 pnpm
        expect(isOperationRunning('pnpm')).toBe(true)
        expect(operationsSnapshot()).toHaveLength(1)
    })

    it('快照按 startedAt 升序（先开始的在前）', () => {
        beginOperation('pnpm', 3000)
        beginOperation('npm', 1000)
        beginOperation('node', 2000)
        expect(operationsSnapshot().map((o) => o.kind)).toEqual(['npm', 'node', 'pnpm'])
    })
})

describe('currentProgress', () => {
    it('未登记时返回 null', () => {
        expect(currentProgress('npm')).toBe(null)
    })

    it('携带 kind 与原 startedAt（推进度不重置开始时间）', () => {
        beginOperation('npm', 111)
        pushProgress('npm', p({ percent: 30 }), 222)
        const cur = currentProgress('npm')
        expect(cur?.kind).toBe('npm')
        expect(cur?.startedAt).toBe(111)
        expect(cur?.percent).toBe(30)
    })
})

describe('pushProgress 节流', () => {
    it('没登记过的进度一律丢弃（避免半路残留点亮进度条）', () => {
        expect(pushProgress('npm', p({ percent: 50 }))).toBe(false)
    })

    it('首次进度一定放行', () => {
        beginOperation('node', 0)
        expect(pushProgress('node', p({ percent: 1 }), 0)).toBe(true)
    })

    it('节流窗口内、同阶段、进度值也没变的重复进度被丢弃', () => {
        beginOperation('node', 0)
        expect(pushProgress('node', p({ percent: 10 }), 0)).toBe(true)
        // 10ms 后、同样的值：窗口没到 + 值没变 → 丢弃
        expect(pushProgress('node', p({ percent: 10 }), 10)).toBe(false)
    })

    it('节流窗口内但进度值前进 → 仍被丢弃（窗口优先）', () => {
        beginOperation('node', 0)
        pushProgress('node', p({ percent: 10 }), 0)
        expect(pushProgress('node', p({ percent: 20 }), 10)).toBe(false)
    })

    it('过了节流窗口且进度前进 → 放行', () => {
        beginOperation('node', 0)
        pushProgress('node', p({ percent: 10 }), 0)
        expect(pushProgress('node', p({ percent: 20 }), MIN_INTERVAL_MS)).toBe(true)
    })

    it('阶段变化必须放行（下载 → 解压），否则进度条会停在半路', () => {
        beginOperation('node', 0)
        pushProgress('node', p({ phase: 'download', percent: 10 }), 0)
        // 同一时刻、百分比还是 100，但阶段变了 → 必须放行
        expect(pushProgress('node', p({ phase: 'extract', percent: 100 }), 1)).toBe(true)
    })

    it('过了窗口但进度值没前进 → 丢弃（避免重复广播同一个百分比）', () => {
        beginOperation('node', 0)
        pushProgress('node', p({ percent: 10 }), 0)
        expect(pushProgress('node', p({ percent: 10 }), MIN_INTERVAL_MS + 100)).toBe(false)
    })

    it('节流被丢弃的进度仍然更新了快照里的最新值', () => {
        beginOperation('node', 0)
        pushProgress('node', p({ percent: 10 }), 0)
        // 这一条不广播（窗口内），但状态要跟上
        pushProgress('node', p({ percent: 11 }), 5)
        expect(currentProgress('node')?.percent).toBe(11)
    })
})
