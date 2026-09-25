import type { ExtManifest } from '@shared/extensions'

/**
 * 内置扩展 `xeonsky.extui` 的清单（登记表与实现同目录）。
 *
 * 之所以单独成文件而不是内联在 builtin/index.ts 的登记表里：
 * 一个扩展的「自我描述」应当和它的实现放在一起 —— 否则改这个扩展要同时开
 * `builtin/index.ts` 与 `xeonsky.extui/main.ts` 两个文件，容易漏改。
 * 登记表只负责「有哪些扩展」，不负责「某个扩展长什么样」。
 *
 * 贡献一个设置面板：`view: 'extensions'` 指向渲染层登记的实现
 * （见 renderer/extensions/panels.ts）。`icon: 'app'` 是渲染层图标表的键
 * （扩展不能传组件，只能给名字）。
 *
 * 它同时是包管理能力（`ext:xeonsky.extm`）的**消费方**：扩展管理页里的
 * 「扩展包」区块经主进程侧 capabilities 调 extm 列出 / 解压压缩包扩展。
 * 该依赖是**软依赖**（不写 dependencies）：extm 缺失时页面只少一个区块，
 * 其余功能照常。
 */
export const manifest: ExtManifest = {
    id: 'xeonsky.extui',
    name: '扩展管理',
    version: '1.0.0',
    apiVersion: 1,
    capabilities: ['ext:xeonsky.extm'],
    contributions: {
        settings: [{ key: 'extensions', titleKey: 'ext.xeonskyExtui.nav', view: 'extensions', icon: 'app' }]
    }
}
