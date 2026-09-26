import type { ExtensionLocaleTable } from '@shared/locales/ext'

/**
 * 内置扩展 `xeonsky.extm` 的**自有语言文件**。
 *
 * 键统一挂在 `ext.xeonskyExtm.*` 命名空间下，由渲染层扩展框架在启动时合并进
 * 文案目录（机制见 `shared/locales/ext.ts` 与 `renderer/src/extensions/locales.ts`）。
 *
 * 键结构：`nav` / `intro` 是设置侧栏项；`page.*` 是「扩展管理」页的全部文案
 * （与同目录 ExtensionsPanel.vue 一一对应）；`zip.*` 是归档（7-Zip）面板的文案
 * （与同目录 `sevenzip/ZipPanel.vue` 一一对应）—— 7-Zip 是本扩展的内部模块，
 * 它的文案也归本扩展管，合并命名空间也避免再挂一个 `ext.<其它名>` 顶层键。
 */
export const extLocales: ExtensionLocaleTable = {
    zh: {
        ext: {
            xeonskyExtm: {
                nav: '扩展',
                intro: '扩展：系统 / 内置 / 外部三级，可查看状态、即时启停扩展、管理扩展包与归档。',
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
                    pkgDisabled: '7-Zip 核心不可用，压缩包扩展加载已禁用。',
                    pkgUnavailable: '扩展包管理器未就绪，无法列出扩展包。',
                    pkgEmpty: '扩展目录里还没有扩展包。',
                    pkgColName: '包',
                    pkgColFormat: '格式'
                },
                zip: {
                    nav: '归档（7-Zip）',
                    intro: '基于 7-Zip 核心的解压 / 压缩：分卷、密码、算法等高级功能，支持 7-Zip 全部格式。',
                    panel: {
                        coreTitle: '7-Zip 核心（内置）',
                        refresh: '刷新',
                        binPath: '可执行文件',
                        notConfigured: '未找到（内置核心缺失时可手动指定路径）',
                        source: '状态与来源',
                        stAvailable: '可用',
                        stUnusable: '存在但不可用',
                        stMissing: '未找到',
                        srcCustom: '手动指定的路径',
                        srcBundled: '扩展内置的二进制',
                        srcSystem: '系统已安装的 7-Zip',
                        srcMissing: '尚未就位',
                        target: '当前平台',
                        targetUnsupported: '当前平台不在支持列表（仍可手动指定任意 7z 路径）',
                        binDir: '内置二进制目录',
                        bundledVersion: '内置版本',
                        pathPlaceholder: '7z / 7za / 7zz 可执行文件的完整路径（留空 = 用内置核心）',
                        apply: '应用',
                        pathSaved: '已保存二进制路径。',
                        formatsTitle: '支持的格式',
                        canCreate: '压缩',
                        canExtract: '解压',
                        canUpdate: '更新',
                        methodsTitle: '压缩算法',
                        featuresTitle: '高级功能',
                        trialTitle: '现场试用',
                        archivePlaceholder: '归档路径（分卷给第一卷即可）',
                        destPlaceholder: '解压输出目录',
                        passwordPlaceholder: '密码（可留空）',
                        tryExtract: '解压',
                        extractOk: '解压完成。',
                        extractFail: '解压失败，详见输出。',
                        inputsPlaceholder: '要压缩的文件 / 目录，每行一个',
                        outArchivePlaceholder: '目标归档路径（扩展名决定格式，或右侧选择）',
                        tryCompress: '压缩',
                        compressOk: '压缩完成。',
                        compressFail: '压缩失败，详见输出。'
                    }
                }
            }
        }
    },
    en: {
        ext: {
            xeonskyExtm: {
                nav: 'Extensions',
                intro: 'Extensions: system / built-in / external tiers — inspect status, toggle them instantly, manage packages and archives.',
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
                    pkgDisabled: 'The 7-Zip core is unavailable; package-based extensions are disabled.',
                    pkgUnavailable: 'The package manager is not ready; packages cannot be listed.',
                    pkgEmpty: 'No extension packages in the extensions directory yet.',
                    pkgColName: 'Package',
                    pkgColFormat: 'Format'
                },
                zip: {
                    nav: 'Archive (7-Zip)',
                    intro: 'Extract / compress via the 7-Zip core: volumes, passwords, methods and every format 7-Zip supports.',
                    panel: {
                        coreTitle: '7-Zip core (bundled)',
                        refresh: 'Refresh',
                        binPath: 'Executable',
                        notConfigured: 'Not found (set a path manually if the bundled core is missing)',
                        source: 'Status & source',
                        stAvailable: 'Available',
                        stUnusable: 'Present but unusable',
                        stMissing: 'Missing',
                        srcCustom: 'Manually specified path',
                        srcBundled: 'Binary bundled with the extension',
                        srcSystem: 'System-installed 7-Zip',
                        srcMissing: 'Not in place yet',
                        target: 'Current platform',
                        targetUnsupported: 'This platform is not in the list (you can still point to any 7z binary)',
                        binDir: 'Bundled binary directory',
                        bundledVersion: 'Bundled version',
                        pathPlaceholder: 'Full path to the 7z / 7za / 7zz executable (empty = use bundled core)',
                        apply: 'Apply',
                        pathSaved: 'Binary path saved.',
                        formatsTitle: 'Supported formats',
                        canCreate: 'Create',
                        canExtract: 'Extract',
                        canUpdate: 'Update',
                        methodsTitle: 'Compression methods',
                        featuresTitle: 'Advanced features',
                        trialTitle: 'Try it now',
                        archivePlaceholder: 'Archive path (first volume for multi-volume)',
                        destPlaceholder: 'Extract destination directory',
                        passwordPlaceholder: 'Password (optional)',
                        tryExtract: 'Extract',
                        extractOk: 'Extraction finished.',
                        extractFail: 'Extraction failed; see output.',
                        inputsPlaceholder: 'Files / directories to compress, one per line',
                        outArchivePlaceholder: 'Target archive path (extension picks the format, or choose on the right)',
                        tryCompress: 'Compress',
                        compressOk: 'Compression finished.',
                        compressFail: 'Compression failed; see output.'
                    }
                }
            }
        }
    }
}
