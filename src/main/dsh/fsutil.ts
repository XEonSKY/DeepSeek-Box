import fs from 'node:fs'
import path from 'node:path'

/**
 * 主进程 / dsh 链路共用的文件系统小助手。
 *
 * 这些操作此前在 downloader / nodeenv / npmRunner / installs / tools 里各写一份，
 * 语义一致却分散，改一处漏一处。
 */

/**
 * 递归删除文件或目录，并**显式保证不跟随**其中的符号链接 / Windows 目录联接（junction）。
 *
 * 为什么不用 `fs.rmSync(dir, { recursive: true })`：dsh 与 pnpm 的安装目录里到处是链接
 * —— pnpm 在 Windows 上就是用 junction 组织 node_modules 布局的 —— 而「删版本目录 / 卸载 dsh」
 * 会整棵删掉它们。官方 desktop 为此单独写了一层 `removeOwnedDirectory`（链接只 unlink 自身、
 * 绝不进入目标），它注释里的理由是：Electron 侧的递归删除会把 junction 指向的资源一起删掉。
 *
 * 本机实测（Node 22 / Windows）`fs.rmSync(recursive)` **目前不会**跟随链接（含目标本身就是
 * junction、以及路径带尾部分隔符两种变体，目标内容都完好），所以这里的取舍不是「修 bug」，
 * 而是：**不依赖未写进契约的实现细节**，把语义写死并由单测锁住 —— 将来若把删除换成 rimraf、
 * shell 命令或别的平台实现，行为不会悄悄变。
 *
 * 语义边界与 `rmSync` 一致：目标不存在直接返回；普通文件与空目录正常删；
 * 被占用 / 无权限时抛错，交给调用方决定是静默（{@link removeQuietly}）还是上报。
 *
 * **为什么是 async**：一个版本目录动辄几万个小文件（node_modules），逐层同步
 * `readdirSync` + `rmSync` 会把主进程**独占地**占住几百毫秒到几秒 —— 期间界面完全没响应，
 * 正是「一些操作时整个程序会卡住」的主因之一。改成 promise 版后每删一批就让出事件循环，
 * IPC 与界面动画都能继续跑。语义与递归顺序保持完全不变（仍是「先删链接自身、不进目标」）。
 */
export async function removeTree(target: string): Promise<void> {
    const stat = await fs.promises.lstat(target).catch(() => null)
    if (!stat) return
    // 链接（含 junction）：只删链接自身，绝不删它指向的东西。
    if (stat.isSymbolicLink()) {
        await unlinkLink(target)
        return
    }
    if (!stat.isDirectory()) {
        await fs.promises.rm(target, { force: true })
        return
    }
    const entries = await fs.promises.readdir(target, { withFileTypes: true })
    for (const entry of entries) {
        const child = path.join(target, entry.name)
        if (entry.isSymbolicLink()) {
            await unlinkLink(child)
            continue
        }
        if (entry.isDirectory()) await removeTree(child)
        else await fs.promises.rm(child, { force: true })
    }
    await fs.promises.rmdir(target)
}

/** 删除链接自身：个别 Windows 环境下 junction 走 unlink 会失败，退一步用 rmdir。 */
async function unlinkLink(link: string): Promise<void> {
    try {
        await fs.promises.unlink(link)
    } catch {
        await fs.promises.rmdir(link)
    }
}

/**
 * 尽力删除文件或目录：目标不存在、被占用、无权限都静默返回。
 *
 * 删除流程里的清理动作不该把主流程带崩 —— 残留的临时文件下次会被覆盖。
 * 内部走 junction 安全的 {@link removeTree}，因此链接目标同样不会被误删。
 */
export async function removeQuietly(target: string): Promise<void> {
    try {
        await removeTree(target)
    } catch {
        /* 尽力而为 */
    }
}

/**
 * {@link removeQuietly} 的**同步**版本。
 *
 * 只给「启动期的同步迁移」这类无法 await 的场合用（如 installs.ts 的目录改名迁移，
 * 它整体是同步的，为一次删除把整条启动链改成 async 不划算）。业务热路径一律用异步版 ——
 * 同步删除是「操作时界面卡住」的根源之一。
 */
export function removeQuietlySync(target: string): void {
    try {
        const stat = fs.lstatSync(target, { throwIfNoEntry: false })
        if (!stat) return
        if (stat.isSymbolicLink()) unlinkLinkSync(target)
        else fs.rmSync(target, { recursive: true, force: true })
    } catch {
        /* 尽力而为 */
    }
}

/** 删除链接自身（同步版）：个别 Windows 环境下 junction 走 unlink 会失败，退一步用 rmdir。 */
function unlinkLinkSync(link: string): void {
    try {
        fs.unlinkSync(link)
    } catch {
        fs.rmdirSync(link)
    }
}

/** 读取 package.json 的 version 字段；文件不存在或格式不对返回 null。 */
export function readPkgVersion(pkgJsonPath: string): string | null {
    try {
        const v = (JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { version?: unknown }).version
        return typeof v === 'string' && v ? v : null
    } catch {
        return null
    }
}

/**
 * 路径是否存在（异步）。
 *
 * `fs.promises` 没有 `exists` 版，各处都写一遍 try/catch access —— 收敛到这里。
 * 不抛错：不存在与「无权限访问」都算「拿不到」，调用方据此走「跳过 / 回落」分支。
 */
export async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.promises.access(target)
        return true
    } catch {
        return false
    }
}
