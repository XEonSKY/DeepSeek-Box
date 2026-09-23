import { isMap, isSeq, parseDocument } from 'yaml'
import type { YAMLMap, YAMLSeq } from 'yaml'

/**
 * dsh 的 **Cordis patch 层**（`cordis.patch.yml`）纯文本助手。
 *
 * 0.1.7 起 dsh 不再写 `settings.yaml`：插件配置全部落在 patch 层里，一个 patch
 * 文件是**顶层 YAML 数组**，每项是一条「按 id 寻址」的 loader 条目：
 *
 * ```yaml
 * - id: ui-theme                              # 目标条目 id（必需）
 *   name: '@deepseek-ai/dsh-client-ui-theme'   # 条目名（dsh 新建条目时会一并写入）
 *   config:                                    # 覆盖该条目的**整份** config
 *     preference: dark
 * - id: tool-ralph
 *   disabled: false                            # 只改 disabled
 * - insert: [ ... ]                            # 或追加一批新条目
 * ```
 *
 * 层的优先级（低 → 高）：
 *   bundle 层（`dsh.profile.bundles` 顺序）→ profile 自己的 `cordis.patch.yml`
 *   → `$DSH_HOME/cordis.patch.yml`（home 层，对每个 profile 生效）
 *   → `--patch` 覆盖层。
 * 同一 id 的**后一层整份替换**前一层的 `config`（不是字段级合并）；`disabled`
 * 则按「后层声明了才覆盖」处理，只写 config 的层不会把下层的 disabled 抹掉。
 *
 * 本模块只做纯文本处理（不碰 fs、不 import electron），便于单测；
 * 文件位置见 `dshHome.ts`，落盘入口见 `settings.ts` / `models.ts` / `ptcNodeSync.ts`。
 */

/** dsh 认的 patch 文件名（profile 层与 home 层同名，靠目录区分）。 */
export const PATCH_FILENAME = 'cordis.patch.yml'

/** 一条 patch 条目里本模块关心的字段（其余字段在写回时原样保留）。 */
export interface PatchEntry {
    id: string
    /** 条目名；dsh 新建条目时会写入，用户手写的行通常省略。 */
    name: string | null
    /** 是否停用；null = 该层没声明，沿用下层。 */
    disabled: boolean | null
    /** 该层的 config 覆盖；null = 该层没声明。 */
    config: Record<string, unknown> | null
}

/** 只接受「普通对象」：数组与 null 都不算。 */
function asRecord(v: unknown): Record<string, unknown> | null {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 从一条原始条目里读出我们关心的字段；无 id（例如纯 insert 行）返回 null。 */
function toEntry(raw: unknown): PatchEntry | null {
    const row = asRecord(raw)
    if (!row) return null
    const id = row.id
    if (typeof id !== 'string' || !id) return null
    const name = typeof row.name === 'string' ? row.name : null
    const disabled = typeof row.disabled === 'boolean' ? row.disabled : null
    return { id, name, disabled, config: asRecord(row.config) }
}

/**
 * 解析一个 patch 文件的文本。
 *
 * `entries` 是解析出的条目（`insert:` 列表里的条目一并展开）；`error` 非空表示
 * 这一层**整层不可用**（YAML 坏了，或顶层不是数组），此时 `entries` 为空。
 * 空文件 / 只有注释都算合法空层（`error` 为 null）。
 *
 * patch 是用户可手改的文件，所以调用方通常把 `error` 当作「这一层没有贡献」继续
 * 往下走；只有「模型」页那种需要给用户提示的场景才会把 `error` 冒出来。
 */
export function parsePatchLayer(text: string): { entries: PatchEntry[]; error: string | null } {
    const src = text ?? ''
    if (!src.trim()) return { entries: [], error: null }
    let rows: unknown
    try {
        const doc = parseDocument(src)
        if (doc.errors.length) return { entries: [], error: doc.errors[0].message }
        rows = doc.toJS()
    } catch (err) {
        return { entries: [], error: err instanceof Error ? err.message : String(err) }
    }
    // 空文档 / 只有注释：没有条目，但不是错误（doc.toJS() 此时给 null）。
    if (rows === null || rows === undefined) return { entries: [], error: null }
    if (!Array.isArray(rows)) return { entries: [], error: 'patch 顶层必须是 YAML 数组' }
    const out: PatchEntry[] = []
    for (const row of rows) {
        const plain = asRecord(row)
        // `insert:` 行本身不是条目，只展开它携带的条目列表。
        const inserted = plain?.insert
        if (Array.isArray(inserted)) {
            for (const item of inserted) {
                const e = toEntry(item)
                if (e) out.push(e)
            }
            continue
        }
        const e = toEntry(row)
        if (e) out.push(e)
    }
    return { entries: out, error: null }
}

/** 解析一个 patch 文件的文本为条目列表；整层不可用时返回 `[]`。 */
export function parsePatchEntries(text: string): PatchEntry[] {
    return parsePatchLayer(text).entries
}

/**
 * 按层顺序合成 patch 条目：入参**从低优先级到高优先级**排列（与 dsh 的层叠顺序一致），
 * 同 id 的后层覆盖前层 —— `config` 整份替换，`name` / `disabled` 只在后层声明时才覆盖。
 */
export function composePatchEntries(layers: readonly string[]): Map<string, PatchEntry> {
    const out = new Map<string, PatchEntry>()
    for (const layer of layers) {
        for (const e of parsePatchEntries(layer)) {
            const prev = out.get(e.id)
            if (!prev) {
                out.set(e.id, { ...e })
                continue
            }
            out.set(e.id, {
                id: e.id,
                name: e.name ?? prev.name,
                disabled: e.disabled ?? prev.disabled,
                config: e.config ?? prev.config
            })
        }
    }
    return out
}

/** 合成后的有效配置：`id → config`（只含声明了 config 的条目）。 */
export function composePatchConfig(layers: readonly string[]): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>()
    for (const [id, e] of composePatchEntries(layers)) {
        if (e.config) out.set(id, e.config)
    }
    return out
}

/** 读合成结果里某条目 config 的字符串字段；缺失 / 非字符串 / 空串都返回 null。 */
export function readConfigString(cfg: ReadonlyMap<string, Record<string, unknown>>, id: string, key: string): string | null {
    const v = cfg.get(id)?.[key]
    if (typeof v !== 'string') return null
    const s = v.trim()
    return s || null
}

/**
 * 在 patch 文本里合并某 id 的 config 字段（纯函数）。
 *
 * 为什么是「合并」而不是整文件重写：这些文件是**用户自己的** patch 层，里面有他们的
 * 条目与注释。dsh 的 patch 语义是按 id 替换目标行的 config，所以这里只动目标行：
 *  - 已有该行 → 只 set 我们负责的字段，同行其它字段（如 `fontSize`）保留；
 *  - 没有该行 → 追加一条（给了 `name` 就一并写上，与 dsh 新建条目的写法一致）；
 *  - 空文件 / 非序列 → 退化成只含这一条的 patch。
 *
 * 行匹配沿用 dsh config-editor 的规则：取**最后一条** `id` 相同、非 `insert`
 * 的条目；给了 `name` 时，还要求该行没有 name 或 name 相同（避免改到同名插件的
 * 另一个实例）。重复调用是幂等的，不会触发 dsh 的文件监听。
 */
export function mergePatchEntryConfig(text: string, id: string, fields: Record<string, unknown>, name?: string): string {
    const doc = parseDocument(text || '')
    const parsed = doc.contents
    // 必须用 doc.createNode 造节点：它带上文档 schema，setIn 才能自动补齐中间层。
    const seq: YAMLSeq = isSeq(parsed) ? (parsed as YAMLSeq) : (doc.createNode([]) as unknown as YAMLSeq)
    if (!isSeq(parsed)) doc.contents = seq as unknown as typeof doc.contents
    // 空模板是流式 `[]`；要追加条目就得切回块式，否则会挤成一行。
    if (seq.flow && seq.items.length === 0) seq.flow = false

    let row: YAMLMap | null = null
    for (const item of seq.items) {
        if (!isMap(item)) continue
        if (item.get('id') !== id || item.has('insert')) continue
        if (name !== undefined && item.has('name') && item.get('name') !== name) continue
        row = item as YAMLMap // 取最后一条命中
    }
    if (!row) {
        row = doc.createNode(name === undefined ? { id } : { id, name }) as unknown as YAMLMap
        seq.add(row)
    }
    for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) continue
        row.setIn(['config', key], value)
    }
    return doc.toString().replace(/\s+$/, '') + '\n'
}
