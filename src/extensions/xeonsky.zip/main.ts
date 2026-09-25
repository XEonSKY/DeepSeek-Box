import path from 'node:path'
import type { ExtContext } from '@main/extensions/loader/ctx'
import {
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
    CAPABILITY_ACTIONS,
    type ArchiveListing,
    type CompressOptions,
    type ExtractOptions,
    type SevenZipRunResult,
    type SevenZipStatus,
    type SevenZipTarget
} from './types'

/**
 * 内置扩展 `xeonsky.zip` 的主进程实现 —— 基于 7-Zip 核心的归档能力。
 *
 * ## 它与内核的关系
 *
 * 本文件**不 import 任何内核模块**（除类型 `ExtContext`）：所有能力都经
 * `ctx.capabilities.call(...)` 取用。所以内核换掉下载实现、换掉子进程实现，
 * 本扩展一行都不用改 —— 这正是扩展层「只依赖加载器给的 ctx」的落点。
 *
 * 依赖的三项系统能力都写进了 `manifest.ts`：
 *  - `fs`   读写自己的配置、探测二进制、建目录；
 *  - `net`  下载 7-Zip 核心（复用内核 downloader 的多线程 / 代理 / 进度）；
 *  - `proc` 跑 7z 命令行（复用内核 runChild 的登记 / 取消 / stderr 收集）。
 *
 * ## 它对外提供什么
 *
 * 经 `ctx.provides(...)` 注册能力 `ext:xeonsky.zip`，动作见 {@link CAPABILITY_ACTIONS}。
 * 别的扩展申请它之后即可解压 / 压缩 / 查询，不必各自去找 7z、各自拼命令行 ——
 * 这是「扩展间经加载器能力槽互调」的既定模型。
 *
 * ## 二进制的三级定位
 *
 * 1. 用户在面板里**指定**的路径（存扩展自己的配置文件，最高优先）；
 * 2. 核心目录里**已下载**的二进制（`<扩展数据目录>/core`，**散装** —— 二进制
 *    直接平铺在 core 根下，下载解压用 `e` 命令展平，不保留包内子目录）；
 * 3. **系统已装**的 7-Zip（各平台常见安装位）。
 *
 * 定位结果会缓存；`locate` 动作与改路径时清缓存。
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

export function activate(ctx: ExtContext): void {
    // ---- 能力取用口（全部经 ctx） ---------------------------------------------

    const fsCall = <T,>(action: string, ...args: unknown[]): T => ctx.capabilities.call<T>('fs', action, ...args)
    const procCall = <T,>(action: string, ...args: unknown[]): T => ctx.capabilities.call<T>('proc', action, ...args)
    const netCall = <T,>(action: string, ...args: unknown[]): T => ctx.capabilities.call<T>('net', action, ...args)

    // ---- 路径约定 -------------------------------------------------------------

    /** 核心目录：下载得到的 7-Zip 放这里（在扩展数据目录下，重装不丢）。 */
    const coreDir = path.join(ctx.dataDir, 'core')
    /** 扩展自己的配置文件（与 core 目录平级）。 */
    const configPath = path.join(ctx.dataDir, 'config.json')

    // ---- 配置读写 -------------------------------------------------------------

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

    // ---- 平台目标 -------------------------------------------------------------

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

    // ---- 二进制定位 -----------------------------------------------------------

    /** 候选路径：用户指定 → 核心目录 → 系统常见位置。 */
    function candidatePaths(): string[] {
        const cfg = readConfig()
        const out: string[] = []
        if (cfg.binaryPath.trim()) out.push(cfg.binaryPath.trim())

        const target = currentTarget()
        if (target) {
            // 核心目录下：散装布局是裸文件名（core/7za.exe）；也兼容旧版按包内
            // 相对位置（x64/7za.exe）留下来的安装。
            out.push(path.join(coreDir, path.basename(target.binary)))
            out.push(path.join(coreDir, target.binary))
        }

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
        for (const p of candidatePaths()) {
            if (p && fsCall<boolean>('exists', p)) {
                cached = { path: p, source: p === cfg.binaryPath.trim() ? 'custom' : 'auto' }
                return cached
            }
        }
        const fallback = cfg.binaryPath.trim()
        cached = { path: fallback, source: fallback ? 'custom' : 'missing' }
        return cached
    }

    // ---- 跑 7-Zip -------------------------------------------------------------

    /** 跑一次 7z（默认 30 分钟超时，足够压大目录又不会挂死）。 */
    async function run7z(argv: string[], timeoutMs?: number): Promise<SevenZipRunResult> {
        const { path: bin } = locateBinaryPath()
        if (!bin) {
            return { ok: false, code: null, canceled: false, output: '7-Zip binary not found; set a path or download a core first.' }
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
        return { binaryPath, source, available, version, supported: target !== null, target, coreDir }
    }

    // ---- 动作实现 -------------------------------------------------------------

    /** 下载 7-Zip 核心并尽力解开。 */
    async function downloadCore(): Promise<{ ok: boolean; file?: string; extracted?: boolean; message?: string }> {
        const target = currentTarget()
        if (!target) return { ok: false, message: `unsupported platform: ${process.platform}/${process.arch}` }
        fsCall('mkdir', coreDir)

        const fileName = target.url.split('/').pop() ?? 'sevenzip-archive'
        const dl = await netCall<{ ok: boolean; canceled?: boolean; message?: string; file: string }>('download', {
            url: target.url,
            destDir: coreDir,
            fileName,
            proxyScope: 'node'
        })
        if (!dl.ok) return { ok: false, message: dl.message ?? 'download failed' }

        // 解开：Windows 的 extra.7z / Linux 与 macOS 的 .tar.xz。
        // 用 **e（展平解压）**：包内文件全部撒到 core 根下 —— 二进制以**散装**形式
        // 落位（core/7za.exe、core/7zz），不保留包内的 x64/ 等子目录结构。
        // 优先用「已存在的 7z」解（可能是系统装的，也可能是上一次下好的核心）；
        // 类 Unix 还可退回系统 tar（这两个发行包的二进制本来就在包根，天然散装）。
        const { path: bin } = locateBinaryPath()
        let extracted = false

        // 注意排除「刚下载的这个包」，它不能解自己。
        const usable7z = bin && path.resolve(bin) !== path.resolve(dl.file)
        if (usable7z) {
            const r = await run7z(['e', '-y', `-o${coreDir}`, dl.file])
            extracted = r.ok
        } else if (!process.platform.startsWith('win')) {
            const tar = await procCall<{ ok: boolean; stdout: string; stderrTail: string }>('run', 'tar', ['-xf', dl.file, '-C', coreDir], {
                timeoutMs: 5 * 60 * 1000
            })
            extracted = tar.ok
        }
        cached = null
        return {
            ok: true,
            file: dl.file,
            extracted,
            message: extracted ? undefined : 'downloaded, but auto-extract failed; extract the binary flat into the core directory manually'
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

    // ---- 对外提供能力 ---------------------------------------------------------

    /**
     * 注册 `ext:xeonsky.zip`。别的扩展申请后即可调用，例如：
     *
     * ```ts
     * const zip = ctx.capabilities.call('ext:xeonsky.zip', 'extract', { archive, destDir })
     * ```
     */
    ctx.provides.register('xeonsky.zip', {
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
        downloadCore,
        listTargets: () => TARGETS.map((t) => ({ os: t.os, arch: t.arch, label: t.label, url: t.url, binary: t.binary })),
        describe: () => describeCapabilities(),
        listFormats: () => describeCapabilities().formats,
        listMethods: () => describeCapabilities().methods,
        compress,
        extract,
        list,
        test,
        run: (argv: unknown) => run7z(Array.isArray(argv) ? argv.map(String) : [])
    } as unknown as Record<string, (...args: never[]) => unknown>)

    // ---- 面板用的 IPC（与对外能力同源，避免两套实现） -------------------------
    //
    // 注意 handler 的入参形状：路由器给的是**上下文对象** `{ event, params, query, body }`，
    // 渲染层 `ext.invoke(channel, payload)` 把 payload 放在 `body` 里（见 preload/index.ts）。
    // 所以这里统一取 `body`，而不是把它当成位置参数 —— 这是扩展端点最容易踩的一处。

    /** 取请求体（无 body 时给空对象，避免每个 handler 都判空）。 */
    const bodyOf = (c: unknown): Record<string, unknown> => {
        const o = c as { body?: unknown } | null
        return o && typeof o.body === 'object' && o.body !== null ? (o.body as Record<string, unknown>) : {}
    }

    ctx.ipc.handle('status', () => status())

    ctx.ipc.handle('setBinaryPath', (c) => {
        const cfg = readConfig()
        const p = bodyOf(c)['path']
        cfg.binaryPath = typeof p === 'string' ? p : ''
        writeConfig(cfg)
        cached = null
        return status()
    })

    ctx.ipc.handle('setTarget', (c) => {
        const cfg = readConfig()
        const key = bodyOf(c)['key']
        cfg.targetKey = typeof key === 'string' && key ? key : undefined
        writeConfig(cfg)
        cached = null
        return status()
    })

    ctx.ipc.handle('downloadCore', () => downloadCore())
    ctx.ipc.handle('listTargets', () => TARGETS.map((t) => ({ os: t.os, arch: t.arch, label: t.label, url: t.url, binary: t.binary })))
    ctx.ipc.handle('describe', () => describeCapabilities())
    ctx.ipc.handle('compress', (c) => compress(bodyOf(c) as unknown as CompressOptions))
    ctx.ipc.handle('extract', (c) => extract(bodyOf(c) as unknown as ExtractOptions))
    ctx.ipc.handle('list', (c) => {
        const b = bodyOf(c)
        return list({ archive: String(b['archive'] ?? ''), password: typeof b['password'] === 'string' ? b['password'] : undefined, entries: b['entries'] !== false })
    })
    ctx.ipc.handle('test', (c) => {
        const b = bodyOf(c)
        return test({ archive: String(b['archive'] ?? ''), password: typeof b['password'] === 'string' ? b['password'] : undefined })
    })

    ctx.log.info(`builtin extension xeonsky.zip activated (actions: ${CAPABILITY_ACTIONS.join(', ')})`)
}
