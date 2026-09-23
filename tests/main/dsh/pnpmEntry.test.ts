import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PNPM_ENTRY_RELS, isPnpmPackageReady, pnpmEntryIn, pnpmEntryRel } from '@main/dsh/pnpmEntry'

/**
 * 内置 pnpm 的入口解析。
 *
 * 这里守的是一个踩过的坑：pnpm 12 起包结构变了 —— manifest 的 `bin.pnpm` 指向根级 `pnpm`
 * （一个 **sh 脚本**，node 直接跑会语法错误），真正的 JS 入口是 `bin/pnpm.mjs`。
 * 写死 `package/bin/pnpm.cjs` 会让「解压成功」被判成「缺少入口文件」（见 notes：2026-09-23）。
 */

const roots: string[] = []

/** 造一个假的 pnpm 版本目录；files 为相对该目录的路径列表。 */
function pkgDir(files: string[]): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm-entry-'))
    roots.push(root)
    for (const rel of files) {
        const p = path.join(root, rel)
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, '// stub\n')
    }
    return root
}

afterEach(() => {
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

describe('pnpmEntry', () => {
    it('pnpm 12+：认得 bin/pnpm.mjs（根级 pnpm 是 sh 脚本，不能当入口）', () => {
        const dir = pkgDir(['package/package.json', 'package/pnpm', 'package/bin/pnpm.mjs'])
        expect(pnpmEntryRel(dir)).toBe(path.join('package', 'bin', 'pnpm.mjs'))
        expect(pnpmEntryIn(dir)).toBe(path.join(dir, 'package', 'bin', 'pnpm.mjs'))
        expect(isPnpmPackageReady(dir)).toBe(true)
    })

    it('pnpm ≤ 11：认得 bin/pnpm.cjs', () => {
        const dir = pkgDir(['package/package.json', 'package/bin/pnpm.cjs'])
        expect(pnpmEntryRel(dir)).toBe(path.join('package', 'bin', 'pnpm.cjs'))
        expect(isPnpmPackageReady(dir)).toBe(true)
    })

    it('两个入口都在时优先 bin/pnpm.mjs', () => {
        const dir = pkgDir(['package/package.json', 'package/bin/pnpm.cjs', 'package/bin/pnpm.mjs'])
        expect(pnpmEntryRel(dir)).toBe(path.join('package', 'bin', 'pnpm.mjs'))
    })

    it('早期布局：package/dist/pnpm.cjs 也算入口', () => {
        const dir = pkgDir(['package/package.json', 'package/dist/pnpm.cjs'])
        expect(pnpmEntryRel(dir)).toBe(path.join('package', 'dist', 'pnpm.cjs'))
    })

    it('只有清单、没有入口 → 不算就绪，入口回落到首选路径（供调用方报缺少入口）', () => {
        const dir = pkgDir(['package/package.json'])
        expect(pnpmEntryRel(dir)).toBe(null)
        expect(pnpmEntryIn(dir)).toBe(path.join(dir, PNPM_ENTRY_RELS[0]))
        expect(isPnpmPackageReady(dir)).toBe(false)
    })

    it('空目录与不存在的目录 → 一律未就绪', () => {
        const empty = pkgDir([])
        expect(isPnpmPackageReady(empty)).toBe(false)
        expect(pnpmEntryRel(empty)).toBe(null)
        expect(isPnpmPackageReady(path.join(empty, 'not-exists'))).toBe(false)
    })
})
