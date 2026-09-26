import type { ExtManifest } from '@shared/extensions'

/**
 * 内置扩展 `xeonsky.extm` —— 「扩展管理」页 + 扩展包管理（清单与实现同目录）。
 *
 * 它同时承担两件事，合并在一个扩展里（理由见同目录 main.ts 的说明）：
 *
 *  1. **界面**：贡献一个设置面板（`view: 'extensions'` 指向渲染层登记的实现，
 *     见 renderer/extensions/panels.ts）。`icon: 'app'` 是渲染层图标表的键
 *     （扩展不能传组件，只能给名字）。
 *  2. **包能力**：对外提供 `ext:xeonsky.extm`（status / extract / listPackages）。
 *     外部扩展除了「文件夹」形态，还支持压缩包形态（`.zip` 与 `.xeonsky-ext` ——
 *     后者是本项目的 zip 变种，内容相同）。解压这件事不放进加载器：加载器不做格式
 *     解析，它只认「目录里有 manifest.json」。真正的解压能力由本扩展转发给
 *     `xeonsky.zip`（7-Zip 命令行核心），于是 zip/xeonsky-ext 的支持随 7-Zip 的
 *     格式表走。
 *
 * **7-Zip 是软依赖**（刻意不写 dependencies）：`xeonsky.zip` 被停用 / 加载失败时
 * 本扩展照常激活，但 status 自报不可用、extract 返回 disabled，加载器据此
 * **禁用压缩包扩展加载**（不读取包文件）。压缩包形态的扩展在**全部普通扩展
 * 加载结束后**由加载器的第二阶段处理（见 loader/index.ts 的 loadPkgExtensions）。
 */
export const manifest: ExtManifest = {
    id: 'xeonsky.extm',
    name: '扩展管理',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: ['fs', 'ext:xeonsky.zip'],
    contributions: {
        settings: [{ key: 'extensions', titleKey: 'ext.xeonskyExtm.nav', view: 'extensions', icon: 'app' }]
    }
}
