import type { ExtensionLocaleTable } from '@shared/locales/ext'

/**
 * 内置扩展 `xeonsky.extm` 的**自有语言文件**。
 *
 * 键统一挂在 `ext.xeonskyExtm.*` 命名空间下，由渲染层扩展框架在启动时合并进
 * 文案目录（机制见 `shared/locales/ext.ts` 与 `renderer/src/extensions/locales.ts`）。
 *
 * 键结构：`nav` / `intro` 是设置侧栏项；`page.*` 是「扩展管理」页的全部文案
 * （与同目录 ExtensionsPanel.vue 一一对应）。
 */
export const extLocales: ExtensionLocaleTable = {
    zh: {
        ext: {
            xeonskyExtm: {
                nav: '扩展',
                intro: '扩展：系统 / 内置 / 外部三级，可查看状态、即时启停扩展、管理扩展包。',
                page: {
                    refresh: '刷新',
                    exitSafe: '退出安全模式',
                    enable: '启用',
                    disable: '停用',
                    forgive: '清除崩溃记录',
                    forgiven: '已清除崩溃记录。',
                    reload: '重载',
                    reloadAll: '全部重载',
                    reloaded: '「{name}」已重载。',
                    reloadedAll: '全部扩展已重载。',
                    toggledOn: '「{name}」已启用并重载。',
                    toggledOff: '「{name}」已停用。',
                    toggleFailed: '「{name}」启停失败。',
                    safeMode: '已进入安全模式',
                    safeModeDesc: '内置 / 外部扩展本次未加载。可排查后逐个启用，或直接删除对应目录。',
                    safeExited: '已退出安全模式，全部扩展已重新加载。',
                    empty: '还没有发现任何扩展。',
                    listTitle: '全部扩展',
                    colName: '名称',
                    colKind: '来源',
                    colStatus: '状态',
                    colEnabled: '启用',
                    stActive: '运行中',
                    stDisabled: '已停用',
                    stFailed: '加载失败',
                    stSkipped: '已跳过',
                    kindSystem: '系统',
                    kindBuiltin: '内置',
                    kindExternal: '外部',
                    pkgTitle: '扩展包',
                    pkgHint: '把 .zip 或 .xeonsky-ext 扩展包放进扩展目录，重载后自动解压并加载；包名与已有扩展冲突时不会加载。',
                    pkgDisabled: '7-Zip 扩展不可用，压缩包扩展加载已禁用。',
                    pkgUnavailable: '扩展包管理器未就绪，无法列出扩展包。',
                    pkgEmpty: '扩展目录里还没有扩展包。',
                    pkgColName: '包',
                    pkgColFormat: '格式'
                }
            }
        }
    },
    en: {
        ext: {
            xeonskyExtm: {
                nav: 'Extensions',
                intro: 'Extensions: system / built-in / external tiers — inspect status, toggle them instantly, and manage extension packages.',
                page: {
                    refresh: 'Refresh',
                    exitSafe: 'Leave safe mode',
                    enable: 'Enable',
                    disable: 'Disable',
                    forgive: 'Clear crash record',
                    forgiven: 'Crash record cleared.',
                    reload: 'Reload',
                    reloadAll: 'Reload all',
                    reloaded: '"{name}" reloaded.',
                    reloadedAll: 'All extensions reloaded.',
                    toggledOn: '"{name}" enabled and reloaded.',
                    toggledOff: '"{name}" disabled.',
                    toggleFailed: 'Failed to toggle "{name}".',
                    safeMode: 'Safe mode is on',
                    safeModeDesc: 'Built-in / external extensions were not loaded this time. Review and enable them one by one, or delete the offending folder.',
                    safeExited: 'Safe mode cleared; all extensions reloaded.',
                    empty: 'No extensions discovered yet.',
                    listTitle: 'All extensions',
                    colName: 'Name',
                    colKind: 'Source',
                    colStatus: 'Status',
                    colEnabled: 'Enabled',
                    stActive: 'Running',
                    stDisabled: 'Disabled',
                    stFailed: 'Failed',
                    stSkipped: 'Skipped',
                    kindSystem: 'System',
                    kindBuiltin: 'Built-in',
                    kindExternal: 'External',
                    pkgTitle: 'Extension packages',
                    pkgHint: 'Drop a .zip or .xeonsky-ext package into the extensions directory; it is extracted and loaded on reload. Packages whose name conflicts with an existing extension are skipped.',
                    pkgDisabled: 'The 7-Zip extension is unavailable; package-based extensions are disabled.',
                    pkgUnavailable: 'The package manager extension is not ready; packages cannot be listed.',
                    pkgEmpty: 'No extension packages in the extensions directory yet.',
                    pkgColName: 'Package',
                    pkgColFormat: 'Format'
                }
            }
        }
    }
}
