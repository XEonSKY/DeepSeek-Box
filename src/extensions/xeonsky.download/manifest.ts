import type { ExtManifest } from '@shared/extensions'

/**
 * 内置扩展 `xeonsky.download` 的清单 —— 下载（引擎已从内核迁到本扩展）。
 *
 * 申请的系统能力：
 *  - `fs`  读写自己的配置与任务表、清理临时文件；
 *  - `net` **发请求**（`net.stream`）—— 代理 / Cookie / UA 仍由内核 session 决定，
 *    扩展只决定 URL、请求头与代理档位，拿不到 session 本体。
 *
 * 它同时**对外提供**能力 `ext:xeonsky.download`（在 main.ts 里注册）：
 * 别的扩展不必自己写下载，直接 `ctx.capabilities.call('ext:xeonsky.download', 'download', …)`；
 * 内核的 dsh 安装流程（Node / npm / pnpm）也走这一条路径 —— 于是「下载」只有一份实现。
 *
 * 贡献一个设置面板：`view: 'download'` 指向渲染层登记的实现
 * （见 renderer/extensions/panels.ts）。图标 `icon: 'download'` 是渲染层图标表里的键。
 */
export const manifest: ExtManifest = {
    id: 'xeonsky.download',
    name: '下载',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: ['fs', 'net'],
    contributions: {
        settings: [{ key: 'download', titleKey: 'ext.xeonskyDownload.nav', view: 'download', icon: 'download' }]
    }
}
