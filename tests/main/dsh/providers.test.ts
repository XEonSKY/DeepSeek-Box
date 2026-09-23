import { describe, expect, it } from 'vitest'
import {
    DEEPSEEK_BASE,
    MAX_PROVIDERS,
    asRecord,
    collectProviderRoutes,
    defaultKeyEnv,
    displayName,
    groupProviderRoutes,
    isDeepseekHost,
    isHttpURL,
    joinURL,
    routesFromCredentials,
    str,
    type ProviderRoute
} from '@main/dsh/providers'

/**
 * 从 dsh 的 patch 配置推出供应商路由，并按令牌合并成服务商组。
 *
 * 这里守的是三条产品规则（迁移前就在守，只是数据源换成了 patch 层的 config）：
 *  1. 同一令牌 = 同一个服务商，只查询与展示一次；
 *  2. 每个令牌只出一行，且代表优先选 DeepSeek 域（只有它能查余额）；
 *  3. 密钥只以「引用名」在纯逻辑里流转，明文由调用方传入 —— 本模块不碰任何密钥明文。
 */

/** 造一个已合成好的 patch 配置（id → config）。 */
function cfgOf(entries: Record<string, Record<string, unknown>>): Map<string, Record<string, unknown>> {
    return new Map(Object.entries(entries))
}

/** 造一条路由。 */
function route(id: string, baseURL: string, apiKeyEnv: string | null): ProviderRoute {
    return { id, name: id, baseURL, apiKeyEnv }
}

describe('小工具', () => {
    it('asRecord 只认普通对象', () => {
        expect(asRecord({ a: 1 })).toEqual({ a: 1 })
        expect(asRecord(null)).toBeNull()
        expect(asRecord([1])).toBeNull()
        expect(asRecord('x')).toBeNull()
    })

    it('str 裁剪、拒绝空值、按上限截断', () => {
        expect(str('  hi  ')).toBe('hi')
        expect(str('   ')).toBeNull()
        expect(str(42)).toBeNull()
        expect(str('abcdef', 3)).toBe('abc')
    })

    it('displayName 未知路由回落 id，DeepSeek 官方给人类可读名', () => {
        expect(displayName('x', 'X 家')).toBe('X 家')
        expect(displayName('deepseek', null)).toBe('DeepSeek')
        expect(displayName('deepseek-official', null)).toBe('DeepSeek')
        expect(displayName('my-gw', null)).toBe('my-gw')
    })

    it('defaultKeyEnv 把路由名转成大写下划线的引用名', () => {
        expect(defaultKeyEnv('deepseek')).toBe('DEEPSEEK_API_KEY')
        expect(defaultKeyEnv('deepseek-official')).toBe('DEEPSEEK_API_KEY')
        expect(defaultKeyEnv('my-gw')).toBe('MY_GW_API_KEY')
    })

    it('isHttpURL 只接受 http(s)', () => {
        expect(isHttpURL('https://a.com/v1')).toBe(true)
        expect(isHttpURL('http://a.com')).toBe(true)
        expect(isHttpURL('ftp://a.com')).toBe(false)
        expect(isHttpURL('a.com')).toBe(false)
        expect(isHttpURL('')).toBe(false)
    })

    it('isDeepseekHost 认 deepseek.com 及其子域', () => {
        expect(isDeepseekHost('https://api.deepseek.com')).toBe(true)
        expect(isDeepseekHost('https://api.deepseek.com/v1')).toBe(true)
        expect(isDeepseekHost('https://deepseek.com.cn')).toBe(false)
        expect(isDeepseekHost('not-a-url')).toBe(false)
    })

    it('joinURL 保留 baseURL 自带的路径前缀', () => {
        expect(joinURL('https://a.com', '/user/balance')).toBe('https://a.com/user/balance')
        expect(joinURL('https://a.com/v1/', '/user/balance')).toBe('https://a.com/v1/user/balance')
    })
})

describe('collectProviderRoutes', () => {
    it('没有任何配置时为空', () => {
        expect(collectProviderRoutes(cfgOf({}))).toEqual([])
    })

    it('llm-deepseek 的 config 决定端点与引用名', () => {
        const routes = collectProviderRoutes(cfgOf({ 'llm-deepseek': { baseURL: 'https://gw.a.com/v1', apiKeyEnv: 'MY_KEY' } }))
        expect(routes).toEqual([{ id: 'deepseek-official', name: 'DeepSeek', baseURL: 'https://gw.a.com/v1', apiKeyEnv: 'MY_KEY' }])
    })

    it('llm-deepseek 省掉 config 时用官方默认端点与默认引用名', () => {
        const routes = collectProviderRoutes(cfgOf({ 'llm-deepseek': {} }))
        expect(routes[0].baseURL).toBe(DEEPSEEK_BASE)
        expect(routes[0].apiKeyEnv).toBe('DEEPSEEK_API_KEY')
    })

    it('被停用的条目即便有 config 也不参与', () => {
        const cfg = cfgOf({ 'llm-deepseek': {} })
        expect(collectProviderRoutes(cfg, new Set(['llm-deepseek']))).toEqual([])
    })

    it('llm-pi-ai 的 providers 逐个出路由，displayName 优先于 name', () => {
        const routes = collectProviderRoutes(
            cfgOf({
                'llm-pi-ai': {
                    providers: {
                        anthropic: { baseURL: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', displayName: 'Anthropic' },
                        'my-gw': { baseURL: 'http://gw.local/v1', name: '旧字段名' }
                    }
                }
            })
        )
        expect(routes).toEqual([
            { id: 'anthropic', name: 'Anthropic', baseURL: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY' },
            { id: 'my-gw', name: '旧字段名', baseURL: 'http://gw.local/v1', apiKeyEnv: 'MY_GW_API_KEY' }
        ])
    })

    it('pi-ai 路由没有合法端点时跳过（不是 http(s) 就无从查询）', () => {
        const routes = collectProviderRoutes(
            cfgOf({ 'llm-pi-ai': { providers: { bad: { baseURL: 'ftp://x' }, empty: {}, good: { baseURL: 'https://ok.com' } } } })
        )
        expect(routes.map((r) => r.id)).toEqual(['good'])
    })

    it('默认模型指向的供应商缺失时补一条（只有 DeepSeek 域能补出端点）', () => {
        expect(collectProviderRoutes(cfgOf({ 'agent-default-model': { provider: 'deepseek-official' } }))).toEqual([
            { id: 'deepseek-official', name: 'DeepSeek', baseURL: DEEPSEEK_BASE, apiKeyEnv: 'DEEPSEEK_API_KEY' }
        ])
        expect(collectProviderRoutes(cfgOf({ 'agent-default-model': { provider: 'anthropic' } }))).toEqual([])
    })

    it('默认模型指向已出现的路由时不重复出一条', () => {
        const routes = collectProviderRoutes(
            cfgOf({ 'llm-deepseek': {}, 'agent-default-model': { provider: 'deepseek-official' } })
        )
        expect(routes).toHaveLength(1)
    })

    it('条数有硬上限（异常配置不该拉出天量请求）', () => {
        const providers: Record<string, unknown> = {}
        for (let i = 0; i < MAX_PROVIDERS + 6; i++) providers['p' + i] = { baseURL: 'https://p' + i + '.com' }
        expect(collectProviderRoutes(cfgOf({ 'llm-pi-ai': { providers } }))).toHaveLength(MAX_PROVIDERS)
    })

    it('条目存在但没有 config（bundle 的默认路由）也算可用，走默认端点', () => {
        // dsh 的 bundle 里 llm-deepseek 只有 id 与 name，字段全走默认值
        const routes = collectProviderRoutes(cfgOf({ 'llm-deepseek': {} }))
        expect(routes).toHaveLength(1)
        expect(routes[0].baseURL).toBe(DEEPSEEK_BASE)
    })

    it('llm-pi-ai 没有 providers（休眠挂载）时不出任何路由', () => {
        expect(collectProviderRoutes(cfgOf({ 'llm-pi-ai': {} }))).toEqual([])
    })

    it('停用 llm-deepseek 后，默认模型也不再补出 DeepSeek', () => {
        const cfg = cfgOf({ 'llm-deepseek': {}, 'agent-default-model': { provider: 'deepseek-official' } })
        expect(collectProviderRoutes(cfg, new Set(['llm-deepseek']))).toEqual([])
    })

    it('停用只影响自己那一条，其它路由照常', () => {
        const cfg = cfgOf({
            'llm-deepseek': {},
            'llm-pi-ai': { providers: { gw: { baseURL: 'https://gw.a.com' } } }
        })
        expect(collectProviderRoutes(cfg, new Set(['llm-deepseek'])).map((r) => r.id)).toEqual(['gw'])
    })
})

describe('groupProviderRoutes', () => {
    it('解析到同一令牌的路由合并成一组，只保留一个代表', () => {
        const groups = groupProviderRoutes(
            [route('deepseek-official', 'https://api.deepseek.com', 'DEEPSEEK_API_KEY'), route('gw', 'https://gw.a.com', 'DEEPSEEK_API_KEY')],
            { DEEPSEEK_API_KEY: 'sk-abc' }
        )
        expect(groups).toHaveLength(1)
        expect(groups[0].key).toBe('sk-abc')
        expect(groups[0].members.map((m) => m.id)).toEqual(['deepseek-official', 'gw'])
    })

    it('同令牌时代表优先选 DeepSeek 域（只有它能查余额）', () => {
        const groups = groupProviderRoutes(
            [route('gw', 'https://gw.a.com', 'K'), route('deepseek-official', 'https://api.deepseek.com', 'K')],
            { K: 'sk-1' }
        )
        expect(groups).toHaveLength(1)
        expect(groups[0].primary.id).toBe('deepseek-official')
    })

    it('拿不到密钥的路由各自成组（无从判断是否同一家）', () => {
        const groups = groupProviderRoutes(
            [route('a', 'https://a.com', 'A_KEY'), route('b', 'https://b.com', null), route('c', 'https://c.com', 'C_KEY')],
            { A_KEY: 'sk-a' }
        )
        expect(groups.map((g) => g.primary.id)).toEqual(['a', 'b', 'c'])
        expect(groups[1].key).toBeNull()
        expect(groups[2].key).toBeNull()
    })
})

describe('routesFromCredentials', () => {
    it('refs 里有 DEEPSEEK_API_KEY → 补出 DeepSeek 官方路由', () => {
        expect(routesFromCredentials({ DEEPSEEK_API_KEY: 'sk-test' })).toEqual([
            { id: 'deepseek-official', name: 'DeepSeek', baseURL: DEEPSEEK_BASE, apiKeyEnv: 'DEEPSEEK_API_KEY' }
        ])
    })

    it('没有该引用、值为空白、或只有别的名字 → 一律不猜', () => {
        expect(routesFromCredentials({})).toEqual([])
        expect(routesFromCredentials({ DEEPSEEK_API_KEY: '   ' })).toEqual([])
        expect(routesFromCredentials({ OTHER_API_KEY: 'sk-x' })).toEqual([])
    })
})
