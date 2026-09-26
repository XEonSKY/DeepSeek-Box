/**
 * 内核 **7-Zip 归档模块**的契约：实现（`core.ts` / `archive.ts`）与界面共用的形状。
 *
 * 它是内核模块而不是扩展：7-Zip 在本程序里的用途是**解压扩展包**，属加载器的装配职责。
 * 因此类型放在 `src/main/zip/` 下、与实现同目录，而不是 `src/shared/` ——
 * `src/shared/api.ts` 是**内置 IPC 端点**的唯一事实来源，这里既不是端点也不是跨端契约。
 *
 * 三类东西：
 *  - 归档**格式知识库**（{@link ARCHIVE_FORMATS} 等）——7-Zip 到底支持什么，纯数据；
 *  - 入参出参（{@link ExtractOptions} / {@link CompressOptions} …）—— 模块调用契约；
 *  - 状态快照（{@link SevenZipStatus}）—— 定位结果，供自检 / 诊断用。
 */

// ---------------------------------------------------------------------------
// 平台与二进制
// ---------------------------------------------------------------------------

/** 7-Zip 官方按「操作系统 + 架构」发布的核心包。 */
export interface SevenZipTarget {
    /** 目标平台。 */
    os: 'win32' | 'darwin' | 'linux'
    /** 目标架构。 */
    arch: 'x64' | 'arm64'
    /** 内置二进制所在子目录（相对 `bin/`，如 `win32-x64` / `darwin`）。 */
    dir: string
    /** 可执行文件名（Windows 为 `7z.exe`，类 Unix 为 `7zz`）。 */
    binary: string
    /** 平台展示名。 */
    label: string
}

/** 7-Zip 核心的当前状态（自检 / 诊断用）。 */
export interface SevenZipStatus {
    /** 实际使用的可执行文件绝对路径（用户指定优先，否则是内置的）。 */
    binaryPath: string
    /** 该路径的来源：用户指定 / 内置 / 系统 / 未找到。 */
    source: 'custom' | 'bundled' | 'system' | 'missing'
    /** 是否可用（能跑出版本输出的程度）。 */
    available: boolean
    /** 版本字符串（能从 `7z i` 解析出来时给出）。 */
    version: string
    /** 当前平台是否在支持列表里。 */
    supported: boolean
    /** 当前平台对应的内置目标（不支持时为 null）。 */
    target: SevenZipTarget | null
    /** 内置二进制目录（`<应用>/src/main/zip/bin`）。 */
    binDir: string
    /** 内置二进制所在平台子目录（如 `win32-x64`；不支持时为空串）。 */
    binPlatformDir: string
    /** 内置的 7-Zip 版本（如 `26.03`）。 */
    bundledVersion: string
}

// ---------------------------------------------------------------------------
// 压缩格式知识库（纯数据，不依赖 7-Zip 可执行文件）
// ---------------------------------------------------------------------------

/** 一个归档格式条目。 */
export interface ArchiveFormat {
    /** 格式名（7-Zip 用语，如 `7z` / `zip` / `tar`）。 */
    name: string
    /** 是否支持**创建**（压缩）该格式。 */
    canCreate: boolean
    /** 是否支持**解压**该格式。 */
    canExtract: boolean
    /** 是否支持**更新**（往已有归档里增删条目）。 */
    canUpdate: boolean
    /** 说明（中文，界面直接展示；扩展不参与内核 i18n，自行给说明文本）。 */
    note?: string
}

/**
 * 7-Zip 支持的归档格式清单。
 *
 * 数据来源是 7-Zip 官方 `7z i` / `-h` 的能力矩阵。这里**内置一份**而不是运行时
 * 每次都去问可执行文件，原因有二：
 *  1. 界面要在「还没装核心」时就能列出「装了之后能做什么」——这正是下载引导需要的；
 *  2. 核心没装时查询接口也应返回有意义的结果，而不是报错。
 * 运行时仍可调 `listFormats` 用真实二进制核对（见 main.ts）。
 */
export const ARCHIVE_FORMATS: readonly ArchiveFormat[] = [
    { name: '7z', canCreate: true, canExtract: true, canUpdate: true, note: '7-Zip 自有格式，压缩率最高，支持分卷与 AES-256 加密。' },
    { name: 'zip', canCreate: true, canExtract: true, canUpdate: true, note: '最通用；支持 ZipCrypto / AES 加密，按 7-Zip 的兼容实现。' },
    { name: 'gzip', canCreate: true, canExtract: true, canUpdate: false, note: '单文件压缩，常与 tar 组合成 .tar.gz。' },
    { name: 'bzip2', canCreate: true, canExtract: true, canUpdate: false, note: '压缩率高于 gzip，速度较慢。' },
    { name: 'xz', canCreate: true, canExtract: true, canUpdate: false, note: '高压缩率，常与 tar 组合成 .tar.xz。' },
    { name: 'tar', canCreate: true, canExtract: true, canUpdate: false, note: '仅打包不压缩；可与 gzip/bzip2/xz 组合。' },
    { name: 'wim', canCreate: true, canExtract: true, canUpdate: true, note: 'Windows 映像格式（增量）。' },
    { name: 'iso', canCreate: false, canExtract: true, canUpdate: false, note: '光盘映像（仅解压：7-Zip 不能创建 ISO）。' },
    { name: 'udf', canCreate: false, canExtract: true, canUpdate: false, note: '通用光盘格式（仅解压）。' },
    { name: 'cpio', canCreate: false, canExtract: true, canUpdate: false, note: 'Unix 归档（仅解压）。' },
    { name: 'rpm', canCreate: false, canExtract: true, canUpdate: false, note: 'Linux 包格式（仅解压）。' },
    { name: 'deb', canCreate: false, canExtract: true, canUpdate: false, note: 'Debian 包格式（仅解压）。' },
    { name: 'vhd', canCreate: false, canExtract: true, canUpdate: false, note: '虚拟硬盘映像（含 vhdx / vdi / vmdk，仅解压）。' },
    { name: 'fat', canCreate: false, canExtract: true, canUpdate: false, note: 'FAT 文件系统映像（仅解压）。' },
    { name: 'exe', canCreate: false, canExtract: true, canUpdate: false, note: 'PE 可执行文件（exe / dll / sys，可当归档解包）。' },
    { name: 'ar', canCreate: false, canExtract: true, canUpdate: false, note: 'Unix ar 归档（deb / .a 也走这个处理器）。' },
    { name: 'ntfs', canCreate: false, canExtract: true, canUpdate: false, note: 'NTFS 文件系统映像（仅解压）。' },
    { name: 'squashfs', canCreate: false, canExtract: true, canUpdate: false, note: '只读压缩文件系统（仅解压）。' },
    { name: 'lzma', canCreate: false, canExtract: true, canUpdate: false, note: '裸 LZMA 流（26.03 起不能创建，仅解压）。' },
    { name: 'z', canCreate: false, canExtract: true, canUpdate: false, note: 'Unix compress 格式（仅解压）。' },
    { name: 'lzh', canCreate: false, canExtract: true, canUpdate: false, note: 'LHA 格式（仅解压）。' },
    { name: 'cab', canCreate: false, canExtract: true, canUpdate: false, note: 'Windows 安装包格式（仅解压）。' },
    { name: 'arj', canCreate: false, canExtract: true, canUpdate: false, note: 'ARJ 格式（仅解压）。' },
    { name: 'zst', canCreate: false, canExtract: true, canUpdate: false, note: 'Zstandard（较新版本支持解压）。' },
    { name: 'rar', canCreate: false, canExtract: true, canUpdate: true, note: '仅解压 / 更新，**不能创建**（RAR 为专有格式）。' },
    { name: 'dmg', canCreate: false, canExtract: true, canUpdate: false, note: 'macOS 磁盘映像（仅解压）。' },
    { name: 'apfs', canCreate: false, canExtract: true, canUpdate: false, note: 'macOS APFS 映像（仅解压）。' },
    { name: 'hfs', canCreate: false, canExtract: true, canUpdate: false, note: 'macOS HFS+ 映像（仅解压）。' },
    { name: 'msi', canCreate: false, canExtract: true, canUpdate: false, note: 'Windows 安装包（仅解压）。' },
    { name: 'chm', canCreate: false, canExtract: true, canUpdate: false, note: 'Windows 帮助文件（仅解压）。' },
    { name: 'xar', canCreate: false, canExtract: true, canUpdate: false, note: 'macOS 打包格式（仅解压）。' }
]

/** 一个压缩方法（算法）条目。 */
export interface CompressionMethod {
    /** 方法名（7-Zip 的 `-m` 取值）。 */
    name: string
    /** 适用格式。 */
    formats: readonly string[]
    /** 说明。 */
    note?: string
}

/** 7-Zip 可用的压缩算法清单。 */
export const COMPRESSION_METHODS: readonly CompressionMethod[] = [
    { name: 'LZMA2', formats: ['7z', 'xz'], note: '默认，高压缩率 + 多线程。' },
    { name: 'LZMA', formats: ['7z', 'lzma'], note: '经典高压缩率算法。' },
    { name: 'PPMd', formats: ['7z', 'zip'], note: '文本文件压缩率好。' },
    { name: 'BZip2', formats: ['7z', 'bzip2', 'zip', 'tar'], note: '块排序算法。' },
    { name: 'Deflate', formats: ['7z', 'zip', 'gzip'], note: '最通用的 zip 算法。' },
    { name: 'Deflate64', formats: ['7z', 'zip'], note: 'Deflate 的 64 位扩展。' },
    { name: 'Copy', formats: ['7z', 'zip', 'tar'], note: '不压缩，仅打包。' },
    { name: 'Delta', formats: ['7z'], note: '预处理滤波，适合结构化二进制。' },
    { name: 'BCJ', formats: ['7z'], note: '可执行文件 x86 转换滤波。' },
    { name: 'BCJ2', formats: ['7z'], note: '可执行文件 x86 高级滤波。' },
    { name: 'AES-256', formats: ['7z', 'zip'], note: '加密；7z 用 AES-256，zip 可选用 AES 或 ZipCrypto。' }
]

/** 项级功能（7-Zip 的能力维度），供界面展示「支持哪些高级功能」。 */
export interface FeatureItem {
    /** 功能名（界面上的一行标题，中文）。 */
    name: string
    /** 说明。 */
    note: string
    /** 对应的 7-Zip 开关（便于用户对照命令行）。 */
    flag?: string
}

/** 7-Zip 的高级功能清单。 */
export const FEATURES: readonly FeatureItem[] = [
    { name: '分卷压缩', note: '把归档切成指定大小的多个卷；解压时只需提供第一卷。', flag: '-v{size}' },
    { name: '加密与密码', note: '7z / zip 支持文件内容加密；7z 还可加密文件名（-mhe）。', flag: '-p{password} / -mhe' },
    { name: '加密文件名', note: '仅 7z：连目录结构一并加密，未提供密码时看不到文件名。', flag: '-mhe=on' },
    { name: '压缩级别', note: '0 仅打包 ~ 9 极限压缩，另有 x 表示「极限 + 多线程」的额外档。', flag: '-mx0..-mx9' },
    { name: '多线程', note: '按 CPU 核心数并行压缩（LZMA2 默认开启）。', flag: '-mmt={n}' },
    { name: '固实压缩', note: '仅 7z：把小文件合并成块，显著提高压缩率，代价是随机读取变慢。', flag: '-ms=on/off' },
    { name: '字典大小', note: '越大压缩率越高、内存占用越大。', flag: '-md={size}' },
    { name: '更新既有归档', note: '增删 / 替换归档内条目，而不必整包重建（限支持更新的格式）。', flag: 'u / d 命令' },
    { name: '排除与通配', note: '按通配符排除文件、按列表文件批量指定。', flag: '-x! / @listfile' },
    { name: '解压到指定目录', note: '可保持或展开全部目录层级。', flag: '-o{dir} / -spf' },
    { name: '覆盖策略', note: '重名时的处理：覆盖 / 跳过 / 重命名 / 只更新更旧。', flag: '-aoa/-aos/-aou/-aot' },
    { name: '测试完整性', note: '不落盘，仅校验归档可解且校验和正确。', flag: 't 命令' },
    { name: '列出内容', note: '以技术格式列出条目、大小、CRC 与方法。', flag: 'l / l -slt' },
    { name: '保留时间戳与属性', note: '恢复原始修改时间、属性与 ACL（在权限允许时）。', flag: '-ssw / -snoi' }
]

// ---------------------------------------------------------------------------
// 能力面：入参出参契约
// ---------------------------------------------------------------------------

/** 一件「要打包的输入」。 */
export type CompressInput = string

/** 压缩选项。 */
export interface CompressOptions {
    /** 目标归档的绝对路径（扩展名决定格式；也可用 `format` 覆盖）。 */
    archive: string
    /** 要打包的文件 / 目录（绝对路径列表）。 */
    inputs: CompressInput[]
    /** 目标格式（如 `7z` / `zip` / `tar`）；缺省按 archive 扩展名推断。 */
    format?: string
    /** 压缩级别 `0`–`9`（`0` 仅打包不压缩；缺省 5）。 */
    level?: number
    /** 压缩方法（如 `LZMA2` / `Deflate`），对应 `-m0=`。 */
    method?: string
    /** 分卷大小（如 `100m` / `1g`）。 */
    volumeSize?: string
    /** 密码（留空 = 不加密）。 */
    password?: string
    /** 仅 7z：同时加密文件名。 */
    encryptNames?: boolean
    /** 多线程数（0 = 自动）。 */
    threads?: number
    /** 固实模式（仅 7z）。 */
    solid?: boolean
    /** 字典大小（如 `64m`）。 */
    dictionarySize?: string
    /** 排除的通配符（如 `*.tmp`）。 */
    exclude?: string[]
    /** 覆盖已有归档（否则 7z 的 `a` 是更新语义）。 */
    overwrite?: boolean
}

/** 解压选项。 */
export interface ExtractOptions {
    /** 归档绝对路径（分卷时给第一卷即可）。 */
    archive: string
    /** 输出目录（不存在则创建）。 */
    destDir: string
    /** 密码。 */
    password?: string
    /** 只解压匹配的条目（通配符）。 */
    include?: string[]
    /** 排除匹配的条目。 */
    exclude?: string[]
    /** 展开全部目录层级（对某些归档默认只还原一层）。 */
    fullPaths?: boolean
    /** 覆盖策略。 */
    overwrite?: 'overwrite' | 'skip' | 'rename' | 'newer'
    /** 保持（不还原）原始路径，防目录穿越。 */
    noPathRestore?: boolean
}

/** 归档内一个条目（`l -slt` 解析后的精简形状）。 */
export interface ArchiveEntry {
    path: string
    size: number
    packedSize: number
    /** 是否目录。 */
    isDir: boolean
    /** 修改时间（ISO 字符串；解析不出则为空串）。 */
    modified: string
    /** 压缩方法。 */
    method: string
    /** 是否加密。 */
    encrypted: boolean
}

/** 归档概览（`l -slt` 的汇总 + 条目）。 */
export interface ArchiveListing {
    /** 实际格式（7-Zip 识别出的）。 */
    format: string
    /** 是否识别为多卷。 */
    multivolume: boolean
    /** 条目总数。 */
    count: number
    /** 解压后总大小（字节，-1 表示未知）。 */
    totalSize: number
    /** 压缩后总大小（字节，-1 表示未知）。 */
    packedSize: number
    /** 是否加密。 */
    encrypted: boolean
    /** 条目（仅当请求 `entries` 时给出）。 */
    entries?: ArchiveEntry[]
}

/** 一次 7-Zip 调用的原始结果（诊断用）。 */
export interface SevenZipRunResult {
    ok: boolean
    code: number | null
    canceled: boolean
    /** 合并后的输出（stdout + stderr 尾部）。 */
    output: string
}

/** 能力可执行的动作名（供 `describe` 自述，也便于调用方 `call` 时对照）。 */
export const CAPABILITY_ACTIONS = [
    'status',
    'locate',
    'setBinaryPath',
    'listTargets',
    'describe',
    'listFormats',
    'listMethods',
    'listFeatures',
    'compress',
    'extract',
    'list',
    'test',
    'run'
] as const

/** 能力动作名类型。 */
export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number]
