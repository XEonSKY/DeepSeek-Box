import type { ExtensionLocaleTable } from '@shared/locales/ext'

/**
 * 内置扩展 `xeonsky.browser` 的**自有语言文件**。
 *
 * 与 `xeonsky.extm/locales.ts` 同一套约定：扩展的界面文案不进外壳的 `shared/locales`，
 * 而是在自己的目录里带一份字典，键挂在 `ext.<id 驼峰>.*` 命名空间下
 * （本扩展即 `ext.xeonskyBrowser.*`），由渲染层扩展框架在启动时合并进文案目录
 * （见 `renderer/src/extensions/locales.ts`）。
 *
 * 键结构与同目录 BrowserPanel.vue / NewTab.vue / manifest.ts 一一对应：
 * `nav` / `intro` 是侧栏项，`panel.*` 是设置面板内部文案，
 * `engineTitle` / `newTab.*` / `engine.*` 是新标签页导航视图的文案。
 *
 * 注：原先内核 `shared/locales` 里的 `m.webviewPerm.*`（权限询问弹窗）已随功能迁出，
 * 那两个键**不再使用** —— 权限弹窗现由主进程内联构造文案（见 main.ts 的 `permissionLabel`），
 * 因为它是系统级对话框、不经过渲染层 i18n 运行时。
 */
export const extLocales: ExtensionLocaleTable = {
    zh: {
        ext: {
            xeonskyBrowser: {
                nav: '内嵌浏览器',
                intro: '内嵌页面的浏览器标识、权限策略与新标签页导航：UserAgent 可自定义，站点权限按来源分级处理。',
                engineTitle: '新建标签页',
                engine: {
                    baidu: '百度',
                    sogou: '搜狗',
                    q360: '360',
                    bing: 'Bing',
                    google: 'Google',
                    duckduckgo: 'DuckDuckGo'
                },
                newTab: {
                    placeholder: '输入网址，或按默认搜索引擎搜索',
                    go: '跳转',
                    quick: '常用站点',
                    noShortcuts: '还没有常用站点，可在扩展设置里添加。',
                    addInSettings: '去设置添加'
                },
                panel: {
                    uaTitle: '浏览器标识（UserAgent）',
                    ua: '自定义 UserAgent',
                    uaPlaceholder: '留空 = 使用默认 UserAgent',
                    uaHint: '部分站点按 UserAgent 分流（给不支持的浏览器降级甚至拒绝服务），可在这里伪装成别的浏览器版本。保存后立即对新请求生效；已加载的页面需刷新才带新 UA。',
                    uaDefault: '默认 UserAgent',
                    uaCurrent: '当前生效的 UserAgent',
                    uaReset: '恢复默认',
                    engineTitle: '默认搜索引擎',
                    engineHint: '在地址栏或新标签页输入非网址内容时，用它拼出搜索链接。',
                    shortcutsTitle: '常用站点',
                    shortcutTitle: '标题',
                    shortcutUrl: '网址',
                    shortcutAdd: '添加站点',
                    shortcutHint: '显示在新标签页的「常用站点」里；点击即在程序内标签页打开。',
                    save: '保存',
                    saved: '设置已保存。',
                    appVersion: '应用版本'
                }
            }
        }
    },
    en: {
        ext: {
            xeonskyBrowser: {
                nav: 'Embedded browser',
                intro: 'Browser identity, permission policy and new-tab navigation for embedded pages: a custom UserAgent with origin-scoped site permissions.',
                engineTitle: 'New tab',
                engine: {
                    baidu: 'Baidu',
                    sogou: 'Sogou',
                    '360': '360',
                    bing: 'Bing',
                    google: 'Google',
                    duckduckgo: 'DuckDuckGo'
                },
                newTab: {
                    placeholder: 'Enter a URL, or search with the default engine',
                    go: 'Go',
                    quick: 'Shortcuts',
                    noShortcuts: 'No shortcuts yet — add some in the extension settings.',
                    addInSettings: 'Add in settings'
                },
                panel: {
                    uaTitle: 'Browser identity (UserAgent)',
                    ua: 'Custom UserAgent',
                    uaPlaceholder: 'Empty = use the default UserAgent',
                    uaHint: 'Some sites branch on the UserAgent (degrading or refusing unsupported browsers); spoof another browser version here. Takes effect for new requests right away; already-loaded pages need a refresh to pick it up.',
                    uaDefault: 'Default UserAgent',
                    uaCurrent: 'Effective UserAgent',
                    uaReset: 'Restore default',
                    engineTitle: 'Default search engine',
                    engineHint: 'Used to turn non-URL input in the address bar or new tab into a search.',
                    shortcutsTitle: 'Shortcuts',
                    shortcutTitle: 'Title',
                    shortcutUrl: 'URL',
                    shortcutAdd: 'Add shortcut',
                    shortcutHint: 'Shown under "Shortcuts" on the new tab; clicking opens it in an in-app tab.',
                    save: 'Save',
                    saved: 'Settings saved.',
                    appVersion: 'App version'
                }
            }
        }
    }
}
