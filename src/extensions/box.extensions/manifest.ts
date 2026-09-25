import type { ExtManifest } from '@shared/extensions'

/**
 * 内置扩展 `box.extensions` 的清单（登记表与实现同目录）。
 *
 * 之所以单独成文件而不是内联在 builtin/index.ts 的登记表里：
 * 一个扩展的「自我描述」应当和它的实现放在一起 —— 否则改这个扩展要同时开
 * `builtin/index.ts` 与 `box.extensions/main.ts` 两个文件，容易漏改。
 * 登记表只负责「有哪些扩展」，不负责「某个扩展长什么样」。
 *
 * 它自己不提供任何能力（`capabilities` 为空），只贡献一个设置面板：
 * `view: 'extensions'` 指向渲染层登记的实现（见 renderer/extensions/panels.ts）。
 * `icon: 'app'` 是渲染层图标表的键（扩展不能传组件，只能给名字）。
 */
export const manifest: ExtManifest = {
    id: 'box.extensions',
    name: '扩展管理',
    version: '1.0.0',
    apiVersion: 1,
    contributions: {
        settings: [{ key: 'extensions', titleKey: 'ext.boxExtensions.nav', view: 'extensions', icon: 'app' }]
    }
}
