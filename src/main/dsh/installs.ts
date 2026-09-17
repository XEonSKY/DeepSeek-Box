import path from 'node:path'
import fs from 'node:fs'
import { IS_WIN } from '../app/runtime'
import { configDir } from '../app/settings'
import type { InstallKind } from '@shared/types'
import { sortVersionsDesc } from './semver'
import { readPkgVersion } from './fsutil'

/**
 * 版本化安装目录：Node / npm / dsh 各自装到 `<configDir>/<kind>/<版本>/` 下，允许多版本并存；
 * `<root>/.active` 记录当前生效版本，切换版本只改指针、不重装。首次启动会把旧的平铺目录
 * （`<root>/node.exe`、`<root>/package`、`<root>/node_modules`）尽力迁移为版本化布局。
 */

/**
 * 各工具的安装根目录：`<configDir>/node|npm|dsh`。
 * `kernel` 是 dsh 目录的旧名，只在迁移里读一次（见 migrateLegacyDshDir）。
 */
export function installRoot(kind: InstallKind): string {
    return path.join(configDir(), kind)
}

/**
 * 目录改名迁移：`<configDir>/kernel` → `<configDir>/dsh`。
 * 目标已存在时逐项并入（通常是 .active 或个别版本目录），空的旧目录删掉；全程尽力而为。
 */
function migrateLegacyDshDir(): void {
    const legacy = path.join(configDir(), 'kernel')
    const target = path.join(configDir(), 'dsh')
    if (!fs.existsSync(legacy)) return
    try {
        if (!fs.existsSync(target)) {
            fs.renameSync(legacy, target)
            return
        }
        for (const name of fs.readdirSync(legacy)) {
            const from = path.join(legacy, name)
            const to = path.join(target, name)
            try {
                // 目标已有同名项：旧处这份是重复的（目标才是权威），直接删掉，
                // 免得留下一个半旧的 kernel 目录误导用户。
                if (fs.existsSync(to)) fs.rmSync(from, { recursive: true, force: true })
                else fs.renameSync(from, to)
            } catch {
                /* 被占用（如正在运行的 node.exe）：保留旧处，下次启动再试 */
            }
        }
        try {
            if (fs.readdirSync(legacy).length === 0) fs.rmdirSync(legacy)
        } catch {
            /* 清不掉就留着，不影响功能 */
        }
    } catch {
        /* 迁移失败不影响启动：读取侧会按新目录名重新解析 */
    }
}

/** 指定版本的安装目录。 */
export function versionDir(kind: InstallKind, version: string): string {
    return path.join(installRoot(kind), version)
}

function activeFile(kind: InstallKind): string {
    return path.join(installRoot(kind), '.active')
}

const VERSION_RE = /^v?\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/

/** 各安装类型的关键运行文件（相对版本目录）；缺了它就算「没装好」。 */
function keyRelPath(kind: InstallKind): string {
    if (kind === 'node') return IS_WIN ? 'node.exe' : path.join('bin', 'node')
    if (kind === 'npm') return path.join('package', 'bin', 'npm-cli.js')
    if (kind === 'pnpm') return path.join('package', 'bin', 'pnpm.cjs')
    return path.join('node_modules', '@deepseek-ai', 'dsh', 'package.json')
}

/**
 * 版本目录是否完整（含关键运行文件）。
 * 搬迁时被占用的文件（典型是正在运行的 node.exe）可能没能搬进来，这种残缺目录一律当作不存在，
 * 让读取侧回退到平铺旧布局，而不是直接报「未部署」。
 */
export function isVersionComplete(kind: InstallKind, version: string): boolean {
    try {
        return fs.existsSync(path.join(versionDir(kind, version), keyRelPath(kind)))
    } catch {
        return false
    }
}

/** `.active` 里的原始值（不校验目录），用于删除 / 修复时判断。 */
function rawActiveVersion(kind: InstallKind): string | null {
    try {
        const v = fs.readFileSync(activeFile(kind), 'utf8').trim()
        return v || null
    } catch {
        return null
    }
}

/** 当前生效版本（无指针、目录被删或目录不完整时返回 null）。 */
export function activeVersion(kind: InstallKind): string | null {
    const v = rawActiveVersion(kind)
    return v && isVersionComplete(kind, v) ? v : null
}

/** 写入当前生效版本；传 null 清除指针。 */
export function setActiveVersion(kind: InstallKind, version: string | null): void {
    const file = activeFile(kind)
    try {
        if (!version) {
            fs.rmSync(file, { force: true })
            return
        }
        fs.mkdirSync(installRoot(kind), { recursive: true })
        fs.writeFileSync(file, version + '\n')
    } catch {
        /* best effort */
    }
}

/** 已安装版本（新 → 旧）；只认版本号命名的子目录。 */
export function listInstalled(kind: InstallKind): string[] {
    let names: string[]
    try {
        names = fs.readdirSync(installRoot(kind))
    } catch {
        return []
    }
    const versions = names.filter((n) => VERSION_RE.test(n) && isVersionComplete(kind, n))
    return sortVersionsDesc(versions, true)
}

/** 生效版本；没有指针时回退到已安装的最新版本并写回指针。 */
export function resolveActive(kind: InstallKind): string | null {
    const active = activeVersion(kind)
    if (active) return active
    const list = listInstalled(kind)
    if (!list.length) return null
    setActiveVersion(kind, list[0])
    return list[0]
}

/** 准备一个空的版本目录（先清掉同名残留）。 */
export function prepareVersionDir(kind: InstallKind, version: string): string {
    const dir = versionDir(kind, version)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    return dir
}

/** 删除某个已安装版本；若删的是生效版本则自动切到剩余最新版。 */
export function removeVersion(kind: InstallKind, version: string): void {
    const wasActive = rawActiveVersion(kind) === version
    fs.rmSync(versionDir(kind, version), { recursive: true, force: true })
    if (wasActive) setActiveVersion(kind, listInstalled(kind)[0] ?? null)
}

/**
 * 把 root 下除版本目录 / 指针 / 临时目录外的内容搬进 root/<version>。
 *
 * 关键运行文件（node.exe / 内置 npm / dsh 包）排在第一位且必须真正落位：否则视为搬迁失败，
 * 不写 `.active`，让读取侧继续走平铺旧布局 —— 绝不产生「有指针、缺可执行文件」的残缺安装。
 */
function moveFlatInto(kind: InstallKind, version: string): boolean {
    const root = installRoot(kind)
    let entries: string[]
    try {
        entries = fs.readdirSync(root)
    } catch {
        return false
    }
    const movable = entries.filter((n) => n !== '.active' && !VERSION_RE.test(n) && !n.startsWith('.'))
    if (!movable.length) return false
    const dest = versionDir(kind, version)
    try {
        fs.mkdirSync(dest, { recursive: true })
    } catch {
        return false
    }
    const keyRel = keyRelPath(kind)
    const keyTop = keyRel.split(/[\\/]/)[0]
    const ordered = [keyTop, ...movable.filter((n) => n !== keyTop)]
    for (const n of ordered) {
        const from = path.join(root, n)
        if (!fs.existsSync(from)) continue
        const to = path.join(dest, n)
        try {
            if (fs.existsSync(to)) fs.rmSync(from, { recursive: true, force: true })
            else fs.renameSync(from, to)
        } catch {
            /* 被占用（如正在运行的 node.exe）：保留平铺，读取侧会回退 */
        }
    }
    return fs.existsSync(path.join(dest, keyRel))
}

/**
 * 旧版平铺布局 → 版本化布局（尽力而为，失败不影响使用：读取侧仍有平铺回退）。
 * 在应用启动、启动 dsh 之前调用一次。
 */
export async function migrateLegacyInstalls(probeNodeVersion: (exec: string) => Promise<string | null>): Promise<void> {
    // 先做目录改名（kernel → dsh），后面的平铺迁移与读取都基于新目录名。
    migrateLegacyDshDir()
    // Node：<root>/node.exe（Win）或 <root>/bin/node（*nix）直接躺在根目录。
    const root = installRoot('node')
    const exec = IS_WIN ? path.join(root, 'node.exe') : path.join(root, 'bin', 'node')
    if (fs.existsSync(exec) && !activeVersion('node')) {
        const raw = await probeNodeVersion(exec)
        const ver = raw?.trim()
        if (ver && moveFlatInto('node', ver)) setActiveVersion('node', ver)
    }
    // npm：<root>/package/... 平铺。
    const npmRoot = installRoot('npm')
    if (!activeVersion('npm') && fs.existsSync(path.join(npmRoot, 'package', 'bin', 'npm-cli.js'))) {
        const ver = readPkgVersion(path.join(npmRoot, 'package', 'package.json'))
        if (ver && moveFlatInto('npm', ver)) setActiveVersion('npm', ver)
    }
    // dsh：<root>/node_modules/@deepseek-ai/dsh 平铺。
    const dshRoot = installRoot('dsh')
    if (!activeVersion('dsh') && fs.existsSync(path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) {
        const ver = readPkgVersion(path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
        if (ver && moveFlatInto('dsh', ver)) setActiveVersion('dsh', ver)
    }
}
