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
 * 扩展数据根：`~/.dsbox/{channel}/data/extensions`。
 *
 * 与 `extensions/`（外部扩展的**代码**安装目录）分开：代码随安装/卸载增删，
 * 数据要跨重装保留。放在配置目录的 `data/extensions` 下，每个扩展一个以
 * 扩展 id 命名的专属子目录（见 extDataDir）。
 */
export function extensionDataRoot(): string {
    return path.join(configDir(), 'data', 'extensions')
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

// ---------------------------------------------------------------------------
// 压缩包形态的外部扩展（*.zip / *.xeonsky-ext）
// ---------------------------------------------------------------------------

/**
 * 压缩包扩展的**暂存目录**：`~/.dsbox/{channel}/.remapper/extensions/<包名>/`。
 *
 * 为什么不放 `extensions/` 下：那是用户手装**文件夹扩展**的领地，自动解压产物混进去
 * 会与用户目录混淆，也可能被当成手装扩展。`.remapper/extensions` 独立成区，每次启动
 * 都会从包文件**重新解压覆盖** —— 包文件是权威来源，改包后刷新即生效。
 */
export function pkgStagingRoot(): string {
    return path.join(configDir(), '.remapper', 'extensions')
}

/** 外部扩展包文件的扩展名（大小写不敏感；`.xeonsky-ext` 是本项目的 zip 变种）。 */
export const PKG_EXTENSIONS = ['.zip', '.xeonsky-ext'] as const

/** 一个已发现的压缩包扩展（文件名去掉扩展名即包名）。 */
export interface DiscoveredPkg {
    /** 包文件绝对路径。 */
    file: string
    /** 包名（文件名去掉扩展名，解压暂存目录用它）。 */
    stem: string
}

/** 列出外部扩展根目录下的压缩包（*.zip / *.xeonsky-ext，按文件名排序）。 */
export function discoverPkgs(): DiscoveredPkg[] {
    let names: fs.Dirent[]
    try {
        names = fs.readdirSync(externalRoot(), { withFileTypes: true })
    } catch {
        return []
    }
    const out: DiscoveredPkg[] = []
    for (const entry of names) {
        if (!entry.isFile()) continue
        const lower = entry.name.toLowerCase()
        const hit = PKG_EXTENSIONS.find((ext) => lower.endsWith(ext))
        if (!hit) continue
        // stem 保留原始大小写（解压目录用它）；多扩展名条目取最长命中，避免 .xeonsky-ext 被截断出怪名。
        out.push({ file: path.join(externalRoot(), entry.name), stem: entry.name.slice(0, -hit.length) })
    }
    out.sort((a, b) => a.stem.localeCompare(b.stem) || a.file.localeCompare(b.file))
    return out
}
