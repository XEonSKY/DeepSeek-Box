/**
 * 扩展包管理器（内置扩展）—— 管理 `.zip` / `.xeonsky-ext` 外部扩展包。
 *
 * 职责边界：
 *  - **解压一个包**（extract）：加载器第二阶段用它把压缩包扩展展开到暂存目录；
 *  - **包清单**（listPackages）：扩展管理页的「扩展包」区块经它列出已放置的包；
 *  - **状态自报**（status）：7-Zip 是否可用（压缩包加载功能的开关依据）。
 *
 * 包文件扫描、包名冲突判定、清单读取与扩展激活都在加载器
 * （loader/index.ts 的 loadPkgExtensions）—— 那些是「发现与装配」职责。
 *
 * **7-Zip 是软依赖**（manifest 不写 dependencies）：`.zip` 与 `.xeonsky-ext` 都是
 * 7-Zip 支持的归档格式，解压内部转发给 `ext:xeonsky.zip`。7-Zip 扩展被停用、
 * 加载失败时本扩展照常激活，但 status 自报不可用、extract 返回 disabled ——
 * 加载器据此**禁用压缩包扩展加载**（不做任何包文件读取）。
 */
import path from 'node:path'
import type { ExtContext } from '@main/extensions/loader/ctx'

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

export function activate(ctx: ExtContext): void {
    const zipCall = <T,>(action: string, ...args: unknown[]): T =>
        ctx.capabilities.call<T>('ext:xeonsky.zip', action, ...args)
    const fsCall = <T,>(action: string, ...args: unknown[]): T =>
        ctx.capabilities.call<T>('fs', action, ...args)

    /** 7-Zip 是否可用（实时判定：用户可随时停用 / 启用 7-Zip 扩展后刷新）。 */
    const zipAvailable = (): boolean => ctx.capabilities.has('ext:xeonsky.zip')

    const status = (): PkgStatus => ({ zipAvailable: zipAvailable(), formats: [...PKG_EXTS.map((e) => e.slice(1))] })

    /**
     * 解压一个扩展包到目标目录。
     *
     * 7-Zip 不可用 → 返回 disabled（加载器据此把包记为 skipped，不做读取）。
     * 覆盖策略取 overwrite（-aoa）：加载器在解压前会清空目标目录，包内容是权威来源。
     */
    const extract = async (options: PkgExtractOptions): Promise<PkgExtractResult> => {
        if (!zipAvailable()) {
            return { ok: false, disabled: true, message: '7-Zip 扩展不可用，压缩包扩展加载已禁用' }
        }
        try {
            const r = await zipCall<{ ok: boolean; output?: string; message?: string }>('extract', {
                archive: path.resolve(options.file),
                destDir: path.resolve(options.destDir),
                overwrite: 'overwrite'
            })
            return r.ok ? { ok: true } : { ok: false, message: r.message ?? r.output ?? '7-Zip 返回失败' }
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : String(err) }
        }
    }

    /** 列出外部扩展根目录下的包文件（*.zip / *.xeonsky-ext，按文件名排序）。 */
    const listPackages = (options: PkgListOptions): PkgEntry[] => {
        const entries = fsCall<Array<{ name: string; isDirectory: boolean }>>('list', path.resolve(options.root))
        const out: PkgEntry[] = []
        for (const entry of entries) {
            if (entry.isDirectory) continue
            const lower = entry.name.toLowerCase()
            const hit = PKG_EXTS.find((ext) => lower.endsWith(ext))
            if (!hit) continue
            out.push({
                file: path.join(path.resolve(options.root), entry.name),
                stem: entry.name.slice(0, -hit.length),
                format: hit.slice(1)
            })
        }
        out.sort((a, b) => a.stem.localeCompare(b.stem) || a.file.localeCompare(b.file))
        return out
    }

    ctx.provides.register('xeonsky.extm', {
        status,
        extract,
        listPackages
    } as unknown as Record<string, (...args: never[]) => unknown>)

    ctx.log.info(`builtin extension xeonsky.extm activated (actions: ${CAPABILITY_ACTIONS.join(', ')})`)
}
