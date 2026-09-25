import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readPkgVersion, removeQuietly, removeQuietlySync, removeTree } from '@main/dsh/fsutil'

/**
 * 这几个助手被下载 / 解压 / 安装链路共用，之前每个模块各写一份。
 * 关键是**静默**：清理失败不能把主流程带崩，读版本失败不能抛异常。
 *
 * removeTree / removeQuietly 是 **async**：一个版本目录动辄几万个小文件，
 * 同步 `rmSync` 会把主进程独占住几百毫秒到几秒（界面完全没响应）。这里顺带锁住
 * 「返回 Promise」这个契约 —— 谁把它改回同步，用例立刻红。
 */

let dir: string

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbox-fsutil-'))
})

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
})

describe('removeQuietly', () => {
    it('删除已存在的文件', async () => {
        const f = path.join(dir, 'a.txt')
        fs.writeFileSync(f, 'x')
        await removeQuietly(f)
        expect(fs.existsSync(f)).toBe(false)
    })

    it('递归删除目录', async () => {
        const d = path.join(dir, 'nested', 'deep')
        fs.mkdirSync(d, { recursive: true })
        fs.writeFileSync(path.join(d, 'x'), 'x')
        await removeQuietly(path.join(dir, 'nested'))
        expect(fs.existsSync(path.join(dir, 'nested'))).toBe(false)
    })

    it('目标不存在时静默返回（force: true 语义）', async () => {
        await expect(removeQuietly(path.join(dir, 'nope'))).resolves.toBeUndefined()
    })

    it('重复删除也不抛', async () => {
        const f = path.join(dir, 'b.txt')
        fs.writeFileSync(f, 'x')
        await removeQuietly(f)
        await expect(removeQuietly(f)).resolves.toBeUndefined()
    })
})

/**
 * 同步版本只给「启动期无法 await 的同步迁移」用（installs.ts 的目录改名迁移）。
 * 它必须同样静默，且同样不跟随链接。
 */
describe('removeQuietlySync', () => {
    it('删除文件 / 目录，目标不存在也静默', () => {
        const f = path.join(dir, 'sync.txt')
        fs.writeFileSync(f, 'x')
        removeQuietlySync(f)
        expect(fs.existsSync(f)).toBe(false)

        const d = path.join(dir, 'sync-dir')
        fs.mkdirSync(path.join(d, 'sub'), { recursive: true })
        fs.writeFileSync(path.join(d, 'sub', 'x.txt'), 'x')
        removeQuietlySync(d)
        expect(fs.existsSync(d)).toBe(false)

        expect(() => removeQuietlySync(path.join(dir, 'missing'))).not.toThrow()
    })

    it('不跟随目录链接（只删链接自身）', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbox-fsutil-sync-link-'))
        try {
            fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
            const holder = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbox-fsutil-sync-holder-'))
            try {
                const link = path.join(holder, 'link-to-outside')
                if (!tryLinkDir(outside, link)) return
                removeQuietlySync(holder)
                expect(fs.existsSync(holder)).toBe(false)
                // 关键断言：链接目标完好无损
                expect(fs.existsSync(path.join(outside, 'keep.txt'))).toBe(true)
            } finally {
                fs.rmSync(holder, { recursive: true, force: true })
            }
        } finally {
            fs.rmSync(outside, { recursive: true, force: true })
        }
    })
})

/**
 * 递归删除**不得跟随目录链接**（符号链接 / Windows 目录联接 junction）。
 *
 * 为什么单独钉死：dsh 与 pnpm 的安装目录里到处是链接（pnpm 在 Windows 上就是用 junction
 * 组织 node_modules 布局的），而「删版本目录 / 卸载 dsh」是常见操作 —— 这两个目录一旦被
 * 顺着链接删进去，动到的就是链接**指向的目标**（用户另一个目录、或全局 store）。
 *
 * 实测背景（Node 22 / Windows）：`fs.rmSync(recursive)` 目前并不跟随链接，因此这组用例是
 * **回归护栏**而非现存 bug 的复现 —— 它们把「链接只 unlink」的语义钉在实现上，将来换成
 * rimraf / shell 删除或跨平台实现时，越界会被立刻发现。
 *
 * 用例造真实目录与真实链接（不是 mock）：`fs.symlinkSync(target, link, 'junction')` 在
 * Windows 上无需管理员权限即可建目录联接，在类 Unix 上落成目录符号链接，两边都能验证。
 */

const linkRoots: string[] = []

/** 额外临时目录 —— 一个用例往往需要「被删的树」与「链接目标」两处。 */
function extraTmp(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dsbox-fsutil-link-'))
    linkRoots.push(d)
    return d
}

afterEach(() => {
    for (const r of linkRoots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

/** 造一棵小目录树：root/{a.txt, sub/{b.txt}}。 */
function treeWithFiles(root: string): void {
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a.txt'), 'a')
    fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'b')
}

/** 建目录链接；当前平台不允许时返回 false（用例据此跳过）。 */
function tryLinkDir(target: string, link: string): boolean {
    try {
        fs.symlinkSync(target, link, 'junction')
        return fs.lstatSync(link).isSymbolicLink()
    } catch {
        return false
    }
}

describe('removeTree', () => {
    it('删掉整棵目录树', async () => {
        const root = extraTmp()
        treeWithFiles(root)
        await removeTree(root)
        expect(fs.existsSync(root)).toBe(false)
    })

    it('目标不存在时静默返回', async () => {
        await expect(removeTree(path.join(extraTmp(), 'not-there'))).resolves.toBeUndefined()
    })

    it('删掉普通文件', async () => {
        const root = extraTmp()
        const file = path.join(root, 'x.txt')
        fs.writeFileSync(file, 'x')
        await removeTree(file)
        expect(fs.existsSync(file)).toBe(false)
    })

    it('目录里的链接只删链接，目标内容原样保留', async () => {
        const outside = extraTmp()
        treeWithFiles(outside)
        const root = extraTmp()
        treeWithFiles(root)
        if (!tryLinkDir(outside, path.join(root, 'linked'))) return

        await removeTree(root)

        expect(fs.existsSync(root)).toBe(false)
        // 关键断言：链接目标完好无损
        expect(fs.existsSync(path.join(outside, 'a.txt'))).toBe(true)
        expect(fs.existsSync(path.join(outside, 'sub', 'b.txt'))).toBe(true)
    })

    it('深层嵌套目录里的链接同样不动目标', async () => {
        const outside = extraTmp()
        fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
        const root = extraTmp()
        const nested = path.join(root, 'a', 'b', 'c')
        fs.mkdirSync(nested, { recursive: true })
        if (!tryLinkDir(outside, path.join(nested, 'deep-link'))) return

        await removeTree(root)

        expect(fs.existsSync(root)).toBe(false)
        expect(fs.existsSync(path.join(outside, 'keep.txt'))).toBe(true)
    })

    it('目标本身就是链接时只删链接、不动目标', async () => {
        const outside = extraTmp()
        fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep')
        const holder = extraTmp()
        const link = path.join(holder, 'link-to-outside')
        if (!tryLinkDir(outside, link)) return

        await removeTree(link)

        expect(fs.existsSync(link)).toBe(false)
        expect(fs.existsSync(path.join(outside, 'keep.txt'))).toBe(true)
    })

    it('悬空链接（目标已不在）也能删掉', async () => {
        const holder = extraTmp()
        if (!tryLinkDir(path.join(holder, 'missing-target'), path.join(holder, 'dangling'))) return
        treeWithFiles(holder)
        await removeTree(holder)
        expect(fs.existsSync(holder)).toBe(false)
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
