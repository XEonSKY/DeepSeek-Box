import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectPatchLayers, composeMountedConfig } from '@main/dsh/dshPatchLayers'

/**
 * dsh 有效 patch 层的收集（bundle 层 → profile 层 → home 层）。
 *
 * 这里守的是「模型页能看见默认供应商」这条底线：dsh 把开箱可用的默认值写在 **bundle** 里
 * （`dsh-base` 的 `agent-default-model: deepseek-official`、只有 id 没有 config 的
 * `llm-deepseek`），用户层只在覆盖时才出现。层序错、bundle 层漏掉、或「无 config 的条目」
 * 被丢掉，模型页就会错误地显示 0 个供应商。
 *
 * fixture 全部造在临时目录里，靠 `DSH_HOME` 指过去。
 */

const roots: string[] = []

/** 造一棵临时 harness home（含 profiles/web）与一个假的 dsh 安装 node_modules。 */
function fixture(): { home: string; install: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-layers-'))
    roots.push(root)
    const home = path.join(root, 'home')
    const install = path.join(root, 'install', 'node_modules')
    fs.mkdirSync(path.join(home, 'profiles', 'web'), { recursive: true })
    fs.mkdirSync(install, { recursive: true })
    vi.stubEnv('DSH_HOME', home)
    return { home, install }
}

/** 写文件并自动建目录。 */
function write(file: string, text: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
}

/** 在某个 node_modules 下造一个组合包：manifest 声明 dsh.bundle.patch，patch 文件由调用方给。 */
function writeBundle(install: string, name: string, patch: string | string[], bodies: string | string[]): void {
    const dir = path.join(install, ...name.split('/'))
    write(path.join(dir, 'package.json'), JSON.stringify({ name, dsh: { bundle: { patch } } }))
    const rels = Array.isArray(patch) ? patch : [patch]
    const texts = Array.isArray(bodies) ? bodies : rels.map(() => bodies as string)
    for (const [i, rel] of rels.entries()) write(path.join(dir, rel), texts[i])
}

/** 造一条标记用的 patch 层。 */
function markPatch(from: string): string {
    return `- id: mark\n  config:\n    from: ${from}\n`
}

afterEach(() => {
    vi.unstubAllEnvs()
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

describe('collectPatchLayers', () => {
    it('层序是 bundle → profile → home（后者优先级最高）', () => {
        const { home, install } = fixture()
        write(path.join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['pkg-a'] } } }))
        write(path.join(home, 'profiles', 'web', 'cordis.patch.yml'), markPatch('profile'))
        write(path.join(home, 'cordis.patch.yml'), markPatch('home'))
        writeBundle(install, 'pkg-a', './cordis.patch.yml', markPatch('bundle'))

        const { layers, parseError, bundleLayers } = collectPatchLayers(install)
        expect(parseError).toBe(false)
        expect(layers).toHaveLength(3)
        // bundle 层贡献数：模型页据此区分「dsh 未安装」与「装了但没配供应商」
        expect(bundleLayers).toBe(1)
        // home 层最后 → 同 id 覆盖前面所有层
        expect(composeMountedConfig(layers).cfg.get('mark')).toEqual({ from: 'home' })
    })

    it('bundle 名先到 dsh 安装目录里找，再找 profile 目录', () => {
        const { home, install } = fixture()
        write(path.join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dup'] } } }))
        writeBundle(install, 'dup', './cordis.patch.yml', markPatch('install'))
        writeBundle(path.join(home, 'profiles', 'web', 'node_modules'), 'dup', './cordis.patch.yml', markPatch('profile-nm'))

        const { layers } = collectPatchLayers(install)
        expect(layers).toEqual([markPatch('install')])
    })

    it('安装目录里没有的 bundle 落到 profile 自己的 node_modules', () => {
        const { home, install } = fixture()
        write(path.join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['only-in-profile'] } } }))
        writeBundle(path.join(home, 'profiles', 'web', 'node_modules'), 'only-in-profile', './cordis.patch.yml', markPatch('profile-nm'))

        expect(collectPatchLayers(install).layers).toEqual([markPatch('profile-nm')])
    })

    it('一个 bundle 声明多个 patch 文件时按声明顺序叠加', () => {
        const { home, install } = fixture()
        write(path.join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['multi'] } } }))
        writeBundle(install, 'multi', ['./a.yml', './b.yml'], [markPatch('a'), markPatch('b')])

        expect(collectPatchLayers(install).layers).toEqual([markPatch('a'), markPatch('b')])
    })

    it('profile manifest 缺失时回落到 dsh 的随附模板（web = base + web-app）', () => {
        const { install } = fixture() // 不写 profiles/web/package.json
        writeBundle(install, '@deepseek-ai/dsh-base', './cordis.patch.yml', markPatch('base'))
        writeBundle(install, '@deepseek-ai/dsh-web-app', './cordis.patch.yml', markPatch('web-app'))

        expect(collectPatchLayers(install).layers).toEqual([markPatch('base'), markPatch('web-app')])
    })

    it('用户层坏掉 → parseError；bundle 层坏掉只跳过自己', () => {
        const { home, install } = fixture()
        write(path.join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['broken', 'ok'] } } }))
        writeBundle(install, 'broken', './cordis.patch.yml', '[')
        writeBundle(install, 'ok', './cordis.patch.yml', markPatch('ok'))

        const clean = collectPatchLayers(install)
        expect(clean.parseError).toBe(false)
        expect(clean.layers).toEqual([markPatch('ok')])

        write(path.join(home, 'cordis.patch.yml'), '[')
        expect(collectPatchLayers(install).parseError).toBe(true)
    })

    it('解析不到 dsh 安装时只读用户层', () => {
        const { home } = fixture()
        write(path.join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['pkg-a'] } } }))
        write(path.join(home, 'cordis.patch.yml'), markPatch('home'))

        const userOnly = collectPatchLayers(null)
        expect(userOnly.layers).toEqual([markPatch('home')])
        expect(userOnly.bundleLayers).toBe(0)
    })

    it('解析不到的 bundle 被跳过，不影响其它层', () => {
        const { home, install } = fixture()
        write(path.join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['missing', 'pkg-a'] } } }))
        writeBundle(install, 'pkg-a', './cordis.patch.yml', markPatch('bundle'))

        expect(collectPatchLayers(install).layers).toEqual([markPatch('bundle')])
    })
})

describe('composeMountedConfig', () => {
    it('没有 config 的条目也入表（用空对象表示「已挂载、走默认值」）', () => {
        const { cfg } = composeMountedConfig(['- id: llm-deepseek\n  name: "@deepseek-ai/dsh-llm-deepseek"\n'])
        expect(cfg.has('llm-deepseek')).toBe(true)
        expect(cfg.get('llm-deepseek')).toEqual({})
    })

    it('收集被停用的条目', () => {
        const { cfg, disabled } = composeMountedConfig([
            '- id: llm-deepseek\n  disabled: true\n- id: keep\n  config:\n    a: 1\n'
        ])
        expect([...disabled]).toEqual(['llm-deepseek'])
        expect(cfg.get('keep')).toEqual({ a: 1 })
    })

    it('后层覆盖前层（config 整份替换，disabled 只在声明时覆盖）', () => {
        const { cfg, disabled } = composeMountedConfig([
            '- id: x\n  disabled: true\n  config:\n    a: 1\n    b: 2\n',
            '- id: x\n  config:\n    a: 9\n'
        ])
        expect(cfg.get('x')).toEqual({ a: 9 })
        expect([...disabled]).toEqual(['x'])
    })
})
