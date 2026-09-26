import type { ExtensionLocaleTable } from '@shared/locales/ext'

/**
 * 内置扩展 `xeonsky.download` 的**自有语言文件**。
 *
 * 与 `xeonsky.extm/locales.ts` 同一套约定：扩展的界面文案不进外壳的 `shared/locales`，
 * 而是在自己的目录里带一份字典，键挂在 `ext.<id 驼峰>.*` 命名空间下
 * （本扩展即 `ext.xeonskyDownload.*`），由渲染层扩展框架在启动时合并进文案目录
 * （见 `renderer/src/extensions/locales.ts`）。
 *
 * 键结构与同目录 DownloadPanel.vue / manifest.ts 一一对应：`nav` / `intro` 是侧栏项，
 * `panel.*` 是面板内部文案，`panel.st*` 是任务状态的展示名。
 */
export const extLocales: ExtensionLocaleTable = {
    zh: {
        ext: {
            xeonskyDownload: {
                nav: '下载',
                intro: '多线程下载：断点续传、限速、任务队列持久化，代理跟随「设置 → 网络」的档位。',
                panel: {
                    newTitle: '新建下载',
                    urlPlaceholder: '下载链接（http / https）',
                    dirPlaceholder: '保存目录（留空 = 默认目录）',
                    namePlaceholder: '文件名（留空 = 按链接推断）',
                    add: '添加',
                    listTitle: '任务队列',
                    refresh: '刷新',
                    clearDone: '清除已完成',
                    empty: '还没有下载任务。',
                    noName: '（未命名）',
                    unknownSize: '未知大小',
                    stQueued: '排队中',
                    stRunning: '下载中',
                    stPaused: '已暂停',
                    stDone: '已完成',
                    stError: '出错',
                    stCanceled: '已取消',
                    start: '开始',
                    pause: '暂停',
                    resume: '继续',
                    retry: '重试',
                    cancel: '取消',
                    remove: '删除',
                    resumeHint: '从上次中断处继续（服务端未变时）',
                    settingsTitle: '下载设置',
                    defaultDir: '默认下载目录',
                    defaultDirPlaceholder: '留空 = 系统「下载」目录',
                    maxConcurrent: '同时进行',
                    speedLimit: '全局限速（KB/s，0 = 不限）',
                    threads: '默认连接数',
                    threadsAuto: '自动',
                    apply: '应用',
                    saved: '设置已保存。',
                    unavailable: '下载扩展未启用，当前由内核内置下载器兜底。'
                }
            }
        }
    },
    en: {
        ext: {
            xeonskyDownload: {
                nav: 'Downloads',
                intro: 'Multi-threaded downloads: resumable transfers, speed limits and a persistent task queue, honoring the proxy scopes from Settings → Network.',
                panel: {
                    newTitle: 'New download',
                    urlPlaceholder: 'Download URL (http / https)',
                    dirPlaceholder: 'Save directory (empty = default directory)',
                    namePlaceholder: 'File name (empty = infer from URL)',
                    add: 'Add',
                    listTitle: 'Task queue',
                    refresh: 'Refresh',
                    clearDone: 'Clear finished',
                    empty: 'No download tasks yet.',
                    noName: '(unnamed)',
                    unknownSize: 'unknown size',
                    stQueued: 'Queued',
                    stRunning: 'Running',
                    stPaused: 'Paused',
                    stDone: 'Done',
                    stError: 'Error',
                    stCanceled: 'Canceled',
                    start: 'Start',
                    pause: 'Pause',
                    resume: 'Resume',
                    retry: 'Retry',
                    cancel: 'Cancel',
                    remove: 'Remove',
                    resumeHint: 'Continue from where it stopped (if the remote file is unchanged)',
                    settingsTitle: 'Download settings',
                    defaultDir: 'Default download directory',
                    defaultDirPlaceholder: 'Empty = system Downloads directory',
                    maxConcurrent: 'Concurrent tasks',
                    speedLimit: 'Global speed limit (KB/s, 0 = unlimited)',
                    threads: 'Default connections',
                    threadsAuto: 'Auto',
                    apply: 'Apply',
                    saved: 'Settings saved.',
                    unavailable: 'The download extension is disabled; the kernel fallback downloader is in use.'
                }
            }
        }
    }
}
