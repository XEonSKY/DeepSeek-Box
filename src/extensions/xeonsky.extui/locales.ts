import type { ExtensionLocaleTable } from '@shared/locales/ext'

/**
 * 内置扩展 `xeonsky.extui` 的**自有语言文件**。
 *
 * 键统一挂在 `ext.xeonskyExtui.*` 命名空间下，由渲染层扩展框架在启动时合并进
 * 文案目录（机制见 `shared/locales/ext.ts` 与 `renderer/src/extensions/locales.ts`）。
 * 这里原先放在外壳 `sv.nav.extensions` / `sv.intro.extensions` / `sv.extpage.*` 下，
 * 现迁回扩展自己的目录 —— 扩展的文案归扩展管，外壳不再替它记账。
 *
 * 键结构：`nav` / `intro` 是设置侧栏项；`page.*` 是「扩展管理」页的全部文案
 * （与同目录 ExtensionsPanel.vue 一一对应）。
 */
export const extLocales: ExtensionLocaleTable = {
    zh: {
        ext: {
            xeonskyExtui: {
                nav: '扩展',
                intro: '扩展：系统 / 内置 / 外部三级，可查看状态、启停外部扩展、退出安全模式。',
                page: {
                    refresh: '刷新',
                    exitSafe: '退出安全模式',
                    enable: '启用',
                    disable: '停用',
                    forgive: '清除崩溃记录',
                    forgiven: '已清除崩溃记录，重启后可重试。',
                    restartHint: '已保存，重启后生效。',
                    safeMode: '已进入安全模式',
                    safeModeDesc: '内置 / 外部扩展本次未加载。可排查后逐个启用，或直接删除对应目录。',
                    safeExited: '已退出安全模式，重启后重新加载全部扩展。',
                    empty: '还没有发现任何扩展。',
                    listTitle: '全部扩展',
                    colName: '名称',
                    colKind: '来源',
                    colStatus: '状态',
                    stActive: '运行中',
                    stDisabled: '已停用',
                    stFailed: '加载失败',
                    stSkipped: '已跳过',
                    kindSystem: '系统',
                    kindBuiltin: '内置',
                    kindExternal: '外部',
                    pkgTitle: '扩展包',
                    pkgHint: '把 .zip 或 .xeonsky-ext 扩展包放进扩展目录，重启后自动解压并加载；包名与已有扩展冲突时不会加载。',
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
            xeonskyExtui: {
                nav: 'Extensions',
                intro: 'Extensions: system / built-in / external tiers — inspect status, enable or disable external ones, leave safe mode.',
                page: {
                    refresh: 'Refresh',
                    exitSafe: 'Leave safe mode',
                    enable: 'Enable',
                    disable: 'Disable',
                    forgive: 'Clear crash record',
                    forgiven: 'Crash record cleared; restart to retry.',
                    restartHint: 'Saved. Takes effect after restart.',
                    safeMode: 'Safe mode is on',
                    safeModeDesc: 'Built-in / external extensions were not loaded this time. Review and enable them one by one, or delete the offending folder.',
                    safeExited: 'Safe mode cleared; all extensions will load after restart.',
                    empty: 'No extensions discovered yet.',
                    listTitle: 'All extensions',
                    colName: 'Name',
                    colKind: 'Source',
                    colStatus: 'Status',
                    stActive: 'Running',
                    stDisabled: 'Disabled',
                    stFailed: 'Failed',
                    stSkipped: 'Skipped',
                    kindSystem: 'System',
                    kindBuiltin: 'Built-in',
                    kindExternal: 'External',
                    pkgTitle: 'Extension packages',
                    pkgHint: 'Drop a .zip or .xeonsky-ext package into the extensions directory; it is extracted and loaded on restart. Packages whose name conflicts with an existing extension are skipped.',
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
