import type { StaticExt } from '../loader/sources'
import * as xeonskyExtm from '@ext/xeonsky.extm/main'
import { manifest as xeonskyExtmManifest } from '@ext/xeonsky.extm/manifest'
import * as xeonskyBrowser from '@ext/xeonsky.browser/main'
import { manifest as xeonskyBrowserManifest } from '@ext/xeonsky.browser/manifest'

/**
 * 内置扩展登记表：源码在本目录，随构建产物发布。
 *
 * 与外部扩展的区别（这也是内置这一级存在的意义）：
 *  - 随安装包发布，用户**不能卸载**（但可以停用），因此适合放「外壳自带但可选」的能力；
 *  - 经编译期检查，不存在半成品代码的风险；
 *  - 可以通过设置面板贡献里的 `view` 指定**渲染层本地组件**（外部扩展不能，见
 *    renderer/extensions/panels.ts 的说明）；
 *  - 受崩溃计数与安全模式影响（与外部扩展同等待遇）—— 它有可能是我们在这一版引入的
 *    问题，用户仍需要一条「全部关掉」的自救路径。
 *
 * 迁入一个扩展 = 写一个目录（`src/extensions/<id>/`，内含 main.ts 与 manifest.ts，可含 .vue）+ 在这里加一行。
 * 清单写在扩展自己的目录里（见 xeonsky.extm/manifest.ts 的说明），
 * 登记表只回答「有哪些内置扩展」。
 *
 * 目录在顶层 `src/extensions/` 而不是 `src/main/` 下：一个内置扩展同时有主进程与渲染层文件，
 * 而这两端分属两个构建入口（见 electron.vite.config.ts）。放在中立的顶层目录，
 * 两端都能以 `@ext/<id>/...` 引用，改一个扩展只动一个目录。
 */
export const builtinExtensions: StaticExt[] = [
    {
        // 扩展管理：设置面板（「扩展管理」页）+ 扩展包清单。
        // 7-Zip 归档核心已下沉为内核模块（`main/zip/`），加载器直接使用它；
        // 本扩展不含归档能力、也不申请系统能力，只把「有哪些扩展包」转给渲染层。
        kind: 'builtin',
        sourceDir: 'src/extensions/xeonsky.extm',
        manifest: xeonskyExtmManifest,
        module: xeonskyExtm
    },
    {
        // 内嵌浏览器：webview 功能（UA / 代理 / 权限策略）已从内核迁到本扩展。
        // 申请 webview（Session 包装）与 fs（读写自己的配置）两项系统能力，
        // 对外提供 ext:xeonsky.browser。内核在建窗之前经能力槽取用它应用会话设置
        // （见 app/webview.ts 的薄转发）。
        // manifest 的 preReady 字段声明硬件加速归属 —— 由内核在 ready 前预读
        // （见 extensions/preready.ts）。
        kind: 'builtin',
        sourceDir: 'src/extensions/xeonsky.browser',
        manifest: xeonskyBrowserManifest,
        module: xeonskyBrowser
    }
]
