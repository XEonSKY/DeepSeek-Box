import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type { CurrentBalanceInfo, ModelBalanceInfo, ModelsInfo, ProviderEntryInfo } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { httpFetch } from '../dsh/http'
import { dshHomeDir } from '../dsh/dshHome'
import { collectPatchLayers, composeMountedConfig, type MountedConfig } from '../dsh/dshPatchLayers'
import {
    asRecord,
    collectProviderRoutes,
    groupProviderRoutes,
    isDeepseekHost,
    isHttpURL,
    joinURL,
    routesFromCredentials,
    str
} from '../dsh/providers'

/**
 * 「模型」页的数据来源：dsh 的 Cordis patch 层（供应商）+ `.credentials.yaml`（API 密钥）
 * + 供应商接口（余额）。
 *
 * dsh 0.1.7 起没有 `settings.yaml`：供应商配置就是 patch 条目里的 `config`，按 id 寻址
 * （见 `dsh/cordisPatch.ts` 与 `dshHome.ts`）。这里按 dsh 的层叠顺序读**合成后的有效配置**：
 * 随附 bundle 层 → profile 层 → home 层。**必须包含 bundle 层** —— dsh 把「开箱可用」的默认
 * 供应商写在 bundle 里（base 的 `agent-default-model: deepseek-official` 与 `llm-deepseek`），
 * 只看用户层会让模型页错误地显示 0 个供应商。
 *
 * 错误码的区分：`settings-missing`（连配置目录都没有）｜ `dsh-missing`（有配置但找不到 dsh
 * 安装）｜ `no-provider`（dsh 装好了但确实没配供应商）｜ `settings-parse` / `internal`。
 *
 * 三条硬规则：
 *  1. **同一令牌 = 同一个服务商**：多个路由解析到同一个密钥时合并成一组，只查询与展示一次；
 *  2. **每个令牌只出一行**：列表按令牌（供应商组）展开，不按模型展开——页面上没有模型名，
 *     所以 `GET /models` 目录查询已随展示需求一起移除（余额仍然要查）；
 *  3. **密钥不出主进程，且授权后才读**：只有当 `consented`（settings.modelsCredConsent）为真
 *     才去读 `.credentials.yaml` 取明文；明文只在本文件内用于发起请求，绝不进入返回值、日志或 IPC 事件。
 *
 * 联网走 httpFetch('app', …)：这是「程序本体」那一档代理范围覆盖的地方 —— 供应商接口
 * 常常和 npm / GitHub 一样被挡在墙外，代理设置了却不生效等于没设置。
 *
 * 兜底：**dsh 尚未安装**（一个 bundle 层都没有）时 patch 层不可能有供应商 —— 此时退回只看
 * `.credentials.yaml` 的密钥引用（`providers.routesFromCredentials`），这样 dsh 缺席也能显示
 * 用户配过的 DeepSeek 与余额；再没有凭据才报 `dsh-missing`（提示去完成安装）。
 *
 * 健壮性：配置解析、网络请求各自兜底，任何单点失败都不会让整页崩掉；
 * 供应商路由的收集 / 合并是纯逻辑，放在 `dsh/providers.ts` 里单独测试。
 */

/** dsh 本地凭据文件（`$DSH_HOME/.credentials.yaml`）。 */
function credentialsFilePath(): string {
    return path.join(dshHomeDir(), '.credentials.yaml')
}

const FETCH_TIMEOUT_MS = 10_000

/** 「模型」页需要的外部环境（由 IPC 层提供，好让本模块保持「不依赖 electron」）。 */
export interface ModelsEnv {
    /** dsh 安装目录下的 `node_modules`；解析不到时传 null（此时只能读用户层）。 */
    installNodeModules: string | null
}

/**
 * 读取 dsh 的**有效**配置并合成（bundle 层 + 用户层）。
 *
 * 只有「一个 bundle 都解析不到、用户层也不存在」才算「dsh 还没初始化过」——
 * 对应迁移前的「没有 settings.yaml」。
 */
function readEffectivePatch(env: ModelsEnv):
    | { ok: true; value: MountedConfig; bundleLayers: number }
    | { ok: false; errorCode: 'settings-missing' | 'settings-parse' } {
    const { layers, parseError, bundleLayers } = collectPatchLayers(env.installNodeModules)
    if (!layers.length) return { ok: false, errorCode: 'settings-missing' }
    if (parseError) return { ok: false, errorCode: 'settings-parse' }

    // bundleLayers 透传给调用方：它决定「没有供应商」该报 dsh-missing 还是 no-provider。
    return { ok: true, value: composeMountedConfig(layers), bundleLayers }
}

/**
 * 读取凭据引用（env 名 → 明文）。**只在授权后调用** —— 两个对外入口都有 `consented` 前置检查，
 * 未授权时根本走不到这里（读凭据要由主进程把关，而不是指望渲染层不发请求）。
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
    const raw = errorMessage(err)
    return { state: 'error', currency: null, total: null, granted: null, toppedUp: null, message: sanitizeMessage(raw) }
}

/**
 * 读取列表：patch 层定供应商、凭据文件供密钥、供应商接口给余额。
 * **每个令牌一行**（同一令牌的多个路由合并为一个服务商）；任一组的失败都不影响其它组。
 */
async function readModelsInfoInner(env: ModelsEnv): Promise<ModelsInfo> {
    const doc = readEffectivePatch(env)
    if (!doc.ok) return { entries: [], errorCode: doc.errorCode }

    const refs = readRefs()
    let routes = collectProviderRoutes(doc.value.cfg, doc.value.disabled)
    // dsh 未安装（没有任何 bundle 层）时 patch 层不可能有供应商：退回「只看 .dsh 里的凭据」，
    // 凭据引用就是这时唯一的线索。
    if (!routes.length && doc.bundleLayers === 0) routes = routesFromCredentials(refs)
    if (!routes.length) {
        // 仍然没有：区分「dsh 未安装」与「装了但确实没配供应商」—— 提示语与下一步动作都不同。
        return { entries: [], errorCode: doc.bundleLayers === 0 ? 'dsh-missing' : 'no-provider' }
    }

    const groups = groupProviderRoutes(routes, refs)
    const entries: ProviderEntryInfo[] = []

    // 一组 = 一个令牌（合并后的服务商）：只查一次余额、只出一行。
    // 各组互不相交（collectProviderRoutes 已按 id 去重），因此不需要再去重行。
    for (const g of groups) {
        const balance = await fetchBalance(g.primary.baseURL, g.key).catch(balanceError)
        entries.push({ provider: g.primary.id, providerName: g.primary.name, balance })
    }
    return { entries, errorCode: null }
}

/**
 * 「模型」页的唯一入口。`consented` 由调用方（IPC 层）从 settings.modelsCredConsent 传入。
 *
 * **未授权时立刻返回 `no-consent`：不读配置、更不读 `.credentials.yaml`，也不联网。**
 * 授权是「允许检查模型余额」这件事本身的前提，因此把关必须在主进程 —— 渲染层不发起请求
 * 只是界面行为，不能当作安全边界。
 *
 * **永不抛异常**：任何意外都收敛成 internal 错误码。
 */
export async function readModelsInfo(consented: boolean, env: ModelsEnv): Promise<ModelsInfo> {
    try {
        if (consented !== true) return { entries: [], errorCode: 'no-consent' }
        return await readModelsInfoInner(env)
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
export async function readCurrentBalance(consented: boolean, env: ModelsEnv): Promise<CurrentBalanceInfo | null> {
    try {
        if (consented !== true) return null
        const doc = readEffectivePatch(env)
        if (!doc.ok) return null

        const refs = readRefs()
        let routes = collectProviderRoutes(doc.value.cfg, doc.value.disabled)
        // 与 readModelsInfo 用同一套兜底：dsh 未安装时靠凭据引用认出 DeepSeek。
        if (!routes.length && doc.bundleLayers === 0) routes = routesFromCredentials(refs)
        if (!routes.length) return null

        const groups = groupProviderRoutes(routes, refs)
        const defProvider = str(doc.value.cfg.get('agent-default-model')?.provider)
        // 默认模型所属的组优先；配置里没写默认模型时退回第一个组。
        const group = (defProvider ? groups.find((g) => g.members.some((m) => m.id === defProvider)) : null) ?? groups[0]
        if (!group) return null
        const balance = await fetchBalance(group.primary.baseURL, group.key).catch(balanceError)
        return { provider: group.primary.id, providerName: group.primary.name, balance }
    } catch {
        return null
    }
}
