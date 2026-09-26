import type { ExtensionLocaleTable } from '@shared/locales/ext'

/**
 * 内置扩展 `xeonsky.zip` 的**自有语言文件**。
 *
 * 扩展的界面文案不进外壳的 `shared/locales/zh|en` 目录 —— 那是外壳的领地；
 * 扩展在自己的目录里带一份字典，键统一挂在 `ext.<id 驼峰>.*` 命名空间下
 * （本扩展即 `ext.xeonskyZip.*`），由渲染层扩展框架在启动时合并进文案目录
 * （见 `renderer/src/extensions/locales.ts` 与 `shared/locales/ext.ts` 的说明）。
 *
 * 这样做的原因：
 *  - 外壳不需要知道每个扩展有哪些文案 —— 装一个扩展就多一块，删了就少一块；
 *  - 扩展改名 / 加键不用动外壳文件，改自己的目录即可（一个目录自成一体）；
 *  - 命名空间隔离保证扩展之间、扩展与外壳之间不会撞键。
 *
 * 键结构与同目录 ZipPanel.vue / manifest.ts 一一对应：`nav` / `intro` 是侧栏项，
 * `panel.*` 是面板内部文案。
 */
export const extLocales: ExtensionLocaleTable = {
    zh: {
        ext: {
            xeonskyZip: {
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
    },
    en: {
        ext: {
            xeonskyZip: {
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
