/**
 * 从 dsh 的 patch 层推出「供应商路由」与「服务商组」的**纯**逻辑：不碰 fs、不联网、
 * 不 import electron，便于单测。文件读取与余额查询在 `app/models.ts`。
 *
 * 数据来源（0.1.7 起）：dsh 不再有 `settings.yaml`，供应商配置就是 patch 条目里的
 * `config`，按 id 寻址（见 `cordisPatch.ts` / `dshHome.ts`）：
 *
 * | 条目 id                | 用到的 config 字段 |
 * |---|---|
 * | `llm-deepseek`         | `baseURL` / `apiKeyEnv` |
 * | `llm-pi-ai`            | `providers`（键即路由名；每项 `baseURL` / `apiKeyEnv` / `displayName`） |
 * | `agent-default-model`  | `provider` / `model` |
 *
 * 三条硬规则（与迁移前一致，只是换了数据源）：
 *  1. **同一令牌 = 同一个服务商**：多个路由解析到同一个密钥时合并成一组，只查询与展示一次；
 *  2. **每个令牌只出一行**：列表按令牌（供应商组）展开，不按模型展开；
 *  3. **密钥不出主进程**：本模块只持有 `apiKeyEnv`（引用名），明文由调用方传入。
 */

/** 供应商路由：一条 patch 条目里能确定的端点与凭据引用。 */
export interface ProviderRoute {
    id: string
    name: string
    baseURL: string
    apiKeyEnv: string | null
}

/** 按令牌合并后的服务商组：同一令牌只保留一个代表，余额 / 目录只查一次。 */
export interface ProviderGroup {
    /** 令牌明文（仅内存）；无可用密钥时为 null。 */
    key: string | null
    /** 组代表：查询与展示都用它。 */
    primary: ProviderRoute
    members: ProviderRoute[]
}

/** DeepSeek 官方端点：只有该域提供公开的余额接口。 */
export const DEEPSEEK_BASE = 'https://api.deepseek.com'
/** 参考上限：配置异常时不至于拉出天量请求 / 天量列表行。 */
export const MAX_PROVIDERS = 64
export const MAX_ID_LEN = 120
export const MAX_NAME_LEN = 200

/** 只接受「普通对象」：数组与 null 都不算。 */
export function asRecord(v: unknown): Record<string, unknown> | null {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 取一个非空、已裁剪且在长度上限内的字符串。 */
export function str(v: unknown, max: number = MAX_ID_LEN): string | null {
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (!s) return null
    return s.length > max ? s.slice(0, max) : s
}

/** 供应商展示名：配置里有就用它，否则已知路由给人类可读名。 */
export function displayName(id: string, explicit: string | null): string {
    if (explicit) return explicit
    if (id === 'deepseek' || id === 'deepseek-official') return 'DeepSeek'
    return id
}

/** 供应商 id → 默认凭据引用名（DeepSeek 官方路由固定用 DEEPSEEK_API_KEY）。 */
export function defaultKeyEnv(id: string): string {
    if (id === 'deepseek' || id === 'deepseek-official') return 'DEEPSEEK_API_KEY'
    return id.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY'
}

/** 是否 DeepSeek 域——只有它提供公开的余额接口，其余供应商的余额标记为 unsupported。 */
export function isDeepseekHost(baseURL: string): boolean {
    try {
        return new URL(baseURL).hostname.endsWith('deepseek.com')
    } catch {
        return false
    }
}

/** 只接受可解析的 http(s) 端点：挡掉配置里被写坏的 baseURL。 */
export function isHttpURL(u: string): boolean {
    try {
        const p = new URL(u)
        return p.protocol === 'http:' || p.protocol === 'https:'
    } catch {
        return false
    }
}

/** 拼接端点：保留 baseURL 自带的路径前缀（如网关的 /v1）。 */
export function joinURL(baseURL: string, suffix: string): string {
    return baseURL.replace(/\/+$/, '') + suffix
}

/**
 * 从合成后的 patch 配置里收集可用供应商路由（只保留有合法端点的）。
 *
 * @param cfg      合成后的 `id → config`（见 `cordisPatch.composePatchConfig`）。
 * @param disabled 被停用的条目 id：停用的条目即便有 config 也不参与。
 */
export function collectProviderRoutes(
    cfg: ReadonlyMap<string, Record<string, unknown>>,
    disabled: ReadonlySet<string> = new Set()
): ProviderRoute[] {
    const out: ProviderRoute[] = []
    const seen = new Set<string>()
    const get = (id: string): Record<string, unknown> | null => {
        if (disabled.has(id)) return null
        return cfg.get(id) ?? null
    }
    const push = (id: string, name: string, baseURL: string, apiKeyEnv: string | null): void => {
        if (out.length >= MAX_PROVIDERS) return
        if (!id || seen.has(id) || !baseURL || !isHttpURL(baseURL)) return
        seen.add(id)
        out.push({ id, name, baseURL, apiKeyEnv })
    }

    // 1) DeepSeek 官方路由：config 里可能整段省略（此时用官方默认端点）。
    const ds = get('llm-deepseek')
    if (ds) {
        push(
            'deepseek-official',
            displayName('deepseek-official', str(ds.name, MAX_NAME_LEN)),
            str(ds.baseURL) ?? DEEPSEEK_BASE,
            str(ds.apiKeyEnv) ?? defaultKeyEnv('deepseek-official')
        )
    }

    // 2) pi-ai 手工声明的路由（没有合法 baseURL 就无从查询，跳过）。
    const pi = asRecord(get('llm-pi-ai')?.providers)
    if (pi) {
        for (const [id, raw] of Object.entries(pi)) {
            const row = asRecord(raw) ?? {}
            const pid = str(id)
            if (!pid) continue
            push(
                pid,
                displayName(pid, str(row.displayName, MAX_NAME_LEN) ?? str(row.name, MAX_NAME_LEN)),
                str(row.baseURL) ?? '',
                str(row.apiKeyEnv) ?? defaultKeyEnv(pid)
            )
        }
    }

    // 3) 默认模型指向的供应商若还没出现就补一条——只有 DeepSeek 域能补出可用端点，
    //    其余路由必须自己声明 baseURL（与迁移前的行为一致）。
    //
    //    DeepSeek 系路由由 `llm-deepseek` 提供，所以它被**停用**时这条兜底也要跳过，
    //    否则会出现「用户停掉了官方路由，模型页却还列着 DeepSeek」。
    const def = get('agent-default-model')
    const defProvider = str(def?.provider)
    if (defProvider && !(defProvider.includes('deepseek') && disabled.has('llm-deepseek'))) {
        push(defProvider, displayName(defProvider, null), defProvider.includes('deepseek') ? DEEPSEEK_BASE : '', defaultKeyEnv(defProvider))
    }
    return out
}

/**
 * 凭据兜底：dsh **尚未安装**（一个 bundle 层都没解析到）时，patch 层里不可能有供应商，
 * 此时 `.dsh` 里唯一与模型有关的配置就是 `.credentials.yaml` 的 `refs`。
 * 用户既然写了 DeepSeek 官方那个约定名，就按官方端点补一条路由 —— 让模型页在 dsh 缺席时
 * 仍能显示供应商与余额，而不是丢一句「请先在 dsh 中配置供应商」。
 *
 * **只认 dsbox 已知的约定名**（`DEEPSEEK_API_KEY` → 官方端点）：其余密钥名无从判断端点，
 * 宁可不猜。密钥是否真的可用交给余额查询去证伪（`no-key` / HTTP 错误各有状态）。
 */
export function routesFromCredentials(refs: Record<string, string>): ProviderRoute[] {
    const id = 'deepseek-official'
    const apiKeyEnv = defaultKeyEnv(id)
    if (!str(refs[apiKeyEnv], 4096)) return []
    return [{ id, name: displayName(id, null), baseURL: DEEPSEEK_BASE, apiKeyEnv }]
}

/**
 * 按令牌把路由合并成服务商组：
 *  - 解析到同一密钥的路由视为同一个服务商，只保留一个代表（优先 DeepSeek 域，因为只有它能查余额）；
 *  - 没有可用密钥的路由各自成组（无从判断是否同一家）。
 */
export function groupProviderRoutes(routes: readonly ProviderRoute[], refs: Record<string, string>): ProviderGroup[] {
    const groups = new Map<string, ProviderGroup>()
    for (const p of routes) {
        const key = p.apiKeyEnv ? (str(refs[p.apiKeyEnv], 4096) ?? null) : null
        const groupKey = key ? 'token:' + key : 'id:' + p.id
        const existing = groups.get(groupKey)
        if (!existing) {
            groups.set(groupKey, { key, primary: p, members: [p] })
            continue
        }
        existing.members.push(p)
        if (!isDeepseekHost(existing.primary.baseURL) && isDeepseekHost(p.baseURL)) existing.primary = p
    }
    return [...groups.values()]
}
