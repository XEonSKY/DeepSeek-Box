import fs from 'node:fs'
import path from 'node:path'
import { removeTree, removeQuietly } from '../../../kernel/treeops'
import { provideActions } from '../../loader/capability'
import type { ExtContext } from '../../loader/ctx'

/**
 * 系统扩展 `system.fs` —— 把内核的文件操作**包装**成一个可申请的能力。
 *
 * 「系统扩展其实是系统能力抽象化的体现」的落点就在这里：内核本来就有一份唯一的
 * 整目录删除实现（`kernel/treeops` → `dsh/fsutil`，不跟随符号链接 / junction）；
 * 本扩展不做实现，只把它**按动作注册进能力槽**。于是：
 *
 *  - 外部扩展申请 `fs` 后拿到的是 `ctx.capabilities.call('fs', 'remove', p)`，
 *    而**不是** `fs.rmSync` —— 危险语义（递归、链接）被收在内核那份实现里，扩展开不出新口子；
 *  - 将来内核换删除实现（rimraf / 平台方案），扩展侧一行都不用改；
 *  - 一删扩展层，能力面就不存在了，外部扩展拿不到任何文件能力。
 *
 * 之所以还提供 `read/write` 这类常规动作：扩展常需要读写自己的配置，若不给就会诱使
 * 它们 `import fs` 绕开能力面 —— 那等于能力面名存实亡。给出的动作都限定为「按路径操作」，
 * 由扩展自己保证路径不出自己的目录。
 */

/** 动作表：动作名 → 实现。 */
const actions = {
    /** 读文本文件；不存在抛错（与 fs.readFileSync 一致）。 */
    read: (target: string): string => fs.readFileSync(target, 'utf8'),
    /** 读文本文件；不存在返回 null（便于扩展做「首次运行」判断）。 */
    readIfExists: (target: string): string | null => {
        try {
            return fs.readFileSync(target, 'utf8')
        } catch {
            return null
        }
    },
    /** 写文本文件（自动建父目录）。 */
    write: (target: string, content: string): void => {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, content, 'utf8')
    },
    /** 路径是否存在。 */
    exists: (target: string): boolean => fs.existsSync(target),
    /** 列目录名（不存在返回空数组，避免扩展为了「目录还没建」写 try/catch）。 */
    list: (target: string): string[] => {
        try {
            return fs.readdirSync(target)
        } catch {
            return []
        }
    },
    /** 创建目录（递归）。 */
    mkdir: (target: string): void => {
        fs.mkdirSync(target, { recursive: true })
    },
    /**
     * 删除文件 / 目录（递归，**不跟随链接与 junction**）。
     *
     * 绝不直接用 `fs.rmSync(recursive)` —— 统一走内核的 `removeTree`，
     * 这是「整目录删除只有一份实现」这条约束在扩展侧的延申。
     */
    remove: (target: string): Promise<void> => removeTree(target),
    /** 尽力删除（失败静默）：清理临时产物用。 */
    removeQuietly: (target: string): Promise<void> => removeQuietly(target),
    /** 文件 / 目录信息；不存在返回 null。 */
    stat: (target: string): { size: number; isDirectory: boolean; mtimeMs: number } | null => {
        try {
            const s = fs.statSync(target)
            return { size: s.size, isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs }
        } catch {
            return null
        }
    }
}

export function activate(ctx: ExtContext): void {
    // 能力槽按 owner 记账；卸载本扩展（或整体退出）时会连同这个能力一起撤销。
    provideActions(ctx.id, 'fs', actions as unknown as Record<string, (...args: never[]) => unknown>)
    ctx.log.info(`capability provided: fs (actions: ${Object.keys(actions).join(', ')})`)
}
