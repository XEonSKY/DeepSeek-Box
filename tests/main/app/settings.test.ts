import { describe, expect, it } from 'vitest'
import { normalizeDownloadThreads, normalizeNodeRuntime, normalizeNpmSource, normalizeProxyScope } from '@main/app/settings'
import { DEFAULT_SETTINGS, PROXY_SCOPE_IDS } from '@shared/types'
import type { Settings } from '@shared/types'

/**
 * 设置归一化：**向后兼容是硬要求**（铁律 16）。
 * 这里的每条规则都对应一类真实故障：
 *  - 漏了 legacy 判断 → 用户手填的值每次启动被改写；
 *  - 升级规则写反 → 老用户被悄悄打开/关闭代理。
 * 这些函数不碰 Electron，可以独立测试。
 */

describe('normalizeNpmSource', () => {
    it('新值原样保留', () => {
        expect(normalizeNpmSource('bundled')).toBe('bundled')
        expect(normalizeNpmSource('localnode')).toBe('localnode')
    })

    it('system 原样保留', () => {
        expect(normalizeNpmSource('system')).toBe('system')
    })

    it('旧值 auto 与其它非法值一律回落到 system', () => {
        expect(normalizeNpmSource('auto')).toBe('system')
        expect(normalizeNpmSource(undefined)).toBe('system')
        expect(normalizeNpmSource(null)).toBe('system')
        expect(normalizeNpmSource(42)).toBe('system')
    })
})

describe('normalizeNodeRuntime', () => {
    it('system 是用户显式选择，原样保留', () => {
        expect(normalizeNodeRuntime('system')).toBe('system')
    })

    it('local 原样保留', () => {
        expect(normalizeNodeRuntime('local')).toBe('local')
    })

    it("旧值 'electron' 已移除，无条件迁移到默认的 local", () => {
        // 这不是「改默认值」而是删枚举值：保留旧值会让类型与运行期都不成立。
        expect(normalizeNodeRuntime('electron')).toBe('local')
    })

    it('缺失 / 非法值回落 local', () => {
        expect(normalizeNodeRuntime(undefined)).toBe('local')
        expect(normalizeNodeRuntime(null)).toBe('local')
        expect(normalizeNodeRuntime(42)).toBe('local')
        expect(normalizeNodeRuntime('')).toBe('local')
    })

    it('默认设置就是 local（初始化向导据此默认选中）', () => {
        expect(DEFAULT_SETTINGS.nodeRuntime).toBe('local')
    })
})

describe('normalizeDownloadThreads', () => {
    it('auto / 缺失 回默认', () => {
        expect(normalizeDownloadThreads('auto', false)).toBe(DEFAULT_SETTINGS.downloadThreads)
        expect(normalizeDownloadThreads(undefined, false)).toBe(DEFAULT_SETTINGS.downloadThreads)
        expect(normalizeDownloadThreads(null, false)).toBe(DEFAULT_SETTINGS.downloadThreads)
    })

    it('1–16 的整数原样保留', () => {
        expect(normalizeDownloadThreads(1, false)).toBe(1)
        expect(normalizeDownloadThreads(8, false)).toBe(8)
        expect(normalizeDownloadThreads(16, false)).toBe(16)
    })

    it('超过 16 截到 16（与 downloader 的上限一致）', () => {
        expect(normalizeDownloadThreads(64, false)).toBe(16)
    })

    it('小于 1 或非数字回默认', () => {
        expect(normalizeDownloadThreads(0, false)).toBe(DEFAULT_SETTINGS.downloadThreads)
        expect(normalizeDownloadThreads(-3, false)).toBe(DEFAULT_SETTINGS.downloadThreads)
        expect(normalizeDownloadThreads('abc', false)).toBe(DEFAULT_SETTINGS.downloadThreads)
        expect(normalizeDownloadThreads(NaN, false)).toBe(DEFAULT_SETTINGS.downloadThreads)
    })

    it('小数向下取整', () => {
        expect(normalizeDownloadThreads(4.9, false)).toBe(4)
    })

    it('legacy 配置里恰好是旧默认 4 → 升级为 auto', () => {
        expect(normalizeDownloadThreads(4, true)).toBe(DEFAULT_SETTINGS.downloadThreads)
    })

    it('非 legacy 配置里的 4 必须原样保留 —— 那是用户的明确选择', () => {
        expect(normalizeDownloadThreads(4, false)).toBe(4)
    })

    it('legacy 配置里非 4 的值同样保留', () => {
        expect(normalizeDownloadThreads(8, true)).toBe(8)
    })
})

describe('normalizeProxyScope', () => {
    const DEFAULTS = [...DEFAULT_SETTINGS.proxyScope]

    it('非数组回默认', () => {
        expect(normalizeProxyScope(undefined, false)).toEqual(DEFAULTS)
        expect(normalizeProxyScope('npm', false)).toEqual(DEFAULTS)
        expect(normalizeProxyScope(null, true)).toEqual(DEFAULTS)
    })

    it('过滤未知项', () => {
        expect(normalizeProxyScope(['npm', 'bogus', 'node'], false)).toEqual(['npm', 'node'])
    })

    it('按 PROXY_SCOPE_IDS 的固定顺序还原（与用户在界面上勾选的顺序无关）', () => {
        expect(normalizeProxyScope(['registry', 'npm', 'app'], false)).toEqual(['app', 'npm', 'registry'])
    })

    it('非 legacy：用户手挑的子集必须原样保留，不能被悄悄扩展', () => {
        expect(normalizeProxyScope(['update'], false)).toEqual(['update'])
        expect(normalizeProxyScope([], false)).toEqual([])
    })

    it('legacy 且恰好等于旧默认三项 → 给新默认（六项全开）', () => {
        expect(normalizeProxyScope(['npm', 'node', 'update'], true)).toEqual(DEFAULTS)
    })

    it('legacy 且旧默认项顺序不同但集合相同 → 同样视为「从未自定义」', () => {
        expect(normalizeProxyScope(['update', 'node', 'npm'], true)).toEqual(DEFAULTS)
    })

    it('legacy 自定义配置：只做等价拆分，update 额外补出 registry', () => {
        // 输出按 PROXY_SCOPE_IDS 的顺序排列：app, update, dsh, npm, node, registry
        expect(normalizeProxyScope(['npm', 'update'], true)).toEqual(['update', 'npm', 'registry'])
    })

    it('legacy 自定义配置不会自动打开 app / dsh（不改变既有网络行为）', () => {
        const out = normalizeProxyScope(['npm', 'update'], true)
        expect(out).not.toContain('app')
        expect(out).not.toContain('dsh')
    })

    it('legacy 且不含 update 时不会凭空补出 registry', () => {
        expect(normalizeProxyScope(['npm'], true)).toEqual(['npm'])
    })

    it('返回值是合法 ProxyScope 集合，且不含重复项', () => {
        const out = normalizeProxyScope(['npm', 'npm', 'node', 'bogus'], false) as Settings['proxyScope']
        expect(out).toEqual([...new Set(out)])
        for (const s of out) expect(PROXY_SCOPE_IDS).toContain(s)
    })
})
