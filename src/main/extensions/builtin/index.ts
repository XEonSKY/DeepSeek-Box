import type { StaticExt } from '../loader/sources'
import * as xeonskyExtui from '@ext/xeonsky.extui/main'
import { manifest as xeonskyExtuiManifest } from '@ext/xeonsky.extui/manifest'
import * as xeonskyZip from '@ext/xeonsky.zip/main'
import { manifest as xeonskyZipManifest } from '@ext/xeonsky.zip/manifest'
import * as xeonskyExtm from '@ext/xeonsky.extm/main'
import { manifest as xeonskyExtmManifest } from '@ext/xeonsky.extm/manifest'
import * as xeonskyDownload from '@ext/xeonsky.download/main'
import { manifest as xeonskyDownloadManifest } from '@ext/xeonsky.download/manifest'

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
 * 清单写在扩展自己的目录里（见 xeonsky.extui/manifest.ts 的说明），
 * 登记表只回答「有哪些内置扩展」。
 *
 * 目录在顶层 `src/extensions/` 而不是 `src/main/` 下：一个内置扩展同时有主进程与渲染层文件，
 * 而这两端分属两个构建入口（见 electron.vite.config.ts）。放在中立的顶层目录，
 * 两端都能以 `@ext/<id>/...` 引用，改一个扩展只动一个目录。
 */
export const builtinExtensions: StaticExt[] = [
    {
        kind: 'builtin',
        sourceDir: 'src/extensions/xeonsky.extui',
        manifest: xeonskyExtuiManifest,
        module: xeonskyExtui
    },
    {
        // 归档（7-Zip）：申请 fs / net / proc 三项系统能力，对外提供 ext:xeonsky.zip。
        // 依赖系统扩展全部就位（它在排序中排在内置之前，见 loader/sources.ts 的 staticExts），
        // 所以这里的 capabilities 在激活时必然已提供。
        kind: 'builtin',
        sourceDir: 'src/extensions/xeonsky.zip',
        manifest: xeonskyZipManifest,
        module: xeonskyZip
    },
    {
        // 扩展包管理器：声明硬依赖 xeonsky.zip（7-Zip 被停用/失败时它也不加载，
        // 压缩包扩展随之全部跳过、不做读取）。压缩包形态外部扩展的加载时序
        // 在 loader 第二阶段（loadPkgExtensions），见 loader/index.ts。
        kind: 'builtin',
        sourceDir: 'src/extensions/xeonsky.extm',
        manifest: xeonskyExtmManifest,
        module: xeonskyExtm
    },
    {
        // 下载：申请 fs / net 两项系统能力，对外提供 ext:xeonsky.download。
        // 内核侧的调用（Node 发行包、内置 npm / pnpm）经能力槽按名字取用它
        // （见 dsh/download.ts），不 import 本扩展 —— 于是它被停用时内核回落自带下载器，
        // 而不是启动失败。
        kind: 'builtin',
        sourceDir: 'src/extensions/xeonsky.download',
        manifest: xeonskyDownloadManifest,
        module: xeonskyDownload
    }
]
