import type { StaticExt } from '../loader/sources'
import * as sysFs from './system.fs/main'
import * as sysNet from './system.net/main'
import * as sysProc from './system.proc/main'
import * as sysApp from './system.app/main'
import * as sysUi from './system.ui/main'
import * as sysWebview from './system.webview/main'
import * as sysExtmanage from './system.extmanage/main'

/**
 * 系统扩展登记表。
 *
 * 系统扩展是「系统能力抽象化的体现」：它们自己**不实现**任何能力，
 * 只把内核已有的实现（`kernel/treeops`、`dsh/http`、`dsh/child`、`kernel/services`）
 * 按动作注册进能力槽，让外部扩展用同一条路径取用 —— 无需区分「系统给的」还是
 * 「别的扩展给的」。
 *
 * 为什么是静态表而不是扫目录：这些模块经构建编译进主进程 bundle，
 * 运行时磁盘上没有独立目录（见 loader/sources.ts 的说明）。
 * 表在这里 = 「编译期决定有哪些」，与「运行期加载用户代码」形成清晰的信任二分。
 *
 * 顺序即系统扩展的激活顺序。能力之间没有依赖（各自包装不同内核入口），
 * 因此顺序目前不重要；将来若出现「能力 A 的包装要用能力 B」，在这里排序并说明原因。
 */
export const systemExtensions: StaticExt[] = [
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/system.fs',
        manifest: { id: 'system.fs', name: '文件系统能力', version: '1.0.0', apiVersion: 1 },
        module: sysFs
    },
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/system.net',
        manifest: { id: 'system.net', name: '网络请求能力', version: '1.0.0', apiVersion: 1 },
        module: sysNet
    },
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/system.proc',
        manifest: { id: 'system.proc', name: '子进程能力', version: '1.0.0', apiVersion: 1 },
        module: sysProc
    },
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/system.app',
        manifest: { id: 'system.app', name: '应用服务能力', version: '1.0.0', apiVersion: 1 },
        module: sysApp
    },
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/system.ui',
        manifest: { id: 'system.ui', name: '界面操作能力', version: '1.0.0', apiVersion: 1 },
        module: sysUi
    },
    {
        // 内嵌页面会话能力：包装 defaultSession 的 UA / 代理 / 权限处理器。
        // 目前唯一的消费者是内置扩展 xeonsky.browser —— 它把浏览器功能从内核
        // 迁出后，只能经这条能力触达内核（见 AGENTS.md 红线）。
        kind: 'system',
        sourceDir: 'src/main/extensions/system/system.webview',
        manifest: { id: 'system.webview', name: '内嵌页面会话能力', version: '1.0.0', apiVersion: 1 },
        module: sysWebview
    },
    {
        // 扩展管理能力：包装加载器的重载 / 列表导出，供扩展生态内部互相协作
        // （「改完扩展代码立刻生效」）。内核自己的管理路由（modules/extensions.ts）
        // 与这条能力调用同一个加载器实现，因此不存在两套行为。
        kind: 'system',
        sourceDir: 'src/main/extensions/system/system.extmanage',
        manifest: { id: 'system.extmanage', name: '扩展管理能力', version: '1.0.0', apiVersion: 1 },
        module: sysExtmanage
    }
]
