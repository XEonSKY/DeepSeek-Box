/**
 * 内置扩展 `xeonsky.extm` —— 「扩展管理」页的贡献者 + 包能力的管理面。
 *
 * 它做两件事：
 *  1. 在设置页贡献一个面板（`contributions.settings`），视图交给外壳登记的实现
 *     （渲染层的 `view: 'extensions'`）；
 *  2. 把包清单能力转成**渲染层可达的 IPC 端点** —— 渲染层扩展代码只能走
 *     `renderer-api`，没有能力调用权；读取扩展目录要主进程侧做，所以这里做一次转发。
 *
 * ## 为什么「包管理」与「管理界面」合成一个扩展
 *
 * 原先是两个内置扩展（`xeonsky.extm` 提供包能力、`xeonsky.extui` 提供界面并转发
 * 包能力给渲染层）。两者的**生命周期完全同步**：界面没有包能力就是残缺的、包能力
 * 没有界面就无从使用；拆成两个只多出一层「能力槽转发」的间接。合并后：
 *
 *  - 包清单读取与它的界面同处一个扩展，不再需要跨扩展的能力申请与降级分支；
 *  - 停用本扩展 = 管理页消失，语义清晰。
 *
 * ## 7-Zip 已下沉为内核模块（本扩展不再持有归档能力）
 *
 * `sevenzip/` 子目录与原来的独立扩展 `xeonsky.zip` 都已移除：
 *
 *  - **能力面**：归档能力（压缩 / 解压 / 列目录 / 探测核心）现由内核模块
 *    `src/main/zip/` 直接提供，加载器解压扩展包时直接 import 它，不再经能力槽转发；
 *  - **界面**：原先的「归档（7-Zip）」设置面板已取消 —— 7-Zip 在本程序里的真正用途
 *    是**内部**的（解压扩展包），面向用户的手动归档界面对本项目几乎没有价值，
 *    却要长期维护四十余个格式 / 方法条目。
 *
 * 本扩展现在只剩「管理界面 + 列出扩展包」这一件事 —— 因此不再需要 `proc` 能力
 * （跑 7z 命令行已归内核），也不再需要 `fs`（列目录在内核门面里做）。
 *
 * ## 职责边界（与加载器分工）
 *
 *  - **本扩展**：把「有哪些扩展包」告诉渲染层（内核 zip 门面查包文件 + 状态）；
 *  - **加载器**（`loader/index.ts` 的 `loadPkgExtensions`）：包文件扫描、包名冲突判定、
 *    清单读取、解压与扩展激活 —— 那些是「发现与装配」职责，不在这里。
 *
 * 基础管理端点（列表 / 启停 / 重载 / 安全模式）属于内核模块
 * （`main/modules/extensions.ts`），因为它们是**外壳自身**的能力（即便所有扩展被
 * 安全模式停掉，也要能操作），不能依赖扩展加载成功；本扩展只做依赖扩展生态的部分。
 *
 * 这个扩展的全部定义就落在本目录（`src/extensions/xeonsky.extm/`）：
 * 本文件与同目录的 `manifest.ts` 是主进程侧，`ExtensionsPanel.vue` + `locales.ts`
 * 是渲染层界面与文案。
 */
import { listPackages, pkgStatus } from '@main/zip/core'
import type { ExtContext } from '@main/extensions/loader/ctx'

/** 本扩展对外提供的能力动作名（与 provides.register 的表一致）。 */
export const CAPABILITY_ACTIONS = ['status', 'listPackages'] as const

/** IPC handler 的入参形状（Router 传上下文对象，payload 在 body）。 */
interface IpcContext {
    body?: { dir?: unknown }
}

export function activate(ctx: ExtContext): void {
    const status = () => pkgStatus()

    // 对外提供包能力（其它扩展若需要包清单可经能力槽取用）。
    ctx.provides.register('xeonsky.extm', {
        status,
        listPackages: (options: { root: string }) => listPackages(options.root)
    } as unknown as Record<string, (...args: never[]) => unknown>)

    // ---- 渲染层通道 ---------------------------------------------------------
    // 管理页要展示「扩展包」区块，但渲染层不能扫主进程的文件系统，
    // 只能经本扩展的 IPC 端点。

    /** 管理页用：7-Zip 是否可用（不可用 = 压缩包加载被禁用）+ 支持的包格式。 */
    ctx.ipc.handle('pkgStatus', () => status())

    /** 列出外部扩展目录下的包文件（渲染层传 `info.externalDir` 进来）。 */
    ctx.ipc.handle('listPackages', (...args: unknown[]) => {
        const body = (args[0] as IpcContext | undefined)?.body
        const dir = typeof body?.dir === 'string' ? body.dir : ''
        if (!dir) return { packages: [] }
        try {
            return { packages: listPackages(dir) }
        } catch {
            return { packages: [] }
        }
    })

    ctx.log.info(`builtin extension xeonsky.extm activated (settings panel "Extensions", actions: ${CAPABILITY_ACTIONS.join(', ')})`)
}
