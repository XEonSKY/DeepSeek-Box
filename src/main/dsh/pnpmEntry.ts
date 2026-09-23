import fs from 'node:fs'
import path from 'node:path'

/**
 * 内置 pnpm 的入口解析（**纯逻辑**：只碰 fs，不 import electron，便于单测）。
 *
 * pnpm 的包结构在 12.0 变过，**别按固定文件名写死**：
 *
 * | pnpm | manifest 的 `bin.pnpm` | 真正的 JS 入口 |
 * |---|---|---|
 * | ≤ 11 | `bin/pnpm.cjs` | `package/bin/pnpm.cjs` |
 * | 12+ | `pnpm`（**根级 sh 脚本**，node 跑它直接 `SyntaxError`） | `package/bin/pnpm.mjs`（自己找/下载平台原生二进制） |
 *
 * 所以**不能盲信 `bin` 字段**（它可能指向 shell 脚本），只能按已知的 JS 入口候选依次探测。
 * 早先写死 `package/bin/pnpm.cjs`，在 pnpm 12 上会「解压成功却找不到入口文件」。
 */

/** pnpm 包内可能的 JS 入口（相对版本目录），按优先级排列。 */
export const PNPM_ENTRY_RELS: readonly string[] = [
    path.join('package', 'bin', 'pnpm.mjs'), // pnpm 12+
    path.join('package', 'bin', 'pnpm.cjs'), // pnpm ≤ 11
    path.join('package', 'dist', 'pnpm.cjs') // 更早期的布局
]

/** pnpm 包清单（相对版本目录）：任何版本都有，用来判断「这是个完整的 pnpm 包」。 */
export const PNPM_MANIFEST_REL = path.join('package', 'package.json')

/** 版本目录里首个存在的入口（相对路径）；都没有时返回 null。 */
export function pnpmEntryRel(dir: string): string | null {
    for (const rel of PNPM_ENTRY_RELS) {
        try {
            if (fs.existsSync(path.join(dir, rel))) return rel
        } catch {
            /* 权限等问题一律按「不存在」处理 */
        }
    }
    return null
}

/**
 * pnpm 入口的绝对路径：取首个存在的候选；都不存在时返回首选路径，
 * 调用方的 `existsSync(cli)` 因此判 false 并报「缺少入口文件」。
 */
export function pnpmEntryIn(dir: string): string {
    return path.join(dir, pnpmEntryRel(dir) ?? PNPM_ENTRY_RELS[0])
}

/** 版本目录里是不是一个完整可用的 pnpm 包（有清单 + 有任一 JS 入口）。 */
export function isPnpmPackageReady(dir: string): boolean {
    try {
        if (!fs.existsSync(path.join(dir, PNPM_MANIFEST_REL))) return false
    } catch {
        return false
    }
    return pnpmEntryRel(dir) !== null
}
