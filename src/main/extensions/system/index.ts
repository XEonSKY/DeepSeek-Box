import type { StaticExt } from '../loader/sources'
import * as capFs from './cap.fs/main'
import * as capNet from './cap.net/main'
import * as capProc from './cap.proc/main'
import * as capApp from './cap.app/main'
import * as capUi from './cap.ui/main'

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
        sourceDir: 'src/main/extensions/system/cap.fs',
        manifest: { id: 'cap.fs', name: '文件系统能力', version: '1.0.0', apiVersion: 1 },
        module: capFs
    },
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/cap.net',
        manifest: { id: 'cap.net', name: '网络请求能力', version: '1.0.0', apiVersion: 1 },
        module: capNet
    },
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/cap.proc',
        manifest: { id: 'cap.proc', name: '子进程能力', version: '1.0.0', apiVersion: 1 },
        module: capProc
    },
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/cap.app',
        manifest: { id: 'cap.app', name: '应用服务能力', version: '1.0.0', apiVersion: 1 },
        module: capApp
    },
    {
        kind: 'system',
        sourceDir: 'src/main/extensions/system/cap.ui',
        manifest: { id: 'cap.ui', name: '界面操作能力', version: '1.0.0', apiVersion: 1 },
        module: capUi
    }
]
