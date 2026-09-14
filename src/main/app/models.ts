import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { parse } from 'yaml'
import type { CurrentBalanceInfo, ModelBalanceInfo, ModelsInfo, ProviderEntryInfo } from '@shared/types'
import { httpFetch } from '../dsh/http'

/**
 * 「模型」页的数据来源：dsh 的 settings.yaml（供应商）+ .credentials.yaml（API 密钥）
 * + 供应商接口（余额）。
 *
 * 三条硬规则：
 *  1. **同一令牌 = 同一个服务商**：多个路由解析到同一个密钥时合并成一组，只查询与展示一次；
 *  2. **每个令牌只出一行**：列表按令牌（供应商组）展开，不按模型展开——页面上没有模型名，
 *     所以过去那次 `GET /models` 目录查询已随展示需求一起移除（余额仍然要查）；
 *  3. **密钥不出主进程**：明文只在本文件内用于发起请求，绝不进入返回值、日志或 IPC 事件。
 *
 * 联网走 httpFetch('app', …)：这是「程序本体」那一档代理范围覆盖的地方 —— 供应商接口
 * 常常和 npm / GitHub 一样被挡在墙外，代理设置了却不生效等于没设置。
 *
 * 健壮性：配置解析、网络请求各自兜底，任何单点失败都不会让整页崩掉；
 * 同时用防御上限挡住异常 / 恶意配置造成的请求风暴与超长列表。
 */

/** dsh harness home：`$DSH_HOME` 或 `~/.dsh`（与 settings.ts 的 dshSettingsFile 同目录）。 */
export function dshHomeDir(): string {
    return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** dsh 本地凭据文件。 */
function credentialsFilePath(): string {
    return path.join(dshHomeDir(), '.credentials.yaml')
}

/** dsh 用户设置文件（供应商与默认模型都在这里）。 */
function settingsFilePath(): string {
    return path.join(dshHomeDir(), 'settings.yaml')
}

/** DeepSeek 官方端点：只有该域提供公开的余额接口。 */
const DEEPSEEK_BASE = 'https://api.deepseek.com'
const FETCH_TIMEOUT_MS = 10_000
/** 参考上限：配置异常时不至于拉出天量请求 / 天量列表行。 */
const MAX_PROVIDERS = 64
const MAX_ID_LEN = 120
const MAX_NAME_LEN = 200

interface ProviderConfig {
    id: string
    name: string
    baseURL: string
    apiKeyEnv: string | null
}

/** 按令牌合并后的服务商组：同一令牌只保留一个代表，余额 / 目录只查一次。 */
interface ProviderGroup {
    /** 令牌明文（仅内存）；无可用密钥时为 null。 */
    key: string | null
    /** 组代表：查询与展示都用它。 */
    primary: ProviderConfig
    members: ProviderConfig[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 取一个非空、已裁剪且在长度上限内的字符串。 */
function str(v: unknown, max = MAX_ID_LEN): string | null {
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (!s) return null
    return s.length > max ? s.slice(0, max) : s
}

/** 供应商展示名：配置里有就用它，否则已知路由给人类可读名。 */
function displayName(id: string, explicit: string | null): string {
    if (explicit) return explicit
    if (id === 'deepseek' || id === 'deepseek-official') return 'DeepSeek'
    return id
}

/** 供应商 id → 默认凭据引用名（DeepSeek 官方路由固定用 DEEPSEEK_API_KEY）。 */
function defaultKeyEnv(id: string): string {
    if (id === 'deepseek' || id === 'deepseek-official') return 'DEEPSEEK_API_KEY'
    return id.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY'
}

/** 是否 DeepSeek 域——只有它提供公开的余额接口，其余供应商的余额标记为 unsupported。 */
function isDeepseekHost(baseURL: string): boolean {
    try {
        return new URL(baseURL).hostname.endsWith('deepseek.com')
    } catch {
        return false
    }
}

/** 只接受可解析的 http(s) 端点：挡掉 settings 里被写坏的 baseURL。 */
function isHttpURL(u: string): boolean {
    try {
        const p = new URL(u)
        return p.protocol === 'http:' || p.protocol === 'https:'
    } catch {
        return false
    }
}

/** 拼接端点：保留 baseURL 自带的路径前缀（如网关的 /v1）。 */
function joinURL(baseURL: string, suffix: string): string {
    return baseURL.replace(/\/+$/, '') + suffix
}

/**
 * 读取凭据引用（env 名 → 明文）。
 * 明文只返回给本模块的请求构造函数使用；调用方绝不把它写进 ModelsInfo。
 */
function readRefs(): Record<string, string> {
    const out: Record<string, string> = {}
    let text: string
    try {
        text = fs.readFileSync(credentialsFilePath(), 'utf8')
    } catch {
        return out
    }
    let root: Record<string, unknown> | null
    try {
        root = asRecord(parse(text))
    } catch {
        // 文件损坏时视为没有可用凭据：页面会把余额显示为「未配置密钥」。
        return out
    }
    const refs = asRecord(root?.refs) ?? {}
    for (const [name, raw] of Object.entries(refs)) {
        const value = str(raw, 4096)
        if (value) out[name] = value
    }
    // api-key 记录也可能用 env 映射存密钥；grant 的 payload.secret 是会话密文而非模型密钥，刻意不取。
    const records = asRecord(root?.records) ?? {}
    for (const raw of Object.values(records)) {
        const env = asRecord(asRecord(raw)?.env) ?? {}
        for (const [name, value] of Object.entries(env)) {
            const secret = str(value, 4096)
            if (secret) out[name] = secret
        }
    }
    return out
}

/** 把 settings.yaml 里能确定的供应商路由收成一份列表（只保留有合法端点的）。 */
/** 把 settings.yaml 里能确定的供应商路由收成一份列表（只保留有合法端点的）。 */
function collectProviders(settings: Record<string, unknown>): ProviderConfig[] {
    const out: ProviderConfig[] = []
    const seen = new Set<string>()
    const push = (id: string, name: string, baseURL: string, apiKeyEnv: string | null): void => {
        if (out.length >= MAX_PROVIDERS) return
        if (!id || seen.has(id) || !baseURL || !isHttpURL(baseURL)) return
        seen.add(id)
        out.push({ id, name, baseURL, apiKeyEnv })
    }

    // 1) DeepSeek 官方路由：settings 里可能整段省略（此时用官方默认端点）。
    const ds = asRecord(settings['llm-deepseek'])
    if (ds) {
        push(
            'deepseek-official',
            displayName('deepseek-official', str(ds.name, MAX_NAME_LEN)),
            str(ds.baseURL) ?? DEEPSEEK_BASE,
            str(ds.apiKeyEnv) ?? defaultKeyEnv('deepseek-official')
        )
    }

    // 2) pi-ai 手工声明的路由（没有合法 baseURL 就无从查询，跳过）。
    const pi = asRecord(asRecord(settings['llm-pi-ai'])?.providers)
    if (pi) {
        for (const [id, raw] of Object.entries(pi)) {
            const cfg = asRecord(raw) ?? {}
            const pid = str(id)
            if (!pid) continue
            push(pid, displayName(pid, str(cfg.name, MAX_NAME_LEN)), str(cfg.baseURL) ?? '', str(cfg.apiKeyEnv) ?? defaultKeyEnv(pid))
        }
    }

    // 3) 默认模型指向的供应商若还没出现就补一条——当前部署（只有 agent-default-model）走这里。
    const def = asRecord(settings['agent-default-model'])
    const defProvider = str(def?.provider)
    if (defProvider) {
        push(defProvider, displayName(defProvider, null), defProvider.includes('deepseek') ? DEEPSEEK_BASE : '', defaultKeyEnv(defProvider))
    }
    return out
}

/**
 * 按令牌把路由合并成服务商组：
 *  - 解析到同一密钥的路由视为同一个服务商，只保留一个代表（优先 DeepSeek 域，因为只有它能查余额）；
 *  - 没有可用密钥的路由各自成组（无从判断是否同一家）。
 */
function groupProviders(providers: ProviderConfig[], refs: Record<string, string>): ProviderGroup[] {
    const groups = new Map<string, ProviderGroup>()
    for (const p of providers) {
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

/** 带超时的 JSON 请求；key 为空时不带 Authorization 头。走「程序本体」范围的代理。 */
async function fetchJson(url: string, key: string | null): Promise<unknown> {
    if (!isHttpURL(url)) throw new Error('invalid-url')
    const res = await httpFetch('app', url, {
        headers: {
            Accept: 'application/json',
            ...(key ? { Authorization: 'Bearer ' + key } : {})
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
}

/** 余额：只有 DeepSeek 域可查，其余供应商明确回 unsupported。 */
async function fetchBalance(baseURL: string, key: string | null): Promise<ModelBalanceInfo> {
    const none: ModelBalanceInfo = { state: 'error', currency: null, total: null, granted: null, toppedUp: null, message: null }
    if (!isDeepseekHost(baseURL)) return { ...none, state: 'unsupported' }
    if (!key) return { ...none, state: 'no-key' }
    const body = asRecord(await fetchJson(joinURL(baseURL, '/user/balance'), key))
    const infos = body?.balance_infos
    const first = Array.isArray(infos) ? asRecord(infos[0]) : null
    if (!first) return { ...none, message: 'unexpected-response' }
    return {
        state: 'ok',
        currency: str(first.currency, 16),
        total: str(first.total_balance, 64),
        granted: str(first.granted_balance, 64),
        toppedUp: str(first.topped_up_balance, 64),
        message: null
    }
}

/** 错误说明脱敏：抹掉可能混进来的令牌 / Bearer 串，并截断长度。 */
function sanitizeMessage(raw: string): string {
    const cleaned = raw
        .replace(/Bearer\s+\S+/gi, 'Bearer ***')
        .replace(/[A-Za-z0-9_-]{32,}/g, '***')
        .replace(/[\r\n]+/g, ' ')
    return cleaned.length > 120 ? cleaned.slice(0, 120) + '…' : cleaned
}

/** 把异常收成可展示的错误状态（HTTP 码 / 超时 / DNS）；不含任何请求内容。 */
function balanceError(err: unknown): ModelBalanceInfo {
    const raw = err instanceof Error ? err.message : String(err)
    return { state: 'error', currency: null, total: null, granted: null, toppedUp: null, message: sanitizeMessage(raw) }
}

/** 读取 settings.yaml 文档；异常收敛成错误码，不抛。 */
function loadSettingsDoc(): { ok: true; settings: Record<string, unknown> } | { ok: false; errorCode: 'settings-missing' | 'settings-parse' } {
    let raw: string
    try {
        raw = fs.readFileSync(settingsFilePath(), 'utf8')
    } catch {
        return { ok: false, errorCode: 'settings-missing' }
    }
    try {
        return { ok: true, settings: asRecord(parse(raw)) ?? {} }
    } catch {
        return { ok: false, errorCode: 'settings-parse' }
    }
}

/**
 * 读取列表：settings.yaml 定供应商、凭据文件供密钥、供应商接口给余额。
 * **每个令牌一行**（同一令牌的多个路由合并为一个服务商）；任一组的失败都不影响其它组。
 */
async function readModelsInfoInner(): Promise<ModelsInfo> {
    const doc = loadSettingsDoc()
    if (!doc.ok) return { entries: [], errorCode: doc.errorCode }
    const providers = collectProviders(doc.settings)
    if (!providers.length) return { entries: [], errorCode: 'no-provider' }

    const refs = readRefs()
    const groups = groupProviders(providers, refs)
    const entries: ProviderEntryInfo[] = []

    // 一组 = 一个令牌（合并后的服务商）：只查一次余额、只出一行。
    // 各组互不相交（collectProviders 已按 id 去重），因此不需要再去重行。
    for (const g of groups) {
        const balance = await fetchBalance(g.primary.baseURL, g.key).catch(balanceError)
        entries.push({ provider: g.primary.id, providerName: g.primary.name, balance })
    }
    return { entries, errorCode: null }
}

/** 对外唯一入口：**永不抛异常**，任何意外都收敛成 internal 错误码。 */
export async function readModelsInfo(): Promise<ModelsInfo> {
    try {
        return await readModelsInfoInner()
    } catch {
        return { entries: [], errorCode: 'internal' }
    }
}

/**
 * 状态栏用：解析「当前默认模型」所属的服务商并查询其余额。
 *
 * `consented` 由调用方（IPC 层）从 settings.modelsCredConsent 传入；为假时直接返回 null ——
 * 不读配置、不联网。本函数不依赖 electron，便于独立测试。
 * **永不抛异常**：任何失败都返回 null，让状态栏保持空白而不是显示半截信息。
 */
export async function readCurrentBalance(consented: boolean): Promise<CurrentBalanceInfo | null> {
    try {
        if (consented !== true) return null
        const doc = loadSettingsDoc()
        if (!doc.ok) return null
        const providers = collectProviders(doc.settings)
        if (!providers.length) return null

        const groups = groupProviders(providers, readRefs())
        const defProvider = str(asRecord(doc.settings['agent-default-model'])?.provider)
        // 默认模型所属的组优先；配置里没写默认模型时退回第一个组。
        const group = (defProvider ? groups.find((g) => g.members.some((m) => m.id === defProvider)) : null) ?? groups[0]
        if (!group) return null
        const balance = await fetchBalance(group.primary.baseURL, group.key).catch(balanceError)
        return { provider: group.primary.id, providerName: group.primary.name, balance }
    } catch {
        return null
    }
}
