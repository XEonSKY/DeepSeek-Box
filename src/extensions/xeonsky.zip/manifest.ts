import type { ExtManifest } from '@shared/extensions'

/**
 * 内置扩展 `xeonsky.zip` 的清单 —— 7-Zip 归档能力。
 *
 * 申请的都是系统能力（`fs` / `proc`），本扩展**不 import 任何内核模块**：
 *  - `fs`   读写配置、判断二进制是否就位（走内核 treeops 的统一实现）；
 *  - `proc` 跑 7z 命令行（走内核 runChild 的登记 / 取消 / stderr 收集）。
 *
 * 7-Zip 命令行核心**随扩展内置**（`bin/<平台>/`，7-Zip 26.03），因此**不需要 `net`**：
 * 不联网、不下载，开箱即用。
 *
 * 它同时**对外提供**能力 `ext:xeonsky.zip`（在 main.ts 里注册），
 * 于是别的扩展可以不必自己找 7z，直接 `ctx.capabilities.call('ext:xeonsky.zip', 'extract', …)`。
 * 这正是「扩展间经加载器能力槽互调」的既定模型（见 loader/capability.ts）。
 *
 * 贡献一个设置面板：`view: 'zip'` 指向渲染层登记的实现（见 renderer/extensions/panels.ts）。
 * 图标 `icon: 'archive'` 是渲染层图标表里新增的键 —— 扩展只能给名字，不能传组件。
 */
export const manifest: ExtManifest = {
    id: 'xeonsky.zip',
    name: '归档（7-Zip）',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: ['fs', 'proc'],
    contributions: {
        settings: [{ key: 'zip', titleKey: 'ext.xeonskyZip.nav', view: 'zip', icon: 'archive' }]
    }
}
