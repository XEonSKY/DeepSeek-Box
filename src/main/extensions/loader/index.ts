/**
 * 扩展**加载器的运行时**：把前面那些纯逻辑模块编排成一次完整的加载过程。
 *
 * 这是「加载器」这一层的门面。它承担 NeoForge 式的四项职责，且**每一项都只在这一层发生**：
 *
 *   1. 发现 —— 取静态登记的系统 / 内置扩展 + 扫描磁盘上的外部扩展（sources.ts）；
 *   2. 排序 —— 按 manifest 硬依赖拓扑排序（ordering.ts）；
 *   3. 注入 —— 把贡献点挂进内核插槽、把能力挂进能力槽（registry / capability）；
 *   4. 提供 API 面 —— 为每个扩展造一个 ctx（ctx.ts）。
 *
 * 与内核的关系是**单向**的：本层 import 内核，内核不知道本层存在。
 * 于是「删掉扩展层」等于不调用本文件，内核照常运行 —— 这正是微内核可裁剪的验证点。
 *
 * **静态与外部两条加载路径**（差别不只在于「从哪来」）：
 *
 *  | | 系统 / 内置 | 外部 |
 *  |---|---|---|
 *  | 来源 | 构建期编译进 bundle 的模块对象 | 运行时 `import()` 磁盘目录 |
 *  | 失败风险 | 编译期已排除 | 半成品 / 恶意代码都可能 |
 *  | 可停用 | 否（系统）/ 是（内置） | 是 |
 *  | 崩溃计数 | 不参与 | 参与（达到阈值进安全模式） |
 *
 * 失败隔离是这一层的核心责任：**任何一个外部扩展抛错只让它自己 `failed`**，
 * 不得中断其它扩展的加载，更不得让应用起不来。所有可能抛错的边界都套了 try/catch。
 */

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import type { ExtInfo, ExtKind, ExtStatus, ExtCapability, ExtStateFile, ExtensionsInfo, ExtManifest, ExtTabContribution, ExtSettingsContribution } from '@shared/extensions'
import { EXT_API_VERSION } from '@shared/extensions'
import * as capability from './capability'
import * as registry from './registry'
import { createContext, channelOf, releaseOwner, type ExtContext, type ExtModule } from './ctx'
import { parseManifest, missingDependencies, isSafeContributionKey } from './manifest'
import { topoSort, reverseForUnload, type SortableItem } from './ordering'
import { decideSafeMode, recordCrash, clearCrashesAfterCleanBoot } from './safemode'
import { discoverExternal, externalRoot, currentChannel, staticExts } from './sources'
import { loadState, saveState } from './state'
import { logger } from '../../kernel/logger'

const log = logger('[ext]')

// registry 刻意保持纯逻辑（不依赖日志库），由这里注入上报出口，让撤销失败的输出
// 也走主进程统一日志，而不是散落的 console.error。
registry.setDisposeErrorSink((kind, key, err) => {
    log.error({ err }, `failed to dispose contribution: ${kind} ${key}`)
})

// ---------------------------------------------------------------------------
// 加载期的运行时状态
// ---------------------------------------------------------------------------

/** 一个已装载的扩展（含它的 ctx 与入口模块，供卸载时回调）。 */
interface LoadedExt {
    id: string
    kind: ExtKind
    dir: string
    ctx: ExtContext
    module: ExtModule
}

/** 加载器整体状态。用模块级单例：加载器在一台机器上只应有一份。 */
interface LoaderState {
    /** 已装载的扩展（按加载顺序，卸载时逆序）。 */
    loaded: LoadedExt[]
    /** 全部已发现扩展的界面信息（含失败 / 跳过 / 停用的），供 `GET /extensions`。 */
    entries: Map<string, ExtInfo>
    /** 持久化状态（崩溃计数 / 停用列表 / 安全模式原因）。 */
    disk: ExtStateFile
    /** 本次启动是否处于安全模式。 */
    safeMode: boolean
    /** 本次启动各扩展的失败原因（用于安全模式提示与界面）。 */
    reasons: Record<string, string>
    /** 注入点：由内核侧（modules/extensions.ts）在装配期提供。 */
    ports: LoaderPorts | null
}

/**
 * 加载器需要内核提供的落点（全部由调用方注入，避免本层依赖内核实现）。
 *
 * 只有这三个函数 —— 加载器不认识 Router / broadcast / ipcMain。
 * 这样内核换掉路由实现、换掉广播通道，本层一行都不用改。
 */
export interface LoaderPorts {
    /** 挂一条扩展自有端点（method + 完整路径 + 处理函数），返回撤销函数。 */
    mountRoute: (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', routePath: string, handler: (...args: never[]) => unknown) => () => void
    /** 往渲染侧广播一条事件（走唯一事件通道）。 */
    emit: (event: string, payload?: unknown) => void
    /** 通知渲染层：扩展列表变了，请重新拉取。 */
    notifyChanged: () => void
}

const state: LoaderState = {
    loaded: [],
    entries: new Map(),
    disk: { version: 1, crashes: {}, disabled: [] },
    safeMode: false,
    reasons: {},
    ports: null
}

/** 装载端口（幂等：重复调用以最后一次为准）。 */
export function installPorts(ports: LoaderPorts): void {
    state.ports = ports
}

// ---------------------------------------------------------------------------
// 候选：静态登记项与磁盘发现项统一成一个形状
// ---------------------------------------------------------------------------

/** 一个统一后的待加载项。 */
interface Candidate extends SortableItem {
    /** 展示与排查用的目录（静态扩展用源码目录）。 */
    dir: string
    kind: ExtKind
    manifest: ExtManifest
    /** 静态扩展的入口模块（外部扩展为 null，需要运行时 `import()`）。 */
    module: ExtModule | null
}

/** 外部扩展的入口解析结果。 */
type ResolvedEntry = { ok: true; module: ExtModule } | { ok: false; reason: string }

/** 读取并解析一个外部扩展目录的 manifest。 */
function readDiskManifest(dir: string): ReturnType<typeof parseManifest> {
    const file = path.join(dir, 'manifest.json')
    let raw: unknown
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
        return { ok: false, reason: `清单读取失败：${err instanceof Error ? err.message : String(err)}` }
    }
    return parseManifest(raw)
}

/**
 * 解析外部扩展的入口文件路径。
 *
 * 加载顺序（第一个存在者生效）：manifest 声明的 `main` → `main.js` → `index.js`。
 * 只认 `.js`：外部扩展是用户提供的构建产物，加载器不做转译
 * （把 TS 编译链拖进运行期既慢又扩大攻击面）。
 */
function resolveEntryFile(dir: string, declared?: string): string | null {
    const candidates = declared ? [declared, 'main.js', 'index.js'] : ['main.js', 'index.js']
    for (const rel of candidates) {
        // 防目录穿越：声明里带 `..` 或绝对路径一律拒绝。
        if (rel.includes('..') || path.isAbsolute(rel)) continue
        const full = path.join(dir, rel)
        try {
            if (fs.statSync(full).isFile()) return full
        } catch {
            /* 不存在则试下一个 */
        }
    }
    return null
}

/** 加载外部扩展的入口模块。 */
async function loadDiskEntry(dir: string, declared?: string): Promise<ResolvedEntry> {
    const file = resolveEntryFile(dir, declared)
    if (!file) return { ok: false, reason: '找不到入口文件（main.js / index.js）' }
    try {
        // 用 file:// URL 导入：Windows 盘符路径直接 import 会被当成包名。
        const mod = (await import(pathToFileURL(file).href)) as { default?: ExtModule } & ExtModule
        const entry = mod.default ?? mod
        if (!entry || typeof entry.activate !== 'function') return { ok: false, reason: '入口未导出 activate 函数' }
        return { ok: true, module: entry }
    } catch (err) {
        return { ok: false, reason: `入口加载失败：${err instanceof Error ? err.message : String(err)}` }
    }
}

/**
 * 收集全部候选：静态登记项（系统 / 内置）+ 磁盘发现项（外部）。
 *
 * 静态项先入，于是同 id 冲突时系统 / 内置优先 —— 一个外部扩展无法顶掉能力包装。
 * 被丢弃的项都会留下原因，供界面排查（静默丢弃一个扩展是排查噩梦）。
 */
async function collectCandidates(): Promise<{ ordered: Candidate[]; drops: Array<{ id: string; dir: string; kind: ExtKind; reason: string }>; }> {
    const candidates: Candidate[] = []
    const drops: Array<{ id: string; dir: string; kind: ExtKind; reason: string }> = []
    const seenIds = new Set<string>()

    const accept = (c: Candidate): void => {
        const m = c.manifest
        if (seenIds.has(m.id)) {
            drops.push({ id: m.id, dir: c.dir, kind: c.kind, reason: `id 与更早发现的扩展重复：${m.id}` })
            return
        }
        // API 版本：不匹配则跳过（宁可明确不加载，也不要跑起来一半才崩）。
        if (m.apiVersion !== undefined && m.apiVersion !== EXT_API_VERSION) {
            drops.push({ id: m.id, dir: c.dir, kind: c.kind, reason: `扩展 API 版本不兼容：需要 ${m.apiVersion}，当前 ${EXT_API_VERSION}` })
            return
        }
        seenIds.add(m.id)
        candidates.push(c)
    }

    // 1) 静态登记项。
    for (const s of staticExts()) {
        accept({ id: s.manifest.id, dependencies: s.manifest.dependencies, dir: s.sourceDir, kind: s.kind, manifest: s.manifest, module: s.module })
    }

    // 2) 磁盘上的外部扩展。
    for (const ext of discoverExternal()) {
        const parsed = readDiskManifest(ext.dir)
        if (!parsed.ok) {
            drops.push({ id: ext.dirName, dir: ext.dir, kind: 'external', reason: parsed.reason })
            continue
        }
        if (parsed.manifest.apiVersion !== undefined && parsed.manifest.apiVersion !== EXT_API_VERSION) {
            drops.push({ id: parsed.manifest.id, dir: ext.dir, kind: 'external', reason: `扩展 API 版本不兼容：需要 ${parsed.manifest.apiVersion}，当前 ${EXT_API_VERSION}` })
            continue
        }
        // 入口先不加载（放到真正激活时，避免为一个稍后被依赖判定丢弃的扩展做 IO）。
        accept({ id: parsed.manifest.id, dependencies: parsed.manifest.dependencies, dir: ext.dir, kind: 'external', manifest: parsed.manifest, module: null })
    }

    const sorted = topoSort(candidates)
    for (const d of sorted.dropped) {
        drops.push({ id: d.item.id, dir: d.item.dir, kind: d.item.kind, reason: d.reason })
    }
    return { ordered: sorted.ordered, drops }
}

/** 登记一条界面信息。 */
function putEntry(info: ExtInfo): void {
    state.entries.set(info.id, info)
}

/** 由候选构造基础界面信息（status 由调用方补）。 */
function baseInfo(c: Candidate, status: ExtStatus, message: string): ExtInfo {
    const info: ExtInfo = {
        id: c.id,
        name: c.manifest.name ?? c.id,
        version: c.manifest.version ?? '',
        kind: c.kind,
        status,
        message,
        capabilities: (c.manifest.capabilities ?? []) as ExtCapability[],
        dependencies: c.manifest.dependencies ?? [],
        dir: c.dir,
        removable: c.kind !== 'system'
    }
    // 贡献点随列表返回给渲染层（渲染层据此挂标签页与设置面板）。
    if (c.manifest.contributions) info.contributions = c.manifest.contributions
    return info
}

/**
 * 为一次扩展加载准备「已授权的能力动作表」。
 *
 * 只有**已提供**且**该扩展申请过**的能力才会进入它的 ctx —— 未提供的能力在这里
 * 静默剔除（消费方若允许缺失应用 `ctx.capabilities.has()` 判断，这是软依赖的落点）。
 */
function buildActions(granted: ReadonlySet<ExtCapability>): Map<string, Map<string, (...args: never[]) => unknown>> {
    const out = new Map<string, Map<string, (...args: never[]) => unknown>>()
    for (const name of granted) {
        const table = capability.actionsOf(name)
        if (!table) continue
        out.set(name, new Map(Object.entries(table)))
    }
    return out
}

/** 过滤出「申请过且当前已提供」的能力名（授权在这一步收敛）。 */
function grantOf(c: Candidate): Set<ExtCapability> {
    const requested = (c.manifest.capabilities ?? []) as ExtCapability[]
    return new Set(requested.filter((cap) => capability.has(cap)))
}

/**
 * 激活单个扩展。
 *
 * @returns 成功则返回装载记录；失败返回 null（原因已写入 state.reasons）
 */
async function activateOne(c: Candidate, granted: ReadonlySet<ExtCapability>): Promise<LoadedExt | null> {
    const id = c.id

    // 外部扩展此时才加载入口（静态扩展的 module 在收集阶段就拿到了）。
    let entry = c.module
    if (!entry) {
        const loaded = await loadDiskEntry(c.dir, c.manifest.main)
        if (!loaded.ok) {
            state.reasons[id] = loaded.reason
            putEntry(baseInfo(c, 'failed', loaded.reason))
            return null
        }
        entry = loaded.module
    }

    // ctx 的落点。注意所有登记都走 registry 记账 —— 卸载的完整性靠这里，不靠扩展自觉。
    const ctx = createContext({
        id,
        kind: c.kind,
        dir: c.dir,
        apiVersion: EXT_API_VERSION,
        granted,
        actions: buildActions(granted),
        registerIpc: (action, handler) => {
            const ports = state.ports
            if (!ports) throw new Error('加载器端口未安装')
            // 通道前缀由扩展 id 决定：扩展 A 的消息不可能落进扩展 B 的处理函数。
            // 直接返回落点给的撤销函数（摘路由）—— ctx 会把它交给注册表按 owner 记账。
            return ports.mountRoute('POST', `/ext/${id}/${action}`, handler)
        },
        emitToRenderer: (action, payload) => {
            state.ports?.emit(`${channelOf(id)}:${action}`, payload)
        },
        registerTab: (contribution) => {
            if (!isSafeContributionKey(contribution.key)) throw new Error(`标签页 key 非法：${contribution.key}`)
            // 主进程侧只需广播「列表变了」，渲染层重新拉取即得到新贡献 ——
            // 因此撤销动作也是同一条广播（渲染层据此把已消失的贡献摘掉）。
            state.ports?.emit('extensions:changed', null)
            return () => state.ports?.emit('extensions:changed', null)
        },
        registerPanel: (contribution) => {
            if (!isSafeContributionKey(contribution.key)) throw new Error(`设置面板 key 非法：${contribution.key}`)
            state.ports?.emit('extensions:changed', null)
            return () => state.ports?.emit('extensions:changed', null)
        }
    })

    // 把 manifest 里声明的贡献点也登记进去。
    // 声明式贡献点应等价于在 activate 里调用 ctx.tabs.register / ctx.settings.registerPanel，
    // 所以放同一张注册表：扩展若两处声明同一个 key，会撞上 registry 的查重而报错（配置错误）。
    try {
        registerDeclared(ctx, c)
    } catch (err) {
        releaseOwner(id)
        state.reasons[id] = `贡献点登记失败：${err instanceof Error ? err.message : String(err)}`
        putEntry(baseInfo(c, 'failed', state.reasons[id]))
        return null
    }

    try {
        await entry.activate(ctx)
    } catch (err) {
        // 激活失败：立刻归还它已经挂上的一半东西，避免留下指向半成品状态的端点。
        releaseOwner(id)
        state.reasons[id] = `激活失败：${err instanceof Error ? err.message : String(err)}`
        putEntry(baseInfo(c, 'failed', state.reasons[id]))
        return null
    }

    putEntry(baseInfo(c, 'active', ''))
    return { id, kind: c.kind, dir: c.dir, ctx, module: entry }
}

/** 登记 manifest 里声明的标签页与设置面板贡献点。 */
function registerDeclared(ctx: ExtContext, c: Candidate): void {
    const tabs: ExtTabContribution[] = c.manifest.contributions?.tabs ?? []
    for (const tab of tabs) ctx.tabs.register(tab)
    const panels: ExtSettingsContribution[] = c.manifest.contributions?.settings ?? []
    for (const panel of panels) ctx.settings.registerPanel(panel)
}

/** 把所有被丢弃的扩展也登记进 entries（界面要能看到「它被跳过了、为什么」）。 */
function recordDrops(drops: Array<{ id: string; dir: string; kind: ExtKind; reason: string }>): void {
    for (const d of drops) {
        putEntry({
            id: d.id,
            name: d.id,
            version: '',
            kind: d.kind,
            status: 'skipped',
            message: d.reason,
            capabilities: [],
            dependencies: [],
            dir: d.dir,
            removable: d.kind !== 'system'
        })
    }
}

// ---------------------------------------------------------------------------
// 对外流程
// ---------------------------------------------------------------------------

/**
 * 启动加载器。在 `runModuleReady()` 之后、建窗之前调用。
 *
 * 流程：
 *   1. 读盘状态；用崩溃计数判定是否进安全模式；
 *   2. 安全模式 → 外部 / 内置扩展记 `skipped`，系统扩展照常加载；
 *   3. 否则扫描 → 排序 → 逐个激活（失败只停它自己）；
 *   4. 全部成功则清空崩溃计数（这次启动是好的）。
 */
export async function startLoader(): Promise<ExtensionsInfo> {
    // 幂等前提：先清空全局注册表与能力槽。
    //
    // 这一步不能省。加载器持有的两张全局表（registry / capability）在重复启动时
    // 会留下上一次的条目 —— 系统扩展的 `provideActions` 于是撞上"能力重复提供"而全部
    // 变成 failed，表现为"退出安全模式重载后所有扩展一起坏"。正常退出路径有
    // `stopLoader()` 兜底，但重载（退出安全模式 / 手动刷新）不一定经过它，
    // 所以由启动侧保证"从干净状态开始"。
    registry.reset()
    capability.reset()

    state.loaded = []
    state.entries.clear()
    state.reasons = {}
    state.disk = loadState()

    const { ordered, drops } = await collectCandidates()

    // 判安全模式：只看非系统扩展的崩溃计数。
    const kinds: Record<string, ExtKind> = {}
    for (const c of ordered) kinds[c.id] = c.kind
    for (const d of drops) kinds[d.id] = d.kind
    const decision = decideSafeMode(state.disk.crashes, state.reasons, kinds)
    state.safeMode = decision.safeMode
    state.disk.safeModeReason = decision.safeMode ? decision.reason : undefined
    saveState(state.disk)

    let anyFailure = false
    const available = new Set<string>()

    for (const c of ordered) {
        // 安全模式：系统扩展仍加载，其余一律跳过。
        // 系统扩展是能力包装，禁掉等于内核能力凭空消失，因此不参与这一判定。
        if (state.safeMode && c.kind !== 'system') {
            putEntry(baseInfo(c, 'skipped', '安全模式：本次启动暂停加载内置 / 外部扩展'))
            continue
        }
        // 停用列表里的扩展不加载（系统扩展不受停用影响）。
        if (c.kind !== 'system' && state.disk.disabled.includes(c.id)) {
            putEntry(baseInfo(c, 'disabled', '已被停用'))
            continue
        }
        // 硬依赖缺失 → 不加载并报因（软依赖由扩展自己用 ctx.has() 降级）。
        const missing = missingDependencies(c.manifest, available)
        if (missing.length > 0) {
            state.reasons[c.id] = `缺少依赖扩展：${missing.join(', ')}`
            putEntry(baseInfo(c, 'skipped', state.reasons[c.id]))
            anyFailure = true
            // 系统扩展不参与崩溃计数。
            if (c.kind !== 'system') recordCrash(state.disk.crashes, c.id, state.reasons[c.id])
            continue
        }
        const loaded = await activateOne(c, grantOf(c))
        if (loaded) {
            state.loaded.push(loaded)
            available.add(c.id)
        } else if (c.kind !== 'system') {
            // 系统扩展的失败不记崩溃计数（它没有「反复崩就禁用」的语义）。
            anyFailure = true
            recordCrash(state.disk.crashes, c.id, state.reasons[c.id] ?? '未知错误')
        }
    }

    recordDrops(drops)

    // 这次启动是否有失败：有则保留计数（下次可能就够阈值了），没有则视为「这次好了」清零。
    if (!anyFailure) {
        clearCrashesAfterCleanBoot(state.disk.crashes)
    } else {
        const recheck = decideSafeMode(state.disk.crashes, state.reasons, kinds)
        if (recheck.safeMode) state.disk.safeModeReason = recheck.reason
    }
    saveState(state.disk)

    state.ports?.notifyChanged()
    return info()
}

/**
 * 停止加载器：逆序卸载（后建的先拆，与内核 `runQuit` 同语义）。
 *
 * 卸载一个扩展要做三件事，缺一不可：
 *   1. 调它的 `deactivate`（扩展自己的清理）；
 *   2. 执行它登记的 disposables（扩展忘了清的资源，加载器兜底）；
 *   3. 撤销它的全部贡献与能力（否则会留下指向已卸载代码的端点）。
 * 其中 2、3 由 `releaseOwner` 统一完成（registry 与 capability 都按 owner 记账）。
 */
export async function stopLoader(): Promise<void> {
    for (const item of reverseForUnload(state.loaded)) {
        try {
            await item.module.deactivate?.()
        } catch (err) {
            log.error({ err }, `${item.id} deactivate threw`)
        }
        try {
            releaseOwner(item.id)
        } catch (err) {
            log.error({ err }, `${item.id} failed to revoke contributions`)
        }
    }
    state.loaded = []
}

/** 组装对外返回的概要信息。 */
export function info(): ExtensionsInfo {
    const rank: Record<ExtKind, number> = { system: 0, builtin: 1, external: 2 }
    return {
        entries: [...state.entries.values()].sort((a, b) => rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id)),
        safeMode: state.safeMode,
        externalDir: externalRoot()
    }
}

/** 当前 channel（界面提示用）。 */
export function channel(): 'release' | 'dev' {
    return currentChannel()
}

/** 是否处于安全模式。 */
export function isSafeMode(): boolean {
    return state.safeMode
}

/** 清掉某扩展的崩溃计数与停用标记（用户在扩展页手动启用 / 重试时调用）。 */
export function forgive(id: string): void {
    delete state.disk.crashes[id]
    state.disk.disabled = state.disk.disabled.filter((x) => x !== id)
    saveState(state.disk)
}

/** 停用 / 启用某扩展（写盘；重启后生效）。系统扩展不可停用。 */
export function setEnabled(id: string, enabled: boolean): void {
    if (!enabled) {
        const kind = state.entries.get(id)?.kind
        if (kind === 'system') throw new Error('系统扩展不可停用')
    }
    const set = new Set(state.disk.disabled)
    if (enabled) set.delete(id)
    else set.add(id)
    state.disk.disabled = [...set]
    saveState(state.disk)
}

/** 退出安全模式（用户明确要求重试时调用；清空崩溃计数）。 */
export function exitSafeMode(): void {
    state.safeMode = false
    clearCrashesAfterCleanBoot(state.disk.crashes)
    state.disk.safeModeReason = undefined
    saveState(state.disk)
}

/** 暴露给界面的事实：外部扩展根目录（`GET /extensions` 用同一实现）。 */
export { externalRoot }
