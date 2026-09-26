/**
 * 内置扩展 `xeonsky.extm` —— 「扩展管理」页的贡献者 + 包能力的管理面。
 *
 * 它做两件事：
 *  1. 在设置页贡献一个面板（`contributions.settings`），视图交给外壳登记的实现
 *     （渲染层的 `view: 'extensions'`）；
 *  2. 把包管理能力（**本扩展自己提供**的 `ext:xeonsky.extm`）转成**渲染层可达的
 *     IPC 端点** —— 渲染层扩展代码只能走 `renderer-api`，没有能力调用权；
 *     能力调用只能发生在主进程侧，所以这里做一次转发：`pkgStatus` / `listPackages`。
 *
 * ## 为什么「包管理」与「管理界面」合成一个扩展
 *
 * 原先是两个内置扩展（`xeonsky.extm` 提供包能力、`xeonsky.extui` 提供界面并转发
 * 包能力给渲染层）。两者的**生命周期完全同步**：界面没有包能力就是残缺的、包能力
 * 没有界面就无从使用；拆成两个只多出一层「能力槽转发」的间接，且 `extui` 里那句
 * `capabilities.has('ext:xeonsky.extm')` 永远为真。合并后：
 *
 *  - 包能力与它的界面同处一个扩展，不再需要跨扩展的能力申请与降级分支；
 *  - 加载器不再需要为「extui 依赖 extm」的软依赖留位置；
 *  - 停用本扩展 = 管理页消失，语义清晰（管理页由扩展提供，正符合「用同一套控制点
 *    呈现管理页」的设计目标）。
 *
 * ## 职责边界（与加载器分工）
 *
 *  - **本扩展**：解压一个包（extract）、列出包清单（listPackages）、状态自报（status）；
 *  - **加载器**（`loader/index.ts` 的 `loadPkgExtensions`）：包文件扫描、包名冲突判定、
 *    清单读取与扩展激活 —— 那些是「发现与装配」职责，不在这里。
 *
 * 基础管理端点（列表 / 启停 / 重载 / 安全模式）属于内核模块
 * （`main/modules/extensions.ts`），因为它们是**外壳自身**的能力（即便所有扩展被
 * 安全模式停掉，也要能操作），不能依赖扩展加载成功；本扩展只做依赖扩展生态的部分。
 *
 * ## 7-Zip 是内部模块，不是可启停的扩展
 *
 * `sevenzip/` 子目录是本扩展内部的 7-Zip 归档核心（原是独立扩展 `xeonsky.zip`）。
 * 它既支撑「扩展管理页的归档区块」，也是**扩展包解压**的实现 —— 都是本扩展自身功能，
 * 因此不该有「用户把它关掉」的状态。核心跑在子进程里（经 `proc` 能力），
 * 二进制内置在 `sevenzip/bin/<平台>/`。
 *
 * 这个扩展的全部定义就落在本目录（`src/extensions/xeonsky.extm/`）：
 *  - 本文件与同目录的 `manifest.ts` —— 主进程侧（入口 + 清单）；
 *  - 同目录的 `ExtensionsPanel.vue` + `locales.ts` —— 渲染层界面与文案；
 *  - 同目录的 `sevenzip/` —— 内部 7-Zip 模块（含界面与内置二进制）。
 * 一个目录自成一体，主进程与渲染层两端都以 `@ext/<id>/...` 引用它。
 */
import path from 'node:path'
import type { ExtContext } from '@main/extensions/loader/ctx'
import { createSevenZip } from './sevenzip/core'
import type { CompressOptions, ExtractOptions } from './sevenzip/types'

/** extract 动作的入参（与能力契约同步维护）。 */
export interface PkgExtractOptions {
    /** 包文件绝对路径（.zip 或 .xeonsky-ext）。 */
    file: string
    /** 解压目标目录（加载器保证已存在或可创建）。 */
    destDir: string
}

/** extract 动作的返回。disabled=true 表示 7-Zip 不可用、功能被禁用。 */
export interface PkgExtractResult {
    ok: boolean
    disabled?: boolean
    /** 失败或禁用时的说明。 */
    message?: string
}

/** listPackages 动作的入参。 */
export interface PkgListOptions {
    /** 外部扩展根目录（`~/.dsbox/{channel}/extensions`）。 */
    root: string
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

/** status 动作的返回。 */
export interface PkgStatus {
    /** 7-Zip 扩展是否可用（不可用 = 压缩包扩展加载被禁用）。 */
    zipAvailable: boolean
    /** 支持的包格式。 */
    formats: string[]
}

/** 本扩展对外提供的能力动作名（与 provides.register 的表一致）。 */
export const CAPABILITY_ACTIONS = ['status', 'extract', 'listPackages'] as const

/** 支持的包文件扩展名（大小写不敏感；`.xeonsky-ext` 是本项目的 zip 变种）。 */
const PKG_EXTS = ['.zip', '.xeonsky-ext'] as const

/** IPC handler 的入参形状（Router 传上下文对象，payload 在 body）。 */
interface IpcContext {
    body?: { dir?: unknown }
}

export function activate(ctx: ExtContext): void {
    const fsCall = <T,>(action: string, ...args: unknown[]): T =>
        ctx.capabilities.call<T>('fs', action, ...args)

    // ---- 内部 7-Zip 归档核心 ---------------------------------------------------
    // 原独立扩展 xeonsky.zip，现为本扩展的内部模块（见目录头说明）。

    const sevenZip = createSevenZip(ctx)

    /** 7-Zip 是否可用（实时判定：探测二进制能否跑出版本）。 */
    const zipAvailable = async (): Promise<boolean> => {
        try {
            const s = await sevenZip.status()
            return s.available
        } catch {
            return false
        }
    }

    const status = async (): Promise<PkgStatus> => ({
        zipAvailable: await zipAvailable(),
        formats: [...PKG_EXTS.map((e) => e.slice(1))]
    })

    /**
     * 解压一个扩展包到目标目录。
     *
     * 7-Zip 不可用 → 返回 disabled（加载器据此把包记为 skipped，不做读取）。
     * 覆盖策略取 overwrite（-aoa）：加载器在解压前会清空目标目录，包内容是权威来源。
     */
    const extract = async (options: PkgExtractOptions): Promise<PkgExtractResult> => {
        if (!(await zipAvailable())) {
            return { ok: false, disabled: true, message: '7-Zip 核心不可用，压缩包扩展加载已禁用' }
        }
        try {
            const r = await sevenZip.extract({
                archive: path.resolve(options.file),
                destDir: path.resolve(options.destDir),
                overwrite: 'overwrite'
            })
            return r.ok ? { ok: true } : { ok: false, message: r.output || '7-Zip 返回失败' }
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : String(err) }
        }
    }

    /** 列出外部扩展根目录下的包文件（*.zip / *.xeonsky-ext，按文件名排序）。 */
    const listPackages = (options: PkgListOptions): PkgEntry[] => {
        const root = path.resolve(options.root)
        // fs.list 只给目录名（string[]）；包文件都是普通文件，逐个 stat 排除子目录。
        const names = fsCall<string[]>('list', root)
        const out: PkgEntry[] = []
        for (const name of names) {
            const lower = name.toLowerCase()
            const hit = PKG_EXTS.find((ext) => lower.endsWith(ext))
            if (!hit) continue
            const file = path.join(root, name)
            const st = fsCall<{ isDirectory: boolean } | null>('stat', file)
            if (st?.isDirectory) continue
            out.push({ file, stem: name.slice(0, -hit.length), format: hit.slice(1) })
        }
        out.sort((a, b) => a.stem.localeCompare(b.stem) || a.file.localeCompare(b.file))
        return out
    }

    // 对外提供包能力（加载器第二阶段与其它扩展协作都走这条）。
    ctx.provides.register('xeonsky.extm', {
        status,
        extract,
        listPackages
    } as unknown as Record<string, (...args: never[]) => unknown>)

    // ---- 渲染层通道 ---------------------------------------------------------
    // 管理页要展示「扩展包」与「归档」两个区块，但渲染层没有能力调用权，
    // 只能经本扩展的 IPC 端点。端点直接调用上面的本地实现（不再经能力槽转发）。

    /** 管理页用：7-Zip 是否可用（不可用 = 压缩包加载被禁用）+ 支持的包格式。 */
    ctx.ipc.handle('pkgStatus', () => status())

    /** 列出外部扩展目录下的包文件（渲染层传 `info.externalDir` 进来）。 */
    ctx.ipc.handle('listPackages', (...args: unknown[]) => {
        const body = (args[0] as IpcContext | undefined)?.body
        const dir = typeof body?.dir === 'string' ? body.dir : ''
        if (!dir) return { packages: [] }
        try {
            return { packages: listPackages({ root: dir }) }
        } catch {
            return { packages: [] }
        }
    })

    // ---- 归档区块（原 xeonsky.zip 面板）的 IPC -------------------------------
    //
    // 注意 handler 的入参形状：路由器给的是**上下文对象** `{ event, params, query, body }`，
    // 渲染层 `ext.invoke(channel, payload)` 把 payload 放在 `body` 里（见 preload/index.ts）。
    // 所以这里统一取 `body`，而不是把它当成位置参数 —— 这是扩展端点最容易踩的一处。

    /** 取请求体（无 body 时给空对象，避免每个 handler 都判空）。 */
    const bodyOf = (c: unknown): Record<string, unknown> => {
        const o = c as { body?: unknown } | null
        return o && typeof o.body === 'object' && o.body !== null ? (o.body as Record<string, unknown>) : {}
    }

    ctx.ipc.handle('zipStatus', () => sevenZip.status())

    ctx.ipc.handle('zipSetBinaryPath', (c) => {
        sevenZip.setBinaryPath(bodyOf(c)['path'])
        return sevenZip.status()
    })

    ctx.ipc.handle('zipListTargets', () => sevenZip.listTargets())
    ctx.ipc.handle('zipDescribe', () => sevenZip.describe())
    ctx.ipc.handle('zipCompress', (c) => sevenZip.compress(bodyOf(c) as unknown as CompressOptions))
    ctx.ipc.handle('zipExtract', (c) => sevenZip.extract(bodyOf(c) as unknown as ExtractOptions))
    ctx.ipc.handle('zipList', (c) => {
        const b = bodyOf(c)
        return sevenZip.list({
            archive: String(b['archive'] ?? ''),
            password: typeof b['password'] === 'string' ? b['password'] : undefined,
            entries: b['entries'] !== false
        })
    })
    ctx.ipc.handle('zipTest', (c) => {
        const b = bodyOf(c)
        return sevenZip.test({
            archive: String(b['archive'] ?? ''),
            password: typeof b['password'] === 'string' ? b['password'] : undefined
        })
    })

    ctx.log.info(`builtin extension xeonsky.extm activated (settings panel "Extensions", actions: ${CAPABILITY_ACTIONS.join(', ')})`)
}
