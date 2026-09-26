import { app } from 'electron'
import { systemExtensions } from './system'
import { builtinExtensions } from './builtin'
import type { Settings } from '@shared/types'
import { logger } from '../kernel/logger'

/**
 * 启动前配置的应用点（**必须在 `app.whenReady()` 之前调用**）。
 *
 * ## 为什么需要它
 *
 * Electron 有一批设置在进程就绪那一刻就被固化，之后调用静默无效 —— 典型是
 * `app.disableHardwareAcceleration()`。而扩展层的加载（`startLoader()`）本身
 * 就在 ready **之后**，等它跑到已经太晚。于是做法反过来：内核在 ready 之前
 * 扫一遍**静态登记的**扩展清单（系统 + 内置，源码随构建进包、无需磁盘发现），
 * 把它们申报的 `preReady` 配置先应用掉。
 *
 * ## 为什么只认静态扩展
 *
 * 外部扩展装在磁盘上：ready 前读它的 manifest 需要同步 IO、且信任度不足
 * （它的代码还没经过任何加载期检查）。所以本模块**只看** `systemExtensions` /
 * `builtinExtensions` 两张编译期常量表 —— 它们既是纯数据，也已在 bundle 里。
 *
 * ## 为什么不走 `installStaticExts` / `staticExts()`
 *
 * 那两条依赖加载器已注入的表，而注入发生在 `registerIpc()`（ready 之后）。
 * 本模块在更早的时机运行，故直接引用两张常量表 —— 依赖方向也更干净：
 * 它不经过 loader，只是「内核预读编译期已知的扩展清单」。
 *
 * ## 与用户设置的关系
 *
 * 硬件加速有两个来源可以关掉它：**用户设置**（`settings.hardwareAcceleration === false`）
 * 与**扩展申报**。二者取「或」—— 任一要求禁用即禁用。理由：用户显式关掉它是有意的；
 * 扩展申报禁用通常出于兼容性诉求（如某些驱动下 webview 渲染异常），
 * 静默忽略某一方都会让「我明明关了却没生效」这类问题无从排查。
 *
 * 这里**不读设置文件**：调用方（index.ts）已单独读过一次，把结果作为参数传入，
 * 避免本模块与启动流程各读一份、出现两处判断分歧。
 */
export function applyPreReadyExtConfig(cfg: Settings): void {
    const exts = [...systemExtensions, ...builtinExtensions]
    const byExt = exts
        .map((e) => ({ id: e.manifest.id, pre: e.manifest.preReady }))
        .filter((e): e is { id: string; pre: NonNullable<typeof e.pre> } => Boolean(e.pre))

    const wantDisableHwAccel =
        cfg.hardwareAcceleration === false ||
        byExt.some((e) => e.pre.disableHardwareAcceleration === true)

    if (!wantDisableHwAccel) return

    app.disableHardwareAcceleration()
    const log = logger('[ExtPreReady]')
    const fromExt = byExt
        .filter((e) => e.pre.disableHardwareAcceleration === true)
        .map((e) => e.id)
    log.info(
        { fromSettings: cfg.hardwareAcceleration === false, fromExtensions: fromExt },
        'hardware acceleration disabled before ready'
    )
}
