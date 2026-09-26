import path from 'node:path'
import { IS_WIN } from '../kernel/runtime'
import { pathEnv, findInDirs } from './tools'
import { runChild } from './child'
import { pushLog } from './logbus'

/**
 * 系统 tar 的定位与调用：内置 npm / pnpm 都是「下载 tarball → 解压到版本目录」，
 * 两个 runner 原先各自复制了一份实现，收敛到这里。
 *
 * Windows 10+ 自带 `tar.exe`（System32），类 Unix 走 PATH 上的 `tar`。
 */

/** 定位系统 tar（Windows 会额外看 System32）。 */
export function findSystemTar(): string | null {
    const dirs = pathEnv()
    const names = IS_WIN ? ['tar.exe', 'tar'] : ['tar']
    if (IS_WIN) dirs.push(path.join(process.env.WINDIR || 'C:\\Windows', 'System32'))
    return findInDirs(dirs, names) ?? null
}

/**
 * 解压 tar.gz 到目标目录；取消时杀掉子进程。
 *
 * `label` 用于日志前缀（如 `npm` / `pnpm`），仅作展示，不影响行为。
 */
export function extractTar(tgz: string, dest: string, label: string, signal?: AbortSignal): Promise<boolean> {
    const tar = findSystemTar()
    if (!tar) return Promise.resolve(false)
    pushLog('o', `[Manager] 解压 ${label} 压缩包…`)
    return runChild(tar, { argv: ['-xzf', tgz, '-C', dest], onStderr: (s) => pushLog('e', s) }, signal).then((r) => r.ok)
}
