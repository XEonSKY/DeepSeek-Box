import type { ExtManifest } from '@shared/extensions'

/**
 * 内置扩展 `xeonsky.extm` —— 「扩展管理」页 + 扩展包管理 + 内置 7-Zip 归档核心。
 *
 * 它承担三件事，合并在一个扩展里（理由见同目录 main.ts 的说明）：
 *
 *  1. **界面**：贡献两个设置面板 —— 「扩展」（`view: 'extensions'`）与
 *     「归档（7-Zip）」（`view: 'zip'`），两者都指向渲染层登记的实现
 *     （见 renderer/extensions/panels.ts）。`icon` 是渲染层图标表的键
 *     （扩展不能传组件，只能给名字）。
 *  2. **包能力**：对外提供 `ext:xeonsky.extm`（status / extract / listPackages）。
 *     外部扩展除了「文件夹」形态，还支持压缩包形态（`.zip` 与 `.xeonsky-ext` ——
 *     后者是本项目的 zip 变种，内容相同）。解压由本扩展内部的 7-Zip 模块完成。
 *  3. **7-Zip 归档核心**：`sevenzip/` 子目录（原独立扩展 `xeonsky.zip`）。
 *     它是「归档页」与「扩展包解压」的共同实现，属于本扩展的内部模块 ——
 *     不再是可被用户停用的扩展（停用 7-Zip 会让内建的包加载功能失灵）。
 *
 * 申请的系统能力：
 *  - `fs`   读写自己的配置、探测二进制、建目录；
 *  - `proc` 跑 7z 命令行（复用内核 runChild 的登记 / 取消 / stderr 收集）。
 * 7-Zip 命令行核心**随扩展内置**（`sevenzip/bin/<平台>/`），因此不需要 `net`。
 */
export const manifest: ExtManifest = {
    id: 'xeonsky.extm',
    name: '扩展管理',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: ['fs', 'proc'],
    contributions: {
        settings: [
            { key: 'extensions', titleKey: 'ext.xeonskyExtm.nav', view: 'extensions', icon: 'app' },
            // 归档页紧随扩展页：两者同属「扩展自身能力」的一组，放一起便于排查。
            { key: 'zip', titleKey: 'ext.xeonskyExtm.zip.nav', view: 'zip', icon: 'archive' }
        ]
    }
}
