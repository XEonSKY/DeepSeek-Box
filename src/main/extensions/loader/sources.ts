/**
 * 扩展**来源解析**：内置、外部、系统三个来源分别在哪、怎么扫。
 *
 * 这一层是加载器「发现」职责的实现，也是它不该属于内核的原因 ——
 * 内核不做目录扫描（对应 Minecraft 不扫描 mods 文件夹）。
 *
 * 三个来源，**两种获取方式** —— 这个差别决定了加载器的实现：
 *
 *  - 系统扩展 `src/main/extensions/system/` 与内置扩展 `src/main/extensions/builtin/`：
 *    随构建**编译进主进程 bundle**（electron-vite 把 `out/main` 打成单个 index.js），
 *    运行时磁盘上**没有**对应目录，因此它们由 {@link BUILTIN_TABLE} **静态登记**，
 *    不经过目录扫描。这也意味着它们受编译期检查、随版本发布，没有「半路坏掉」的风险。
 *  - 外部扩展 `~/.dsbox/{channel}/extensions/`：用户在磁盘上安装的独立目录，
 *    运行时 `import()` 加载，可装卸、可启停。
 *
 * 于是「扫描目录」只对外部扩展做；系统 / 内置扩展的存在性与顺序在构建期就确定了。
 *
 * `{channel}` 复用现成的配置目录约定（`release` / `dev`，由 `app.isPackaged` 决定，
 * 见 app/settings.ts 的 defaultConfigDir）。**这个隔离是现成收益**：开发态的扩展实验
 * 不会污染正式版，与 dev 用独立 userData 是同一套思路。
 */

import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { ExtKind, ExtManifest } from '@shared/extensions'
import { configDir } from '../../app/settings'
import type { ExtModule } from './ctx'

/** 一个已发现的扩展目录（尚未加载入口）。 */
export interface DiscoveredExt {
    /** 目录名（可能与 manifest 里的 id 不同；以 manifest 为准）。 */
    dirName: string
    /** 绝对路径。 */
    dir: string
    /** 来源级别。 */
    kind: ExtKind
}

/**
 * 静态登记的扩展（系统 / 内置）。
 *
 * 之所以要这张表而不是目录扫描：这些扩展进 bundle 后**在磁盘上没有独立目录**，
 * 扫描必然落空。表在这里，等于「编译期决定有哪些」，与「运行期加载用户代码」
 * 形成清晰的二分 —— 这也正是系统 / 内置与外部扩展的信任差异所在。
 */
export interface StaticExt {
    kind: ExtKind
    manifest: ExtManifest
    /** 入口模块。 */
    module: ExtModule
    /** 源码目录（仅作展示与排查，不参与加载）。 */
    sourceDir: string
}

/** 静态扩展登记表（由 extensions/index.ts 汇总后注入，避免本文件 import 具体扩展）。 */
let staticTable: StaticExt[] = []

/** 注入静态扩展表（在加载器启动前调用一次）。 */
export function installStaticExts(list: StaticExt[]): void {
    staticTable = list
}

/** 取静态登记的扩展（系统在前、内置在后，保证系统 id 优先）。 */
export function staticExts(): StaticExt[] {
    return [
        ...staticTable.filter((e) => e.kind === 'system'),
        ...staticTable.filter((e) => e.kind === 'builtin')
    ]
}

/**
 * 当前 channel：正式版 `release`、开发态 `dev`。
 *
 * 用 `app.isPackaged` 而不是读版本号后缀：它才是「这次运行是不是打包产物」的权威判据，
 * 与配置目录的默认位置取值同源（见 app/settings.ts），不会出现两处判断分歧。
 */
export function currentChannel(): 'release' | 'dev' {
    return app.isPackaged ? 'release' : 'dev'
}

/**
 * 外部扩展根目录：`~/.dsbox/{channel}/extensions`。
 *
 * 放在**配置目录内**（而不是 userData）的原因：配置目录是用户可自选、可迁移的位置，
 * 扩展跟着它走才符合直觉 —— 用户换配置目录时，扩展也一起过去。
 * 注意：`configDir()` 在「有待执行的迁移计划」时返回**旧目录**（见 settings.ts），
 * 所以迁移期间扩展仍从旧位置读，与 dsh 安装目录的行为一致。
 */
export function externalRoot(): string {
    return path.join(configDir(), 'extensions')
}

/** 列出外部扩展根目录下的候选（每个子目录 = 一个扩展）。 */
function listDirs(root: string): DiscoveredExt[] {
    let names: fs.Dirent[]
    try {
        names = fs.readdirSync(root, { withFileTypes: true })
    } catch {
        // 目录不存在是**正常情况**（比如用户从没装过外部扩展），不是错误。
        return []
    }
    const out: DiscoveredExt[] = []
    for (const entry of names) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue
        if (entry.name === 'node_modules') continue
        // 跳过没有清单的目录：那不是扩展（可能是构建残留、说明文档目录等）。
        if (!fs.existsSync(path.join(root, entry.name, 'manifest.json'))) continue
        out.push({ dirName: entry.name, dir: path.join(root, entry.name), kind: 'external' })
    }
    // 按目录名排序，保证同一台机器上每次加载顺序一致（不依赖 readdir 的偶然顺序）。
    out.sort((a, b) => a.dirName.localeCompare(b.dirName))
    return out
}

/** 只发现外部扩展（加载器的 `discoverAll` 与扩展页「刷新」时用）。 */
export function discoverExternal(): DiscoveredExt[] {
    return listDirs(externalRoot())
}

// ---------------------------------------------------------------------------
// 扩展数据目录：每个扩展一个专属文件夹，存放运行期产生的数据
// ---------------------------------------------------------------------------

/**
 * 扩展数据根：`~/.dsbox/{channel}/extensions/data`。
 *
 * 为什么在 `extensions` 下再加一层 `data/` 而不是直接 `extensions/<extId>/`：
 * `extensions/<extId>/` 是**外部扩展的安装目录**（代码），扩展扫描以「子目录里有
 * manifest.json」为准 —— 数据混进去有两个问题：与外部扩展代码目录同名冲突；
 * 卸载扩展时整目录删除会把用户数据一起带走。加 `data/` 一层后代码与数据分离，
 * 重装扩展数据仍在；`data` 目录没有 manifest.json，天然被扫描跳过。
 */
export function extensionDataRoot(): string {
    return path.join(externalRoot(), 'data')
}

/** 某扩展的专属数据目录（只算路径，不落盘；创建见 ensureExtDataDir）。 */
export function extDataDir(id: string): string {
    return path.join(extensionDataRoot(), id)
}

/**
 * 确保某扩展的数据目录存在并返回它。
 *
 * 懒创建：由 ctx 的 `dataDir` getter 在**扩展第一次访问**时调用，不用数据的扩展
 * 不会在磁盘上留下空目录。递归创建是幂等的，重复访问无害。
 */
export function ensureExtDataDir(id: string): string {
    const dir = extDataDir(id)
    fs.mkdirSync(dir, { recursive: true })
    return dir
}
