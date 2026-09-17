import { describe, expect, it } from 'vitest'
import {
    buildPluginEntries,
    effectiveBundles,
    isBundlePackage,
    readBundleList,
    readDependencyNames,
    readDisabledBundles,
    requiredBundles,
    toggleBundle,
    toggleDisabled
} from '@main/dsh/pluginManifest'

describe('toggleBundle', () => {
    it('启用时追加到末尾', () => {
        expect(toggleBundle(['a'], 'b', true)).toEqual(['a', 'b'])
    })

    it('重复启用保持原样', () => {
        expect(toggleBundle(['a', 'b'], 'b', true)).toEqual(['a', 'b'])
    })

    it('停用时移除', () => {
        expect(toggleBundle(['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c'])
    })

    it('停用不存在的项保持原样', () => {
        expect(toggleBundle(['a'], 'b', false)).toEqual(['a'])
    })

    it('不改动入参', () => {
        const input = ['a']
        toggleBundle(input, 'b', true)
        expect(input).toEqual(['a'])
    })
})

describe('requiredBundles', () => {
    it('随附 profile 返回固定模板', () => {
        expect(requiredBundles('web')).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    })

    it('自定义 profile 只保护 base', () => {
        expect(requiredBundles('my-profile')).toEqual(['@deepseek-ai/dsh-base'])
    })

    it('返回副本', () => {
        const a = requiredBundles('web')
        a.push('x')
        expect(requiredBundles('web')).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    })
})

describe('isBundlePackage', () => {
    it('声明 dsh.bundle.patch 才是组合包', () => {
        expect(isBundlePackage({ dsh: { bundle: { patch: './cordis.patch.yml' } } })).toBe(true)
    })

    it('普通包不是组合包', () => {
        expect(isBundlePackage({ name: 'lib' })).toBe(false)
        expect(isBundlePackage(null)).toBe(false)
        expect(isBundlePackage({ dsh: { bundle: {} } })).toBe(false)
        expect(isBundlePackage({ dsh: { bundle: { patch: '' } } })).toBe(false)
    })
})

describe('readBundleList / readDependencyNames', () => {
    it('读取 bundles 并过滤非字符串', () => {
        expect(readBundleList({ dsh: { profile: { bundles: ['a', 1, '', 'b'] } } })).toEqual(['a', 'b'])
        expect(readBundleList({})).toEqual([])
        expect(readBundleList(null)).toEqual([])
    })

    it('读取依赖名', () => {
        expect(readDependencyNames({ dependencies: { a: '^1', b: 'link:x' } })).toEqual(['a', 'b'])
        expect(readDependencyNames({})).toEqual([])
    })
})

describe('buildPluginEntries', () => {
    it('必备在前、已启用次之、停用依赖最后，且标记正确', () => {
        const entries = buildPluginEntries(
            ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'plugin-a'],
            ['plugin-a', 'plugin-b'],
            ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
        )
        expect(entries).toEqual([
            { name: '@deepseek-ai/dsh-base', enabled: true, installed: true, required: true },
            { name: '@deepseek-ai/dsh-web-app', enabled: true, installed: true, required: true },
            { name: 'plugin-a', enabled: true, installed: true, required: false },
            { name: 'plugin-b', enabled: false, installed: true, required: false }
        ])
    })

    it('必备 bundle 即使不在 bundles 里也显示为启用', () => {
        const entries = buildPluginEntries([], [], ['@deepseek-ai/dsh-base'])
        expect(entries).toEqual([{ name: '@deepseek-ai/dsh-base', enabled: true, installed: true, required: true }])
    })

    it('已启用但未作为依赖安装的 bundle 标记 installed=false', () => {
        const entries = buildPluginEntries(['stale'], [], [])
        expect(entries[0]).toEqual({ name: 'stale', enabled: true, installed: false, required: false })
    })
})

describe('停用集合', () => {
    it('readDisabledBundles 读取 Box 私有字段并过滤非法值', () => {
        expect(readDisabledBundles({ dsh: { profile: { disabledBundles: ['a', 2, '', 'b'] } } })).toEqual(['a', 'b'])
        expect(readDisabledBundles({})).toEqual([])
        expect(readDisabledBundles(null)).toEqual([])
    })

    it('effectiveBundles 剔除被停用的项（dsh 可能把它们写回 bundles）', () => {
        expect(effectiveBundles(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
        expect(effectiveBundles(['a'], [])).toEqual(['a'])
    })

    it('toggleDisabled 停用加入、启用移除', () => {
        expect(toggleDisabled([], 'a', false)).toEqual(['a'])
        expect(toggleDisabled(['a'], 'a', false)).toEqual(['a'])
        expect(toggleDisabled(['a', 'b'], 'a', true)).toEqual(['b'])
        expect(toggleDisabled(['a'], 'b', true)).toEqual(['a'])
    })
})
