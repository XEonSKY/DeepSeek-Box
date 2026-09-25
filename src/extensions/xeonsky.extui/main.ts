import type { ExtContext } from '@main/extensions/loader/ctx'

/**
 * 内置扩展 `xeonsky.extui` —— 「扩展管理」页的贡献者 + 包管理的界面通道。
 *
 * 它做两件事：
 *  1. 在设置页贡献一个面板（`contributions.settings`），视图交给外壳登记的实现
 *     （渲染层的 `view: 'extensions'`）；
 *  2. 把包管理能力（`ext:xeonsky.extm` 提供）转成**渲染层可达的 IPC 端点** ——
 *     渲染层扩展代码只能走 `renderer-api`，没有能力调用权；能力调用只能发生在
 *     主进程侧，所以 extui 在中间做一次转发：`pkgStatus` / `listPackages`。
 *
 * 为什么把管理页做成扩展（而不是外壳里的一个内置面板）：
 * 「扩展管理」需要能用**同一套**控制点去呈现 —— 如果它走特例，就无法验证
 * 「内置扩展与外部扩展在控制点上待遇一致」这条设计目标；而且将来把管理页
 * 交给第三方实现，只需要改这一个扩展。
 *
 * 基础管理端点（列表 / 启停 / 安全模式）属于内核模块（`modules/extensions.ts`），
 * 因为它们是**外壳自身**的能力（即便所有扩展被安全模式停掉，也要能操作），
 * 不能依赖扩展加载成功；本扩展只补充依赖扩展生态的部分（包管理）。
 *
 * `ext:xeonsky.extm` 是**软依赖**（manifest 只写 capabilities）：extm 未激活时
 * 包管理端点降级返回空值，页面少一个区块，其余功能照常。
 *
 * 这个扩展的全部定义就落在本目录（`src/extensions/xeonsky.extui/`）：
 *  - 本文件与同目录的 `manifest.ts` —— 主进程侧（入口 + 清单）；
 *  - 同目录的 `ExtensionsPanel.vue` —— 渲染层界面。
 * 一个目录自成一体，主进程与渲染层两端都以 `@ext/<id>/...` 引用它。
 */

/** IPC handler 的入参形状（Router 传上下文对象，payload 在 body）。 */
interface IpcContext {
    body?: { dir?: unknown }
}

export function activate(ctx: ExtContext): void {
    const extmAvailable = (): boolean => ctx.capabilities.has('ext:xeonsky.extm')
    const extmCall = <T,>(action: string, ...args: unknown[]): T =>
        ctx.capabilities.call<T>('ext:xeonsky.extm', action, ...args)

    /** 包管理状态：功能是否就绪、7-Zip 是否可用（不可用 = 压缩包加载被禁用）。 */
    ctx.ipc.handle('pkgStatus', () => {
        if (!extmAvailable()) return { available: false, zipAvailable: false, formats: [] as string[] }
        try {
            const s = extmCall<{ zipAvailable: boolean; formats: string[] }>('status')
            return { available: true, zipAvailable: s.zipAvailable, formats: s.formats }
        } catch {
            return { available: true, zipAvailable: false, formats: [] as string[] }
        }
    })

    /** 列出外部扩展目录下的包文件（渲染层传 `info.externalDir` 进来）。 */
    ctx.ipc.handle('listPackages', (...args: unknown[]) => {
        const body = (args[0] as IpcContext | undefined)?.body
        const dir = typeof body?.dir === 'string' ? body.dir : ''
        if (!dir || !extmAvailable()) return { packages: [] }
        try {
            return { packages: extmCall<Array<{ file: string; stem: string; format: string }>>('listPackages', { root: dir }) }
        } catch {
            return { packages: [] }
        }
    })

    ctx.log.info('builtin extension xeonsky.extui activated (contributes: settings panel "Extensions", pkg IPC)')
}
