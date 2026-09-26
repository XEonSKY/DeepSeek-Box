import fs from 'node:fs'
import path from 'node:path'
import { configDir } from '../app/settings'
import { removeQuietly } from '../kernel/treeops'
import { runProc } from '../dsh/proc'
import {
    BUNDLED_VERSION,
    buildCompressArgs,
    buildExtractArgs,
    buildListArgs,
    buildTestArgs,
    describeCapabilities,
    parseArchiveListing,
    parseVersion,
    resolveTarget,
    TARGETS
} from './archive'
import {
    type ArchiveListing,
    type CompressOptions,
    type ExtractOptions,
    type SevenZipRunResult,
    type SevenZipStatus,
    type SevenZipTarget
} from './types'

/**
 * 内核的 **7-Zip 归档模块**（原内置扩展 `xeonsky.zip` → 后并入 `xeonsky.extm`
 * 的内部模块 → 现下沉到内核）。
 *
 * ## 为什么它是内核能力而不是扩展
 *
 * 7-Zip 在本程序里的真正用途只有一件：**解压扩展包**（`.zip` / `.xeonsky-ext`）。
 * 那是加载器的「装配」职责，而加载器本身就是内核的一部分 —— 让内核反过来
 * 经能力槽去取一个**可被用户停用**的扩展，会出现「停用 7-Zip 就让所有压缩包扩展消失」
 * 这种把内建功能变成可关开关的怪状态。下沉到内核后不再有这个状态。
 *
 * ## 它现在直接依赖什么
 *
 * 与作为扩展时不同，这里**不再经能力槽取用 fs / proc**，而是直接调用内核实现：
 *  - 文件读写用 `node:fs`（模块就在主进程里，没有跨进程边界要守）；
 *  - 跑 7z 命令行走 {@link runProc} —— 与系统能力 `proc` **共用同一份实现**
 *    （`dsh/proc.ts` 的 `system.proc` 是它的转发），所以登记 / 取消 / stderr 收集
 *    的行为不会分叉。
 *  - 用户指定的二进制路径存在**配置目录**下（`configDir()/data/zip.json`），
 *    不再是扩展数据目录 —— 内核模块没有扩展生命周期。
 *
 * ## 二进制内置（不再运行时下载）
 *
 * 7-Zip 命令行核心**随应用内置**：`src/main/zip/bin/<平台>/`
 * （Windows 取官方安装包里的完整版 `7z.exe` + `7z.dll`；Linux / macOS 取 `7zz`）。
 * 打包时用 `asarUnpack` 把这些可执行文件解开（asar 内的可执行文件**不能被执行**），
 * 因此定位路径里要把 `app.asar` 换回 `app.asar.unpacked`。
 *
 * ## 二进制的三级定位
 *
 * 1. 用户**指定**的路径（存配置文件，最高优先）；
 * 2. **内置**的当前平台二进制（绝大多数情况就是它，开箱即用）；
 * 3. **系统已装**的 7-Zip（各平台常见安装位，仅作兜底）。
 *
 * 定位结果会缓存；改路径时清缓存。
 */

/** 用户在配置文件里的覆盖项。 */
interface ZipConfig {
    /** 用户指定的 7z 可执行文件路径（空串 = 自动定位）。 */
    binaryPath: string
    /** 用户选定的目标平台键（`<os>-<arch>`）；缺省 = 跟随当前平台。 */
    targetKey?: string
}

/** 合并输出：7-Zip 把摘要写 stdout、错误写 stderr，诊断时两者都要看。 */
function mergeOutput(r: { stdout: string; stderrTail: string }): string {
    const parts: string[] = []
    if (r.stdout.trim()) parts.push(r.stdout.trim())
    if (r.stderrTail.trim()) parts.push(r.stderrTail.trim())
    return parts.join('\n')
}

/** 内核 7-Zip 模块的公开面。 */
export interface SevenZip {
    status: () => Promise<SevenZipStatus>
    locate: () => { path: string; source: SevenZipStatus['source'] }
    setBinaryPath: (p: unknown) => { path: string; source: SevenZipStatus['source'] }
    listTargets: () => Array<{ os: string; arch: string; dir: string; label: string; binary: string }>
    describe: () => ReturnType<typeof describeCapabilities>
    listFormats: () => ReturnType<typeof describeCapabilities>['formats']
    listMethods: () => ReturnType<typeof describeCapabilities>['methods']
    compress: (options: CompressOptions) => Promise<SevenZipRunResult & { archive: string }>
    extract: (options: ExtractOptions) => Promise<SevenZipRunResult & { destDir: string }>
    list: (options: { archive: string; password?: string; entries?: boolean }) => Promise<ArchiveListing>
    test: (options: { archive: string; password?: string }) => Promise<SevenZipRunResult>
    run: (argv: unknown) => Promise<SevenZipRunResult>
}

/**
 * 内置二进制目录的绝对路径。
 *
 * 打包产物里 `__dirname` 是 `…/app.asar/out/main`，上两级即应用根；可执行文件被
 * asarUnpack 解到 `app.asar.unpacked`，所以要把 `.asar` 换回 `.asar.unpacked` ——
 * 否则打包后会「文件存在但无法执行」。
 */
function resolveBinDir(): string {
    return path
        .join(__dirname, '../../src/main/zip/bin')
        .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
}

/** 用户指定二进制路径的落盘位置（配置目录下，跨重装保留）。 */
function configPath(): string {
    return path.join(configDir(), 'data', 'zip.json')
}

/**
 * 创建一个 7-Zip 运行时（闭包持有配置与定位缓存）。
 *
 * 做成工厂而不是模块级单例：缓存与配置读写都绑定到**这一份实例**（测试或将来
 * 换配置目录时重新建一份，旧的自然丢弃），与「模块不持有跨生命周期的全局可变态」一致。
 */
export function createZip(): SevenZip {
    const binDir = resolveBinDir()
    const cfgPath = configPath()

    function readConfig(): ZipConfig {
        let raw: string
        try {
            raw = fs.readFileSync(cfgPath, 'utf8')
        } catch {
            return { binaryPath: '' }
        }
        try {
            const parsed = JSON.parse(raw) as Partial<ZipConfig>
            return {
                binaryPath: typeof parsed.binaryPath === 'string' ? parsed.binaryPath : '',
                targetKey: typeof parsed.targetKey === 'string' ? parsed.targetKey : undefined
            }
        } catch {
            return { binaryPath: '' }
        }
    }

    function writeConfig(cfg: ZipConfig): void {
        try {
            fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
            fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 4), 'utf8')
        } catch {
            /* 配置写不进去只影响下次启动的定位，不该让本次操作失败 */
        }
    }

    function targetKeyOf(t: { os: string; arch: string }): string {
        return `${t.os}-${t.arch}`
    }

    /** 当前目标（配置覆盖优先，否则按当前平台/架构）。 */
    function currentTarget(): SevenZipTarget | null {
        const cfg = readConfig()
        if (cfg.targetKey) {
            const found = TARGETS.find((t) => targetKeyOf(t) === cfg.targetKey)
            if (found) return found
        }
        return resolveTarget(process.platform, process.arch)
    }

    /** 内置二进制的绝对路径（不支持的平台返回 null）。 */
    function bundledBinary(): { file: string; dir: string } | null {
        const target = currentTarget()
        if (!target) return null
        return { file: path.join(binDir, target.dir, target.binary), dir: target.dir }
    }

    /** 候选路径：用户指定 → 内置 → 系统常见位置。 */
    function candidatePaths(): string[] {
        const cfg = readConfig()
        const out: string[] = []
        if (cfg.binaryPath.trim()) out.push(cfg.binaryPath.trim())

        const bundled = bundledBinary()
        if (bundled) out.push(bundled.file)

        if (process.platform === 'win32') {
            const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files'
            const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
            out.push(path.join(pf, '7-Zip', '7z.exe'))
            out.push(path.join(pf86, '7-Zip', '7z.exe'))
        } else if (process.platform === 'darwin') {
            out.push('/opt/homebrew/bin/7zz', '/usr/local/bin/7zz', '/opt/homebrew/bin/7z', '/usr/local/bin/7z')
        } else {
            out.push('/usr/bin/7zz', '/usr/local/bin/7zz', '/usr/bin/7z', '/usr/local/bin/7z', '/usr/bin/7za')
        }
        return out
    }

    let cached: { path: string; source: SevenZipStatus['source'] } | null = null

    /** 定位二进制（只做「存在性」判断，不做「可运行」验证）。 */
    function locateBinaryPath(): { path: string; source: SevenZipStatus['source'] } {
        if (cached) return cached
        const cfg = readConfig()
        const bundled = bundledBinary()
        for (const p of candidatePaths()) {
            if (p && fs.existsSync(p)) {
                const source: SevenZipStatus['source'] =
                    p === cfg.binaryPath.trim() ? 'custom' : bundled && p === bundled.file ? 'bundled' : 'system'
                cached = { path: p, source }
                return cached
            }
        }
        const fallback = cfg.binaryPath.trim()
        cached = { path: fallback, source: fallback ? 'custom' : 'missing' }
        return cached
    }

    /** 跑一次 7z（默认 30 分钟超时，足够压大目录又不会挂死）。 */
    async function run7z(argv: string[], timeoutMs?: number): Promise<SevenZipRunResult> {
        const { path: bin } = locateBinaryPath()
        if (!bin) {
            return { ok: false, code: null, canceled: false, output: '7-Zip binary not found (bundled core missing?)' }
        }
        const r = await runProc(bin, argv, { timeoutMs: timeoutMs ?? 30 * 60 * 1000 })
        return { ok: r.ok, code: r.code, canceled: r.canceled, output: mergeOutput(r) }
    }

    /** 探测版本（失败回落空串）。 */
    async function probeVersion(): Promise<string> {
        const r = await run7z(['i'], 15_000)
        return r.ok ? parseVersion(r.output) : ''
    }

    /** 状态快照。 */
    async function status(): Promise<SevenZipStatus> {
        const { path: binaryPath, source } = locateBinaryPath()
        const target = currentTarget()
        let version = ''
        let available = false
        if (binaryPath) {
            version = await probeVersion()
            available = version !== ''
        }
        return {
            binaryPath,
            source,
            available,
            version,
            supported: target !== null,
            target,
            binDir,
            binPlatformDir: target?.dir ?? '',
            bundledVersion: BUNDLED_VERSION
        }
    }

    /** 压缩。 */
    async function compress(options: CompressOptions): Promise<SevenZipRunResult & { archive: string }> {
        const r = await run7z(buildCompressArgs(options))
        return { ...r, archive: options.archive }
    }

    /** 解压。 */
    async function extract(options: ExtractOptions): Promise<SevenZipRunResult & { destDir: string }> {
        try {
            fs.mkdirSync(options.destDir, { recursive: true })
        } catch {
            /* 目录已存在或由 7z 自己创建 */
        }
        const r = await run7z(buildExtractArgs(options))
        return { ...r, destDir: options.destDir }
    }

    /** 列出归档内容。 */
    async function list(options: { archive: string; password?: string; entries?: boolean }): Promise<ArchiveListing> {
        const r = await run7z(buildListArgs(options.archive, options.password))
        if (!r.ok) return { format: '', multivolume: false, count: 0, totalSize: 0, packedSize: 0, encrypted: false }
        return parseArchiveListing(r.output, options.entries !== false)
    }

    /** 测试完整性。 */
    async function test(options: { archive: string; password?: string }): Promise<SevenZipRunResult> {
        return run7z(buildTestArgs(options.archive, options.password))
    }

    return {
        status,
        locate: () => {
            cached = null
            return locateBinaryPath()
        },
        setBinaryPath: (p: unknown) => {
            const cfg = readConfig()
            cfg.binaryPath = typeof p === 'string' ? p : ''
            writeConfig(cfg)
            cached = null
            return locateBinaryPath()
        },
        listTargets: () => TARGETS.map((t) => ({ os: t.os, arch: t.arch, dir: t.dir, label: t.label, binary: t.binary })),
        describe: () => describeCapabilities(),
        listFormats: () => describeCapabilities().formats,
        listMethods: () => describeCapabilities().methods,
        compress,
        extract,
        list,
        test,
        run: (argv: unknown) => run7z(Array.isArray(argv) ? argv.map(String) : [])
    }
}

// ---------------------------------------------------------------------------
// 加载器要用的三个动作（原 `ext:xeonsky.extm` 的对外能力，同样形状）
// ---------------------------------------------------------------------------

/** 支持的包文件扩展名（大小写不敏感；`.xeonsky-ext` 是本项目的 zip 变种）。 */
const PKG_EXTS = ['.zip', '.xeonsky-ext'] as const

/** 单例：内核里只有一份 7-Zip 运行时（定位缓存也共用）。 */
let singleton: SevenZip | null = null

/** 取内核 7-Zip 模块（首次访问时建立）。 */
export function zipModule(): SevenZip {
    if (!singleton) singleton = createZip()
    return singleton
}

/** 7-Zip 是否可用（实时判定：探测二进制能否跑出版本）。 */
export async function zipAvailable(): Promise<boolean> {
    try {
        const s = await zipModule().status()
        return s.available
    } catch {
        return false
    }
}

/** 扩展包管理状态的返回形状（加载器与扩展管理页共用）。 */
export interface PkgStatus {
    /** 7-Zip 是否可用（不可用 = 压缩包扩展加载被禁用）。 */
    zipAvailable: boolean
    /** 支持的包格式。 */
    formats: string[]
}

/** 内核侧的包管理状态。 */
export async function pkgStatus(): Promise<PkgStatus> {
    return { zipAvailable: await zipAvailable(), formats: [...PKG_EXTS.map((e) => e.slice(1))] }
}

/** 一个已发现的扩展包。 */
export interface PkgEntry {
    /** 包文件绝对路径。 */
    file: string
    /** 包名（文件名去掉扩展名）。 */
    stem: string
    /** 包格式（zip / xeonsky-ext）。 */
    format: string
}

/** 列出外部扩展根目录下的包文件（*.zip / *.xeonsky-ext，按文件名排序）。 */
export function listPackages(root: string): PkgEntry[] {
    const dir = path.resolve(root)
    let names: fs.Dirent[]
    try {
        names = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
        return []
    }
    const out: PkgEntry[] = []
    for (const entry of names) {
        if (!entry.isFile()) continue
        const lower = entry.name.toLowerCase()
        const hit = PKG_EXTS.find((ext) => lower.endsWith(ext))
        if (!hit) continue
        out.push({ file: path.join(dir, entry.name), stem: entry.name.slice(0, -hit.length), format: hit.slice(1) })
    }
    out.sort((a, b) => a.stem.localeCompare(b.stem) || a.file.localeCompare(b.file))
    return out
}

/** 解压结果。disabled=true 表示 7-Zip 不可用、功能被禁用。 */
export interface PkgExtractResult {
    ok: boolean
    disabled?: boolean
    /** 失败或禁用时的说明。 */
    message?: string
}

/**
 * 解压一个扩展包到目标目录。
 *
 * 7-Zip 不可用 → 返回 disabled（加载器据此把包记为 skipped，不做读取）。
 * 覆盖策略取 overwrite（-aoa）：加载器在解压前会清空目标目录，包内容是权威来源。
 */
export async function extractPackage(file: string, destDir: string): Promise<PkgExtractResult> {
    if (!(await zipAvailable())) {
        return { ok: false, disabled: true, message: '7-Zip 核心不可用，压缩包扩展加载已禁用' }
    }
    try {
        const dest = path.resolve(destDir)
        await removeQuietly(dest)
        const r = await zipModule().extract({ archive: path.resolve(file), destDir: dest, overwrite: 'overwrite' })
        return r.ok ? { ok: true } : { ok: false, message: r.output || '7-Zip 返回失败' }
    } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
}
