/**
 * 扩展 `xeonsky.zip` 的**纯逻辑**：平台判定、发行包选择、命令行组装、输出解析。
 *
 * 为什么单独成文件：本仓库没有单元测试，**纯逻辑是唯一能被 typecheck 有效覆盖的形态**；
 * 且这段逻辑是「7-Zip 到底怎么调」的单一事实来源，出错的代价很高
 * （拼错一个开关就会静默压出错误的包）。所以把不依赖 fs / electron 的部分全部挪到这里，
 * `main.ts` 只留 I/O 与编排。
 *
 * 三段职责：
 *  1. {@link resolveTarget} —— 当前平台该下哪一份 7-Zip 官方包；
 *  2. {@link buildCompressArgs} / {@link buildExtractArgs} —— 选项 → argv（含分卷 / 密码 / 算法）；
 *  3. {@link parseArchiveListing} —— `7z l -slt` 输出 → 结构化条目。
 */

import { ARCHIVE_FORMATS, COMPRESSION_METHODS, type ArchiveEntry, type ArchiveListing, type CompressOptions, type ExtractOptions, type SevenZipTarget } from './types'

// ---------------------------------------------------------------------------
// 平台 → 官方发行包
// ---------------------------------------------------------------------------

/**
 * 内置的 7-Zip 命令行核心（7-Zip 26.03，LGPL）。
 *
 * 二进制**随扩展内置**（`src/extensions/xeonsky.zip/bin/<平台>/`），不再运行时下载：
 *  - **Windows**：取官方 `-extra.7z` 里的命令行核心 —— `7za.exe` + 它的两个 DLL
 *    （`7za.dll` / `7zxa.dll`，同一个目录里缺一不可），x64 与 arm64 各一套原生版；
 *  - **Linux**：官方 `linux-x64` / `linux-arm64` 包里的 `7zz`（统一命令行二进制）；
 *  - **macOS**：官方 `mac` 包里的 `7zz`（通用二进制，x64 与 arm64 共用一份）。
 *
 * 由官方 `https://www.7-zip.org/download.html` 指向的分发包取得（镜像仓库
 * ip7z/7zip 的 26.03 release），许可证见同目录 `7zip-LICENSE.txt`。
 *
 * 布局由 `dir`（bin 下的子目录）与 `binary`（可执行文件名）共同描述；
 * 「bin 目录在磁盘上的绝对路径」由 main.ts 解析（打包后相对应用根）。
 */
export const BUNDLED_VERSION = '26.03'

export const TARGETS: readonly SevenZipTarget[] = [
    { os: 'win32', arch: 'x64', dir: 'win32-x64', binary: '7za.exe', label: 'Windows x64' },
    { os: 'win32', arch: 'arm64', dir: 'win32-arm64', binary: '7za.exe', label: 'Windows ARM64' },
    { os: 'linux', arch: 'x64', dir: 'linux-x64', binary: '7zz', label: 'Linux x64' },
    { os: 'linux', arch: 'arm64', dir: 'linux-arm64', binary: '7zz', label: 'Linux ARM64' },
    { os: 'darwin', arch: 'x64', dir: 'darwin', binary: '7zz', label: 'macOS（通用二进制）' },
    { os: 'darwin', arch: 'arm64', dir: 'darwin', binary: '7zz', label: 'macOS ARM64（通用二进制）' }
]

/** 归一化 Node 的架构名到本表用的两种。 */
export function normalizeArch(arch: string): 'x64' | 'arm64' | null {
    if (arch === 'x64' || arch === 'ia32') return 'x64'
    if (arch === 'arm64') return 'arm64'
    return null
}

/** 归一化 Node 的平台名到本表用的三种。 */
export function normalizeOs(platform: string): 'win32' | 'darwin' | 'linux' | null {
    if (platform === 'win32') return 'win32'
    if (platform === 'darwin') return 'darwin'
    if (platform === 'linux') return 'linux'
    return null
}

/** 取当前平台对应的发行包；不支持的平台返回 null。 */
export function resolveTarget(platform: string, arch: string): SevenZipTarget | null {
    const os = normalizeOs(platform)
    const a = normalizeArch(arch)
    if (!os || !a) return null
    return TARGETS.find((t) => t.os === os && t.arch === a) ?? null
}

/** 可执行文件名（用于在自动定位时按名字找）。 */
export const BINARY_NAMES = ['7z.exe', '7za.exe', '7zz.exe', '7zz', '7z', '7za'] as const

// ---------------------------------------------------------------------------
// 命令行组装
// ---------------------------------------------------------------------------

/**
 * 归一化压缩级别到 0–9。
 *
 * 7-Zip 另有 `-mx=x`（极限 + 多线程）这一档，但它与数字档语义不同、
 * 且在部分版本上行为不一致，所以这里**只暴露 0–9**，越界一律钳制，
 * 非法值回落默认 5 —— 一个手滑的输入不该压出一个奇怪的包。
 */
export function normalizeLevel(level: unknown): number {
    const n = Math.floor(Number(level))
    if (!Number.isFinite(n)) return 5
    return Math.min(9, Math.max(0, n))
}

/** 归一化分卷大小：只接受「数字 + k/m/g」这类 7-Zip 认的写法。 */
export function normalizeVolumeSize(size: unknown): string | null {
    if (typeof size !== 'string') return null
    const s = size.trim().toLowerCase()
    if (!/^\d+(\.\d+)?[kmg]?b?$/.test(s)) return null
    return s
}

/** 覆盖策略 → 7-Zip 的 `-ao*` 开关。 */
const OVERWRITE_FLAG: Record<NonNullable<ExtractOptions['overwrite']>, string> = {
    overwrite: '-aoa',
    skip: '-aos',
    rename: '-aor',
    newer: '-aot'
}

/** 组装**压缩**命令的 argv（不含可执行文件本身）。 */
export function buildCompressArgs(options: CompressOptions): string[] {
    const argv: string[] = ['a', '-y']
    // -y：对所有询问一律回答「是」，避免子进程卡在交互提示上（我们没有 stdin）。
    argv.push(`-mx=${normalizeLevel(options.level)}`)

    // 格式：显式 format 优先（用 -t），否则交给 7-Zip 按扩展名推断。
    const fmt = options.format?.trim()
    if (fmt) argv.push(`-t${fmt}`)

    // 压缩方法：-m0=<方法>（第 0 个编码器）。
    if (options.method?.trim()) argv.push(`-m0=${options.method.trim()}`)

    // 字典大小（仅对有该概念的格式有意义，交给 7-Zip 自己忽略不支持的）。
    if (options.dictionarySize?.trim()) argv.push(`-md=${options.dictionarySize.trim()}`)

    // 多线程：-mmt=N（0 表示自动，7-Zip 接受 0）。
    if (typeof options.threads === 'number' && Number.isFinite(options.threads)) {
        argv.push(`-mmt=${Math.max(0, Math.floor(options.threads))}`)
    }

    // 固实模式：仅 7z 有意义。
    if (typeof options.solid === 'boolean') argv.push(`-ms=${options.solid ? 'on' : 'off'}`)

    // 密码与文件名加密。
    if (options.password) {
        argv.push(`-p${options.password}`)
        if (options.encryptNames) argv.push('-mhe=on')
    }

    // 分卷：每个 -v 一档（只允许一个，多了 7-Zip 行为未定义）。
    const vol = normalizeVolumeSize(options.volumeSize)
    if (vol) argv.push(`-v${vol}`)

    // 排除通配符。
    for (const pattern of options.exclude ?? []) {
        if (pattern.trim()) argv.push(`-x!${pattern.trim()}`)
    }

    // 目标归档，随后是要打包的输入。
    argv.push(options.archive)
    for (const input of options.inputs) {
        if (input.trim()) argv.push(input)
    }
    return argv
}

/** 组装**解压**命令的 argv（不含可执行文件本身）。 */
export function buildExtractArgs(options: ExtractOptions): string[] {
    // x 是「带完整路径解压」，比 e（只出文件）更符合直觉；展开层级由 -spf 控制。
    const argv: string[] = ['x', '-y']

    // 输出目录：-o 后直接跟路径，中间**不能有空格**（7-Zip 的约定）。
    if (options.destDir) argv.push(`-o${options.destDir}`)

    if (options.password) argv.push(`-p${options.password}`)
    if (options.overwrite) argv.push(OVERWRITE_FLAG[options.overwrite])
    if (options.fullPaths) argv.push('-spf')
    if (options.noPathRestore) argv.push('-spf-')

    // 只解压 / 排除的条目。
    for (const pattern of options.include ?? []) {
        if (pattern.trim()) argv.push(pattern.trim())
    }
    for (const pattern of options.exclude ?? []) {
        if (pattern.trim()) argv.push(`-x!${pattern.trim()}`)
    }

    argv.push(options.archive)
    return argv
}

/** 组装**列出内容**的 argv（技术格式，便于解析）。 */
export function buildListArgs(archive: string, password?: string): string[] {
    const argv: string[] = ['l', '-slt']
    if (password) argv.push(`-p${password}`)
    argv.push(archive)
    return argv
}

/** 组装**测试完整性**的 argv。 */
export function buildTestArgs(archive: string, password?: string): string[] {
    const argv: string[] = ['t']
    if (password) argv.push(`-p${password}`)
    argv.push(archive)
    return argv
}

// ---------------------------------------------------------------------------
// 输出解析
// ---------------------------------------------------------------------------

/**
 * 解析 `7z l -slt` 的技术格式输出。
 *
 * 该格式是一组「空行分隔的记录」，每条记录是 `键 = 值` 的行：
 *
 *   ```
 *   Path = foo.txt
 *   Size = 123
 *   Folder = -
 *   Modified = 2024-01-02 03:04:05
 *   Method = LZMA2:12
 *   Encrypted = -
 *
 *   Path = bar/
 *   ...
 *   ```
 *
 * 开头还有一段「归档属性」记录（`Type = 7z` 等），以第一个 `Path =` 为界结束。
 */
export function parseArchiveListing(stdout: string, includeEntries: boolean): ArchiveListing {
    const listing: ArchiveListing = {
        format: '',
        multivolume: false,
        count: 0,
        totalSize: -1,
        packedSize: -1,
        encrypted: false
    }
    const entries: ArchiveEntry[] = []

    // 按空行切成记录。
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
        const fields = new Map<string, string>()
        for (const line of block.split(/\r?\n/)) {
            const idx = line.indexOf(' = ')
            if (idx < 0) continue
            fields.set(line.slice(0, idx).trim(), line.slice(idx + 3).trim())
        }
        if (fields.size === 0) continue

        const path = fields.get('Path')
        if (!path) {
            // 「归档属性」记录：取格式与多卷信息。
            const type = fields.get('Type')
            if (type) listing.format = type
            if (fields.get('Multivolume') === '+') listing.multivolume = true
            continue
        }

        const isDir = fields.get('Folder') === '+'
        const size = Number(fields.get('Size') ?? 0)
        const packed = Number(fields.get('Packed Size') ?? 0)
        // 结尾那条汇总记录（Path 为空 / 只含 Total）不计入。
        listing.count += 1
        if (Number.isFinite(size)) listing.totalSize = (listing.totalSize < 0 ? 0 : listing.totalSize) + size
        if (Number.isFinite(packed)) listing.packedSize = (listing.packedSize < 0 ? 0 : listing.packedSize) + packed
        if (fields.get('Encrypted') === '+') listing.encrypted = true

        if (includeEntries) {
            entries.push({
                path,
                size: Number.isFinite(size) ? size : 0,
                packedSize: Number.isFinite(packed) ? packed : 0,
                isDir,
                modified: fields.get('Modified') ?? '',
                method: fields.get('Method') ?? '',
                encrypted: fields.get('Encrypted') === '+'
            })
        }
    }

    if (listing.totalSize < 0) listing.totalSize = 0
    if (listing.packedSize < 0) listing.packedSize = 0
    if (includeEntries) listing.entries = entries
    return listing
}

/** 从 `7z i` / `--help` 输出里解析版本号（形如 `7-Zip (z) 24.09 (x64)`）。 */
export function parseVersion(output: string): string {
    const m = output.match(/\b(\d{2}\.\d{2})\b/)
    return m ? m[1] : ''
}

// ---------------------------------------------------------------------------
// 能力自述：把知识库压成一份「可查询」的清单
// ---------------------------------------------------------------------------

/** 能力自述：一次返回可创建 / 可解压格式与方法，供调用方查询。 */
export interface CapabilityDescription {
    /** 能创建的格式名。 */
    creatableFormats: string[]
    /** 能解压的格式名。 */
    extractableFormats: string[]
    /** 能更新的格式名。 */
    updatableFormats: string[]
    /** 全部格式条目。 */
    formats: typeof ARCHIVE_FORMATS
    /** 压缩方法清单。 */
    methods: typeof COMPRESSION_METHODS
    /** 全部支持的格式名（含仅解压的）。 */
    allFormats: string[]
}

/** 汇总一份能力自述（纯计算，无 I/O）。 */
export function describeCapabilities(): CapabilityDescription {
    const all = ARCHIVE_FORMATS.map((f) => f.name)
    return {
        creatableFormats: ARCHIVE_FORMATS.filter((f) => f.canCreate).map((f) => f.name),
        extractableFormats: ARCHIVE_FORMATS.filter((f) => f.canExtract).map((f) => f.name),
        updatableFormats: ARCHIVE_FORMATS.filter((f) => f.canUpdate).map((f) => f.name),
        formats: ARCHIVE_FORMATS,
        methods: COMPRESSION_METHODS,
        allFormats: all
    }
}
