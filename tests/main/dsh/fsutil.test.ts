import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readPkgVersion, removeQuietly } from '@main/dsh/fsutil'

/**
 * 这两个助手被下载 / 解压 / 安装链路共用，之前每个模块各写一份。
 * 关键是**静默**：清理失败不能把主流程带崩，读版本失败不能抛异常。
 */

let dir: string

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbox-fsutil-'))
})

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
})

describe('removeQuietly', () => {
    it('删除已存在的文件', () => {
        const f = path.join(dir, 'a.txt')
        fs.writeFileSync(f, 'x')
        removeQuietly(f)
        expect(fs.existsSync(f)).toBe(false)
    })

    it('递归删除目录', () => {
        const d = path.join(dir, 'nested', 'deep')
        fs.mkdirSync(d, { recursive: true })
        fs.writeFileSync(path.join(d, 'x'), 'x')
        removeQuietly(path.join(dir, 'nested'))
        expect(fs.existsSync(path.join(dir, 'nested'))).toBe(false)
    })

    it('目标不存在时静默返回（force: true 语义）', () => {
        expect(() => removeQuietly(path.join(dir, 'nope'))).not.toThrow()
    })

    it('重复删除也不抛', () => {
        const f = path.join(dir, 'b.txt')
        fs.writeFileSync(f, 'x')
        removeQuietly(f)
        expect(() => removeQuietly(f)).not.toThrow()
    })
})

describe('readPkgVersion', () => {
    it('读取 package.json 的 version', () => {
        const f = path.join(dir, 'package.json')
        fs.writeFileSync(f, JSON.stringify({ name: 'x', version: '1.2.3' }))
        expect(readPkgVersion(f)).toBe('1.2.3')
    })

    it('文件不存在 → null', () => {
        expect(readPkgVersion(path.join(dir, 'missing.json'))).toBe(null)
    })

    it('不是合法 JSON → null（不抛异常）', () => {
        const f = path.join(dir, 'bad.json')
        fs.writeFileSync(f, '{ not json')
        expect(readPkgVersion(f)).toBe(null)
    })

    it('没有 version 字段 → null', () => {
        const f = path.join(dir, 'noversion.json')
        fs.writeFileSync(f, JSON.stringify({ name: 'x' }))
        expect(readPkgVersion(f)).toBe(null)
    })

    it('version 为空串或非字符串 → null', () => {
        const f = path.join(dir, 'empty.json')
        fs.writeFileSync(f, JSON.stringify({ version: '' }))
        expect(readPkgVersion(f)).toBe(null)
        fs.writeFileSync(f, JSON.stringify({ version: 123 }))
        expect(readPkgVersion(f)).toBe(null)
    })
})
