import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
    PATCH_FILENAME,
    composePatchConfig,
    composePatchEntries,
    mergePatchEntryConfig,
    parsePatchEntries,
    parsePatchLayer,
    readConfigString
} from '@main/dsh/cordisPatch'

/**
 * dsh 的 Cordis patch 层（`cordis.patch.yml`）纯文本助手。
 *
 * 这里守的是 dsh 真实的 patch 语义（见 dsh 源码 dsh-app-boot/profile、dsh-config-editor）：
 *  - 一个 patch 文件是顶层 YAML 数组，条目按 id 寻址；bundle 层还会用 `insert:` 批量插入；
 *  - 层叠顺序由调用方按「低 → 高」传入，同 id 的**后层整份替换** config；
 *  - `disabled` 只在后层显式声明时才覆盖，只写 config 的层不会把下层的 disabled 抹掉。
 *
 * 写回时还有一条硬要求：**绝不能破坏用户的条目与注释**（这些是用户手写的文件）。
 */

/** 从 patch 文本里读回某条目 config 的某字段（只用于不含 `!!js` 的用例）。 */
function readField(text: string, id: string, key: string): unknown {
    const rows = parse(text) as Array<{ id?: string; config?: Record<string, unknown> }> | null
    return rows?.find((r) => r.id === id)?.config?.[key]
}

describe('PATCH_FILENAME', () => {
    it('就是 dsh 认的 cordis.patch.yml', () => {
        expect(PATCH_FILENAME).toBe('cordis.patch.yml')
    })
})

describe('parsePatchLayer', () => {
    it('空文本与只有注释都算合法空层', () => {
        for (const text of ['', '   \n', '# 只有注释\n']) {
            expect(parsePatchLayer(text)).toEqual({ entries: [], error: null })
        }
    })

    it('坏 YAML / 顶层非数组 → 报错且条目为空（整层不可用）', () => {
        for (const text of ['[', 'a: 1\n', '{}', '"scalar"']) {
            const r = parsePatchLayer(text)
            expect(r.error, text).toBeTruthy()
            expect(r.entries, text).toEqual([])
        }
    })

    it('读出 id / name / disabled / config', () => {
        const text = [
            '- id: ui-theme',
            "  name: '@deepseek-ai/dsh-client-ui-theme'",
            '  config:',
            '    preference: dark',
            '- id: tool-ralph',
            '  disabled: false',
            ''
        ].join('\n')
        expect(parsePatchEntries(text)).toEqual([
            { id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme', disabled: null, config: { preference: 'dark' } },
            { id: 'tool-ralph', name: null, disabled: false, config: null }
        ])
    })

    it('展开 insert 列表（bundle 层的整套条目就是这么来的）', () => {
        const text = [
            '- insert:',
            '    - id: llm-deepseek',
            '      name: "@deepseek-ai/dsh-llm-deepseek"',
            '    - id: locale',
            '      name: "@deepseek-ai/dsh-client-locale"',
            '- id: ui-theme',
            '  config:',
            '    preference: system',
            ''
        ].join('\n')
        expect(parsePatchEntries(text).map((e) => e.id)).toEqual(['llm-deepseek', 'locale', 'ui-theme'])
    })

    it('没有 id 的行被忽略（insert 行本身不是条目）', () => {
        expect(parsePatchEntries('- config:\n    a: 1\n- id: ok\n')).toEqual([
            { id: 'ok', name: null, disabled: null, config: null }
        ])
    })
})

describe('composePatchEntries / composePatchConfig', () => {
    it('同 id 的后层整份替换 config（不是字段级合并）', () => {
        const merged = composePatchConfig(['- id: x\n  config:\n    a: 1\n    b: 2\n', '- id: x\n  config:\n    a: 9\n'])
        expect(merged.get('x')).toEqual({ a: 9 })
    })

    it('只写 config 的后层不会抹掉下层的 disabled / name', () => {
        const e = composePatchEntries([
            '- id: y\n  name: pkg-y\n  disabled: true\n  config:\n    a: 1\n',
            '- id: y\n  config:\n    a: 2\n'
        ]).get('y')
        expect(e).toEqual({ id: 'y', name: 'pkg-y', disabled: true, config: { a: 2 } })
    })

    it('后层显式声明 disabled 时覆盖下层', () => {
        const e = composePatchEntries(['- id: y\n  disabled: true\n', '- id: y\n  disabled: false\n']).get('y')
        expect(e?.disabled).toBe(false)
    })

    it('没有 config 的条目不出现在 composePatchConfig 里', () => {
        expect(composePatchConfig(['- id: llm-deepseek\n  name: pkg\n']).has('llm-deepseek')).toBe(false)
    })

    it('坏掉的层只丢自己，不影响其它层', () => {
        const merged = composePatchConfig(['- id: x\n  config:\n    a: 1\n', '[', '- id: z\n  config:\n    b: 2\n'])
        expect([...merged.keys()]).toEqual(['x', 'z'])
    })
})

describe('readConfigString', () => {
    it('取字符串并裁剪；缺失 / 非字符串 / 空串都返回 null', () => {
        const cfg = composePatchConfig(['- id: x\n  config:\n    s: "  zh  "\n    n: 3\n    e: "  "\n'])
        expect(readConfigString(cfg, 'x', 's')).toBe('zh')
        expect(readConfigString(cfg, 'x', 'n')).toBeNull()
        expect(readConfigString(cfg, 'x', 'e')).toBeNull()
        expect(readConfigString(cfg, 'x', 'missing')).toBeNull()
        expect(readConfigString(cfg, 'nope', 's')).toBeNull()
    })
})

describe('mergePatchEntryConfig', () => {
    it('空文件时新建一条，且以换行结尾', () => {
        const text = mergePatchEntryConfig('', 'locale', { preference: 'zh' }, '@deepseek-ai/dsh-client-locale')
        expect(readField(text, 'locale', 'preference')).toBe('zh')
        expect(text.endsWith('\n')).toBe(true)
    })

    it('profile patch 模板（注释 + 流式 []）追加条目不丢注释、不挤成一行', () => {
        const template = '# Your patch layer for this dsh profile:\n# overrides, disables, and insert lists.\n[]\n'
        const text = mergePatchEntryConfig(template, 'locale', { preference: 'zh' }, '@deepseek-ai/dsh-client-locale')
        expect(text).toContain('# Your patch layer for this dsh profile:')
        expect(text).toContain('- id: locale')
        // 流式空序列必须切回块式，否则会写成 `[]- id: ...` 这类畸形文本
        expect(text).not.toContain('[]')
        expect(readField(text, 'locale', 'preference')).toBe('zh')
    })

    it('已有同 id 行时原地更新，保留同行其它字段、name 与注释', () => {
        const before = [
            '# 用户自己的 patch',
            '- id: ui-theme',
            "  name: '@deepseek-ai/dsh-client-ui-theme'",
            '  config:',
            '    preference: system',
            '    fontSize: 15',
            ''
        ].join('\n')
        const text = mergePatchEntryConfig(before, 'ui-theme', { preference: 'dark' }, '@deepseek-ai/dsh-client-ui-theme')
        expect(text).toContain('# 用户自己的 patch')
        expect(readField(text, 'ui-theme', 'preference')).toBe('dark')
        expect(readField(text, 'ui-theme', 'fontSize')).toBe(15)
        expect(text).toContain("name: '@deepseek-ai/dsh-client-ui-theme'")
    })

    it('不动其它条目', () => {
        const before = '- id: keep-me\n  config:\n    a: 1\n'
        const text = mergePatchEntryConfig(before, 'locale', { preference: 'en' }, '@deepseek-ai/dsh-client-locale')
        expect(readField(text, 'keep-me', 'a')).toBe(1)
        expect(readField(text, 'locale', 'preference')).toBe('en')
    })

    it('幂等：同一值再合并一次文本不变（不触发 dsh 文件监听）', () => {
        const once = mergePatchEntryConfig('', 'locale', { preference: 'zh' }, '@deepseek-ai/dsh-client-locale')
        expect(mergePatchEntryConfig(once, 'locale', { preference: 'zh' }, '@deepseek-ai/dsh-client-locale')).toBe(once)
    })

    it('给了 name 时只匹配 name 相同（或没写 name）的那条', () => {
        const before = '- id: ui-theme\n  name: other-pkg\n  config:\n    preference: system\n'
        const text = mergePatchEntryConfig(before, 'ui-theme', { preference: 'dark' }, '@deepseek-ai/dsh-client-ui-theme')
        // 原条目（另一个同名插件实例）保持不动，另起一条
        expect(text.split('- id: ui-theme').length - 1).toBe(2)
        expect(readField(text, 'ui-theme', 'preference')).toBe('system')
    })

    it('取最后一条命中的行（与 dsh config-editor 的 row 选取规则一致）', () => {
        const before = '- id: x\n  config:\n    a: first\n- id: x\n  config:\n    a: last\n'
        const text = mergePatchEntryConfig(before, 'x', { a: 'new' })
        const rows = parse(text) as Array<{ id?: string; config?: Record<string, unknown> }>
        expect(rows.map((r) => r.config?.a)).toEqual(['first', 'new'])
    })

    it('拒绝把 insert 行当成目标条目', () => {
        const before = '- insert:\n    - id: ptc-runtime\n      name: pkg\n'
        const text = mergePatchEntryConfig(before, 'ptc-runtime', { nodeExecutable: 'C:/n/node.exe' })
        // insert 行保持不动，另外追加一条真条目
        expect(text).toContain('- insert:')
        expect(readField(text, 'ptc-runtime', 'nodeExecutable')).toBe('C:/n/node.exe')
    })

    it('含空格 / 反斜杠 / 单引号的路径往返后仍是原值', () => {
        for (const exec of ['C:\\Program Files\\nodejs\\node.exe', "/tmp/it's/node", 'C:\\a b\\c\\node.exe']) {
            expect(readField(mergePatchEntryConfig('', 'ptc-runtime', { nodeExecutable: exec }), 'ptc-runtime', 'nodeExecutable')).toBe(exec)
        }
    })

    it('保留其它条目里的 !!js 表达式（bundle 层常见的写法）', () => {
        const before = '- id: pwsh-sandbox\n  config:\n    timeoutMs: !!js process.env.X || 30000\n'
        const text = mergePatchEntryConfig(before, 'locale', { preference: 'zh' }, '@deepseek-ai/dsh-client-locale')
        expect(text).toContain('!!js process.env.X || 30000')
    })
})
