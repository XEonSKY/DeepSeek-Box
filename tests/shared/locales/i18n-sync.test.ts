import { describe, expect, it } from 'vitest'
import zh from '@shared/locales/zh'
import en from '@shared/locales/en'
import hant from '@shared/locales/zh/hant'

/**
 * i18n 的硬约束是 **zh / en 逐键对齐**（hant 只是差异覆盖目录，无需同步补充）。
 * 测试守住：en 覆盖 zh 的全部键、en 不多余、hant 只做子集覆盖（含占位符一致）——
 * 漏掉一处时 CI 直接红，而不是等切到英文才发现界面里冒出一串 key。
 */

type Dict = Record<string, unknown>

/** 收集所有叶子路径（点分）。 */
function leafPaths(node: unknown, prefix = ''): string[] {
    if (node === null || typeof node !== 'object') return prefix ? [prefix] : []
    const out: string[] = []
    for (const [k, v] of Object.entries(node as Dict)) {
        const path = prefix ? prefix + '.' + k : k
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v, path))
        else out.push(path)
    }
    return out
}

/** 收集所有占位符名（{name}）。 */
function placeholders(node: unknown, prefix = ''): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    if (node === null || typeof node !== 'object') return out
    for (const [k, v] of Object.entries(node as Dict)) {
        const path = prefix ? prefix + '.' + k : k
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            for (const [p, set] of placeholders(v, path)) out.set(p, set)
        } else if (typeof v === 'string') {
            out.set(path, new Set([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))
        }
    }
    return out
}

const zhPaths = leafPaths(zh)
const enPaths = leafPaths(en)
const hantPaths = leafPaths(hant)

describe('翻译目录（zh / en / hant）', () => {
    it('三份目录都不为空（防止 import 路径写错导致静默变空）', () => {
        expect(zhPaths.length).toBeGreaterThan(100)
        expect(enPaths.length).toBeGreaterThan(100)
        expect(hantPaths.length).toBeGreaterThan(0)
    })

    it('en 覆盖 zh 的全部键', () => {
        const missing = zhPaths.filter((p) => !enPaths.includes(p))
        expect(missing).toEqual([])
    })

    it('en 没有多余的键（多余的键往往意味着 zh 那边漏加）', () => {
        const extra = enPaths.filter((p) => !zhPaths.includes(p))
        expect(extra).toEqual([])
    })

    it('hant 是差异目录：键必须是 zh 的子集', () => {
        const unknown = hantPaths.filter((p) => !zhPaths.includes(p))
        expect(unknown).toEqual([])
    })

    it('同一路径在 zh / en 中的占位符集合一致（否则传参会少一个值）', () => {
        const zhPh = placeholders(zh)
        const enPh = placeholders(en)
        const mismatched: string[] = []
        for (const [path, set] of zhPh) {
            const other = enPh.get(path)
            if (!other) continue
            const a = [...set].sort().join(',')
            const b = [...other].sort().join(',')
            if (a !== b) mismatched.push(path + ': zh={' + a + '} en={' + b + '}')
        }
        expect(mismatched).toEqual([])
    })

    it('hant 覆盖的键必须保留 zh 的占位符（覆盖文案时容易漏掉 {err}）', () => {
        const zhPh = placeholders(zh)
        const hantPh = placeholders(hant)
        const mismatched: string[] = []
        for (const [path, set] of hantPh) {
            const base = zhPh.get(path)
            if (!base) continue
            const a = [...base].sort().join(',')
            const b = [...set].sort().join(',')
            if (a !== b) mismatched.push(path + ': zh={' + a + '} hant={' + b + '}')
        }
        expect(mismatched).toEqual([])
    })

    it('不存在空文案（空串会渲染成一片空白，比显示 key 更难排查）', () => {
        const empties: string[] = []
        const scan = (node: unknown, prefix: string): void => {
            if (node === null || typeof node !== 'object') return
            for (const [k, v] of Object.entries(node as Dict)) {
                const path = prefix ? prefix + '.' + k : k
                if (typeof v === 'string') {
                    if (v.trim() === '') empties.push(path)
                } else if (v !== null && typeof v === 'object') scan(v, path)
            }
        }
        scan(zh, 'zh')
        scan(en, 'en')
        expect(empties).toEqual([])
    })
})
