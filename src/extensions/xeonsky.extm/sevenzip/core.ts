import path from 'node:path'
import type { ExtContext } from '@main/extensions/loader/ctx'
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
 * `xeonsky.extm` 的**内部 7-Zip 模块** —— 基于 7-Zip 核心的归档能力。
 *
 * 它原先是一个独立的内置扩展 `xeonsky.zip`，现已并入扩展管理：7-Zip 是
 * **「扩展管理页的归档区块」+「外部扩展包解压」** 这一件事的实现细节，不该是可独立
 * 启停的扩展 —— 独立时用户能在界面里把它关掉，于是「扩展包加载」这种内建功能
 * 会莫名失灵（停用 7-Zip 就让所有压缩包扩展消失）。并入后不再有「内部模块被
 * 用户停用」这个状态。
 *
 * ## 它与内核的关系
 *
 * 本文件**不 import 任何内核模块**（除类型 `ExtContext`）：所有能力都经
 * `ctx.capabilities.call(...)` 取用。依赖的系统能力写进扩展的 `manifest.ts`：
 *  - `fs`   读写自己的配置、探测二进制、建目录；
 *  - `proc` 跑 7z 命令行（复用内核 runChild 的登记 / 取消 / stderr 收集）。
 *
 * ## 二进制内置（不再运行时下载）
 *
 * 7-Zip 命令行核心**随扩展内置**：`src/extensions/xeonsky.extm/sevenzip/bin/<平台>/`
 * （Windows 取官方安装包里的完整版 `7z.exe` + `7z.dll`；Linux / macOS 取 `7zz`）。
 * 打包时用 `asarUnpack` 把这些可执行文件解开（asar 内的可执行文件**不能被执行**），
 * 因此定位路径里要把 `app.asar` 换回 `app.asar.unpacked`。
 *
 * ## 二进制的三级定位
 *
 * 1. 用户在面板里**指定**的路径（存扩展自己的配置文件，最高优先）；
 * 2. **内置**的当前平台二进制（绝大多数情况就是它，开箱即用）；
 * 3. **系统已装**的 7-Zip（各平台常见安装位，仅作兜底）。
 *
 * 定位结果会缓存；改路径时清缓存。
 */

/** 扩展私有配置（存扩展自己的目录，不进内核设置）。 */
interface ExtConfig {
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

/** 内部 7-Zip 模块的公开面（{@link createSevenZip} 的返回）。 */
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
 * 创建一个 7-Zip 运行时（闭包持有配置与定位缓存）。
 *
 * 做成工厂而不是模块级单例：缓存与配置读写都绑定到**这次 activate 的 ctx**
 * （扩展重载时重新建一份，旧的自然丢弃），与「扩展不该持有跨生命周期的全局态」一致。
 */
export function createSevenZip(ctx: ExtContext): SevenZip {
    const fsCall = <T,>(action: string, ...args: unknown[]): T => ctx.capabilities.call<T>('fs', action, ...args)
    const procCall = <T,>(action: string, ...args: unknown[]): T => ctx.capabilities.call<T>('proc', action, ...args)

    /**
     * 内置二进制目录。
     *
     * 打包产物里 `__dirname` 是 `…/app.asar/out/main`，上两级即应用根；
     * 可执行文件被 asarUnpack 解到 `app.asar.unpacked`，所以要把 `.asar` 换回去 ——
     * 否则打包后会「文件存在但无法执行」。
     */
    const binDir = path
        .join(__dirname, '../../src/extensions/xeonsky.extm/sevenzip/bin')
        .replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    /** 扩展自己的配置文件（数据目录，重装不丢）。 */
    const configPath = path.join(ctx.dataDir, 'sevenzip.json')

    function readConfig(): ExtConfig {
        const raw = fsCall<string | null>('readIfExists', configPath)
        if (!raw) return { binaryPath: '' }
        try {
            const parsed = JSON.parse(raw) as Partial<ExtConfig>
            return {
                binaryPath: typeof parsed.binaryPath === 'string' ? parsed.binaryPath : '',
                targetKey: typeof parsed.targetKey === 'string' ? parsed.targetKey : undefined
            }
        } catch {
            return { binaryPath: '' }
        }
    }

    function writeConfig(cfg: ExtConfig): void {
        fsCall('write', configPath, JSON.stringify(cfg, null, 4))
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
            if (p && fsCall<boolean>('exists', p)) {
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
        const r = await procCall<{ ok: boolean; code: number | null; canceled: boolean; stdout: string; stderrTail: string }>(
            'run',
            bin,
            argv,
            { timeoutMs: timeoutMs ?? 30 * 60 * 1000 }
        )
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
        fsCall('mkdir', options.destDir)
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
