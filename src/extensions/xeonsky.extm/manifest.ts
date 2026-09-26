import type { ExtManifest } from '@shared/extensions'

/**
 * 内置扩展 `xeonsky.extm` —— 「扩展管理」页 + 扩展包清单。
 *
 * 它做两件事，合并在一个扩展里（理由见同目录 main.ts 的说明）：
 *
 *  1. **界面**：贡献一个设置面板 —— 「扩展管理」（`view: 'extensions'`），
 *     指向渲染层登记的实现（见 renderer/extensions/panels.ts）。`icon` 是渲染层图标表的键
 *     （扩展不能传组件，只能给名字）。
 *  2. **包清单**：把「外部扩展目录下有哪些压缩包」告诉管理页
 *     （外部扩展除「文件夹」形态外还支持压缩包形态 `.zip` / `.xeonsky-ext`）。
 *
 * ## 7-Zip 已下沉为内核能力
 *
 * 原先本扩展内部还有一个 `sevenzip/` 模块（更早是独立扩展 `xeonsky.zip`），
 * 负责解压扩展包并支撑「归档（7-Zip）」设置面板。两者都已移除：
 *
 *  - **能力**：归档能力迁到内核 `src/main/zip/`，由加载器直接 import；
 *  - **界面**：面向用户的手动归档面板已取消（7-Zip 在本程序里只用于内部解压扩展包）。
 *
 * 于是本扩展**不再申请任何系统能力**：列扩展包目录由内核 zip 门面做，
 * 跑 7z 命令行归内核 —— 扩展侧剩下的只是几行转发。
 *
 * 7-Zip 命令行核心**随应用内置**（`src/main/zip/bin/<平台>/`）。
 */
export const manifest: ExtManifest = {
    id: 'xeonsky.extm',
    name: '扩展管理',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: [],
    contributions: {
        settings: [{ key: 'extensions', titleKey: 'ext.xeonskyExtm.nav', view: 'extensions', icon: 'app' }]
    }
}
