import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 版本号规范：`X.Y.Z-{alpha|beta|rc}.N`
 *
 * 语义化版本的主次修订三段正常递增，**预发布通道限定为 alpha / beta / rc 三种**，
 * 通道内序号从 .0 起递增（如 `0.1.6-alpha.2` → `0.1.6-alpha.3`）。
 * 遵守 semver 的字典序预发布规则，故升级链 alpha < beta < rc 天然正确。
 *
 * 这条约束散落在四处（package.json / package-lock.json 两处 / 技能 metadata），
 * 手改时最容易漏 —— 漏了的后果是「应用内显示的版本」与「Release tag」不一致，
 * 而 electron-updater 正是按版本号判断要不要升级的。用测试兜住。
 *
 * 本文件放在 tests/ 下而不是源码旁边，正是因为它**不测任何源码**：
 * 它约束的是仓库级规范（配置、文档、发布链路），属于集成层面的守护测试。
 */

/** 仓库根：从当前工作目录向上找带 package.json 的一层（vitest 以仓库根为 cwd）。 */
function repoRoot(): string {
    let dir = process.cwd()
    for (let i = 0; i < 5; i++) {
        if (fs.existsSync(path.join(dir, 'package.json'))) return dir
        dir = path.dirname(dir)
    }
    return process.cwd()
}

const ROOT = repoRoot()
const VERSION_RE = /^\d+\.\d+\.\d+-(alpha|beta|rc)\.(\d+)$/

function readJson(rel: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) as Record<string, unknown>
}

const pkg = readJson('package.json')
const lock = readJson('package-lock.json')
const version = pkg.version as string
const lockPackages = lock.packages as Record<string, { version?: string }>

describe('版本号规范', () => {
    it('package.json 的版本号符合 X.Y.Z-{alpha|beta|rc}.N', () => {
        expect(VERSION_RE.test(version)).toBe(true)
    })

    it('预发布通道只能是 alpha / beta / rc 三者之一', () => {
        const channel = version.split('-')[1]?.split('.')[0]
        expect(['alpha', 'beta', 'rc']).toContain(channel)
    })

    it('不带 v 前缀（v 只出现在 Git tag 上）', () => {
        expect(version.startsWith('v')).toBe(false)
    })

    it('三段数字都是非负整数（主次修订正常递增）', () => {
        const nums = version.split('-')[0].split('.')
        expect(nums).toHaveLength(3)
        for (const n of nums) expect(/^\d+$/.test(n)).toBe(true)
    })

    it('package-lock.json 顶层与 packages[""] 都同步了版本号', () => {
        expect(lock.version).toBe(version)
        expect(lockPackages[''].version).toBe(version)
    })

    it('技能 metadata.version 跟随应用版本', () => {
        const skill = fs.readFileSync(path.join(ROOT, '.agents/skills/deepseek-box/SKILL.md'), 'utf8')
        const m = /^metadata:[\s\S]*?^\s+version:\s*"([^"]+)"/m.exec(skill)
        expect(m, '未能在 SKILL.md 中找到 metadata.version').not.toBe(null)
        expect(m?.[1]).toBe(version)
    })

    it('是 prerelease（含 -），发布走 GitHub prerelease 通道', () => {
        expect(version).toContain('-')
    })
})

/**
 * 测试目录规范：单元测试统一收在 `tests/` 下，源码目录里不再出现 `*.test.ts`。
 *
 * 这条约束如果只写在文档里，迟早会有人顺手在源码旁边补一个测试文件 —— 单测本身能跑过，
 * 所以没有任何反馈告诉你规范破了。这里把它变成会红的测试。
 */
describe('测试目录规范', () => {
    const LAYERS = ['shared', 'main', 'renderer'] as const

    /** 递归收集目录下所有 .test.ts 的相对路径。 */
    function collect(dir: string, out: string[] = []): string[] {
        const abs = path.join(ROOT, dir)
        if (!fs.existsSync(abs)) return out
        for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
            const rel = path.posix.join(dir, entry.name)
            if (entry.isDirectory()) {
                // node_modules 等不可能是源码目录，跳过以免拖慢
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
                collect(rel, out)
            } else if (entry.name.endsWith('.test.ts')) {
                out.push(rel)
            }
        }
        return out
    }

    it('源码目录下不存在 *.test.ts（测试已独立到 tests/）', () => {
        expect(collect('src')).toEqual([])
    })

    it('tests/ 下至少存在 shared / main / renderer 三层测试目录', () => {
        for (const layer of LAYERS) {
            expect(fs.existsSync(path.join(ROOT, 'tests', layer)), `缺少 tests/${layer}`).toBe(true)
        }
    })

    it('vitest 的 include 指向 tests/ 而不是 src/', () => {
        const cfg = fs.readFileSync(path.join(ROOT, 'vitest.config.mjs'), 'utf8')
        expect(cfg).toContain("include: ['tests/**/*.test.ts']")
        expect(cfg).not.toContain("include: ['src/**/*.test.ts']")
    })
})
