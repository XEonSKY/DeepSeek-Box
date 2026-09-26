<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import { extApi, extErrorMessage, extT } from '../renderer-api'
import type { DownloadConfig, DownloadStatus, TaskView } from './types'

/**
 * 「下载」设置面板 —— 内置扩展 `xeonsky.download` 的渲染层实现。
 *
 * 与主进程入口（同目录 `main.ts`）、清单（同目录 `manifest.ts`）与语言文件
 * （同目录 `locales.ts`）放在一起，四者构成这个扩展的完整定义；
 * 挂载入口见 `renderer/src/extensions/panels.ts` 的 `LOCAL_VIEWS`。
 *
 * 对外依赖全部收在 `../renderer-api`（渲染层扩展 API 面），不 import 外壳内部模块 ——
 * 与主进程侧「扩展不直接 import 内核」是同一条原则。
 *
 * ## 界面上的两条数据流
 *
 *  - **主动查询**：进入面板时拉一次 `status()`（含配置与全部任务）；
 *  - **被动推送**：主进程在任务状态变化与下载进度上推 `progress`（主进程侧已节流
 *    到 500ms），这里订阅后整体替换任务表 —— 不自己按 1 秒轮询，避免面板开着就
 *    持续制造 IPC。
 */

/** 本扩展的通道前缀（与 manifest.id 一致）。 */
const CHANNEL = 'ext:xeonsky.download'

/** 调一次本扩展的主进程动作。 */
function call<T>(action: string, payload?: unknown): Promise<T> {
    return extApi.ext.invoke(`${CHANNEL}:${action}`, payload) as Promise<T>
}

const status = ref<DownloadStatus | null>(null)
const busy = ref(false)

// ---- 新建任务 ---------------------------------------------------------------

const newUrl = ref('')
const newDir = ref('')
const newName = ref('')

async function addTask(): Promise<void> {
    const url = newUrl.value.trim()
    if (!url) return
    busy.value = true
    try {
        await call<TaskView>('create', {
            url,
            destDir: newDir.value.trim() || undefined,
            fileName: newName.value.trim() || undefined
        })
        newUrl.value = ''
        newName.value = ''
        await reload()
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        busy.value = false
    }
}

// ---- 设置 -------------------------------------------------------------------

const cfgDir = ref('')
const cfgConcurrent = ref(2)
/** 限速输入框用 KB/s（字节数对用户没有直观意义）。 */
const cfgSpeedKb = ref(0)
const cfgThreads = ref<'auto' | number>('auto')

/** 把配置填进表单（进入面板与保存后各调一次）。 */
function fillConfig(c: DownloadConfig): void {
    cfgDir.value = c.defaultDir
    cfgConcurrent.value = c.maxConcurrent
    cfgSpeedKb.value = Math.round((c.speedLimit ?? 0) / 1024)
    cfgThreads.value = c.threads
}

const threadOptions = computed(() => [
    { value: 'auto' as const, label: extT('ext.xeonskyDownload.panel.threadsAuto') },
    ...[1, 2, 4, 6, 8, 12, 16].map((n) => ({ value: n, label: String(n) }))
])

async function applyConfig(): Promise<void> {
    busy.value = true
    try {
        await call<DownloadConfig>('setConfig', {
            defaultDir: cfgDir.value.trim(),
            maxConcurrent: cfgConcurrent.value,
            speedLimit: Math.max(0, Math.round(cfgSpeedKb.value * 1024)),
            threads: cfgThreads.value
        })
        await reload()
        ElMessage.success(extT('ext.xeonskyDownload.panel.saved'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        busy.value = false
    }
}

// ---- 任务操作 ---------------------------------------------------------------

/** 对单个任务发一个动作；失败时提示，成功时刷新一次。 */
async function act(action: string, id: string, payload?: Record<string, unknown>): Promise<void> {
    try {
        await call(action, { id, ...payload })
        await reload()
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    }
}

/** 清除全部已完成任务（任务记录本身删掉，磁盘上的文件保留）。 */
async function clearDone(): Promise<void> {
    const done = (status.value?.tasks ?? []).filter((t) => t.status === 'done')
    for (const t of done) {
        try {
            await call('remove', { id: t.id, deleteFile: false })
        } catch {
            /* 单个失败不影响其余 */
        }
    }
    await reload()
}

// ---- 展示辅助 ---------------------------------------------------------------

/** 字节数格式化（10 进制，与系统下载器显示习惯一致）。 */
function fmtBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = n
    let i = 0
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i++
    }
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function fmtSpeed(n: number): string {
    return n > 0 ? `${fmtBytes(n)}/s` : ''
}

/** 状态 → 展示文案。 */
function statusText(s: string): string {
    const map: Record<string, string> = {
        queued: 'stQueued',
        running: 'stRunning',
        paused: 'stPaused',
        done: 'stDone',
        error: 'stError',
        canceled: 'stCanceled'
    }
    return extT(`ext.xeonskyDownload.panel.${map[s] ?? 'stPaused'}`)
}

/** 状态 → 标签颜色（下载中蓝色、完成绿色、出错红色、其余中性）。 */
function statusColor(s: string): string {
    if (s === 'running' || s === 'queued') return 'blue'
    if (s === 'done') return 'green'
    if (s === 'error') return 'red'
    return 'default'
}

async function reload(): Promise<void> {
    try {
        status.value = await call<DownloadStatus>('status')
        if (status.value.config) fillConfig(status.value.config)
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    }
}

// ---- 订阅主进程推送 ---------------------------------------------------------

let unsubscribe: (() => void) | null = null

onMounted(async () => {
    await reload()
    unsubscribe = extApi.ext.on(`${CHANNEL}:progress`, (payload: unknown) => {
        const p = payload as { tasks?: TaskView[]; config?: DownloadConfig } | null
        if (!p) return
        // 整体替换而不是逐条合并：任务是按 id 索引的，增量合并要处理删除，容易漏。
        status.value = {
            available: status.value?.available ?? true,
            config: p.config ?? status.value?.config ?? { defaultDir: '', maxConcurrent: 2, speedLimit: 0, threads: 'auto' },
            effectiveThreads: status.value?.effectiveThreads ?? 0,
            activeCount: (p.tasks ?? []).filter((t) => t.status === 'running').length,
            tasks: p.tasks ?? []
        }
    })
})

onUnmounted(() => {
    unsubscribe?.()
    unsubscribe = null
})
</script>

<template>
    <div class="panel" v-loading="busy">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><DownloadOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('ext.xeonskyDownload.nav') }}</div>
                <div class="dsh-brand__desc">{{ $t('ext.xeonskyDownload.intro') }}</div>
            </div>
        </div>

        <div v-if="status && !status.available" class="dlpanel__warn">
            {{ $t('ext.xeonskyDownload.panel.unavailable') }}
        </div>

        <!-- 新建下载 -->
        <div class="dlpanel__card">
            <div class="dlpanel__cardTitle">{{ $t('ext.xeonskyDownload.panel.newTitle') }}</div>
            <div class="dlpanel__row">
                <a-input v-model:value="newUrl" :placeholder="$t('ext.xeonskyDownload.panel.urlPlaceholder')" class="dlpanel__grow" allow-clear />
                <a-input v-model:value="newDir" :placeholder="$t('ext.xeonskyDownload.panel.dirPlaceholder')" class="dlpanel__mid" allow-clear />
                <a-input v-model:value="newName" :placeholder="$t('ext.xeonskyDownload.panel.namePlaceholder')" class="dlpanel__mid" allow-clear />
                <a-button type="primary" :disabled="!newUrl.trim()" @click="addTask">
                    <template #icon><PlusOutlined /></template>
                    {{ $t('ext.xeonskyDownload.panel.add') }}
                </a-button>
            </div>
        </div>

        <!-- 任务队列 -->
        <div class="dlpanel__card">
            <div class="dlpanel__bar">
                <div class="dlpanel__cardTitle">{{ $t('ext.xeonskyDownload.panel.listTitle') }}</div>
                <a-space :size="8">
                    <a-button @click="clearDone">{{ $t('ext.xeonskyDownload.panel.clearDone') }}</a-button>
                    <a-button @click="reload">
                        <template #icon><ReloadOutlined /></template>
                        {{ $t('ext.xeonskyDownload.panel.refresh') }}
                    </a-button>
                </a-space>
            </div>

            <div v-if="!status?.tasks.length" class="dlpanel__empty">{{ $t('ext.xeonskyDownload.panel.empty') }}</div>

            <div v-else class="dlpanel__list">
                <div v-for="t in status.tasks" :key="t.id" class="dlpanel__item">
                    <div class="dlpanel__line">
                        <span class="dlpanel__name" :title="t.url">{{ t.fileName || $t('ext.xeonskyDownload.panel.noName') }}</span>
                        <a-tag :color="statusColor(t.status)">{{ statusText(t.status) }}</a-tag>
                        <span v-if="t.speed > 0" class="dlpanel__muted">{{ fmtSpeed(t.speed) }}</span>
                        <span class="dlpanel__spacer" />
                        <a-space :size="4">
                            <a-button v-if="t.status === 'paused' || t.status === 'error' || t.status === 'canceled'" size="small" @click="act('resume', t.id)">
                                {{ $t('ext.xeonskyDownload.panel.resume') }}
                            </a-button>
                            <a-button v-if="t.status === 'running' || t.status === 'queued'" size="small" @click="act('pause', t.id)">
                                {{ $t('ext.xeonskyDownload.panel.pause') }}
                            </a-button>
                            <a-button v-if="t.status === 'running' || t.status === 'queued'" size="small" @click="act('cancel', t.id)">
                                {{ $t('ext.xeonskyDownload.panel.cancel') }}
                            </a-button>
                            <a-button size="small" danger @click="act('remove', t.id, { deleteFile: false })">
                                {{ $t('ext.xeonskyDownload.panel.remove') }}
                            </a-button>
                        </a-space>
                    </div>

                    <div class="dlpanel__bar2">
                        <div class="dlpanel__track">
                            <div class="dlpanel__fill" :class="`dlpanel__fill--${t.status}`" :style="{ width: (t.percent || 0) + '%' }" />
                        </div>
                        <span class="dlpanel__size">
                            {{ fmtBytes(t.downloaded) }} / {{ t.total > 0 ? fmtBytes(t.total) : $t('ext.xeonskyDownload.panel.unknownSize') }}
                        </span>
                    </div>

                    <div v-if="t.error" class="dlpanel__err">{{ t.error }}</div>
                    <div class="dlpanel__muted dlpanel__url" :title="t.url">{{ t.url }}</div>
                </div>
            </div>
        </div>

        <!-- 设置 -->
        <div class="dlpanel__card">
            <div class="dlpanel__cardTitle">{{ $t('ext.xeonskyDownload.panel.settingsTitle') }}</div>
            <div class="dlpanel__row">
                <a-input v-model:value="cfgDir" :placeholder="$t('ext.xeonskyDownload.panel.defaultDirPlaceholder')" class="dlpanel__grow" allow-clear />
                <span class="dlpanel__label">{{ $t('ext.xeonskyDownload.panel.maxConcurrent') }}</span>
                <a-input-number v-model:value="cfgConcurrent" :min="1" :max="16" class="dlpanel__num" />
                <span class="dlpanel__label">{{ $t('ext.xeonskyDownload.panel.speedLimit') }}</span>
                <a-input-number v-model:value="cfgSpeedKb" :min="0" class="dlpanel__num" />
                <span class="dlpanel__label">{{ $t('ext.xeonskyDownload.panel.threads') }}</span>
                <a-select v-model:value="cfgThreads" :options="threadOptions" class="dlpanel__num" />
                <a-button @click="applyConfig">{{ $t('ext.xeonskyDownload.panel.apply') }}</a-button>
            </div>
            <div class="dlpanel__muted">{{ $t('ext.xeonskyDownload.panel.resumeHint') }}</div>
        </div>
    </div>
</template>

<style scoped>
/* 与扩展管理 / 归档页同一套 flex 链约定：面板纵向撑满，内部列表自己滚动。 */
.panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
}

.dlpanel__card {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    padding: 12px 14px;
    min-width: 0;
}
.dlpanel__cardTitle {
    font-weight: 600;
    font-size: 13px;
    color: var(--el-text-color-primary);
    margin-bottom: 8px;
}
.dlpanel__bar {
    display: flex;
    align-items: center;
    gap: 12px;
}
.dlpanel__bar .dlpanel__cardTitle {
    margin-bottom: 8px;
    margin-right: auto;
}
.dlpanel__row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.dlpanel__grow {
    flex: 1 1 240px;
    min-width: 180px;
}
.dlpanel__mid {
    flex: 0 1 200px;
    min-width: 140px;
}
.dlpanel__num {
    flex: 0 0 110px;
}
.dlpanel__label {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.dlpanel__muted {
    color: var(--el-text-color-secondary);
    font-size: 12px;
}

.dlpanel__list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 340px;
    overflow: auto;
}
.dlpanel__item {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 4px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.dlpanel__line {
    display: flex;
    align-items: center;
    gap: 8px;
}
.dlpanel__spacer {
    flex: 1 1 auto;
}
.dlpanel__name {
    font-weight: 600;
    font-size: 13px;
    color: var(--el-text-color-primary);
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dlpanel__bar2 {
    display: flex;
    align-items: center;
    gap: 10px;
}
.dlpanel__track {
    flex: 1 1 auto;
    height: 6px;
    background: var(--el-fill-color);
    border-radius: 3px;
    overflow: hidden;
}
.dlpanel__fill {
    height: 100%;
    background: var(--el-color-primary);
    border-radius: 3px;
    transition: width 0.2s linear;
}
.dlpanel__fill--done {
    background: var(--el-color-success);
}
.dlpanel__fill--error {
    background: var(--el-color-danger);
}
.dlpanel__fill--paused,
.dlpanel__fill--canceled {
    background: var(--el-color-info);
}
.dlpanel__size {
    flex: 0 0 auto;
    font-size: 12px;
    font-family: var(--el-font-family-mono);
    color: var(--el-text-color-secondary);
}
.dlpanel__err {
    font-size: 12px;
    color: var(--el-color-danger);
    word-break: break-all;
}
.dlpanel__url {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dlpanel__empty {
    color: var(--el-text-color-secondary);
    font-size: 12px;
    padding: 10px 0;
}
.dlpanel__warn {
    border: 1px solid var(--el-color-warning-light-5);
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning);
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 12px;
}
</style>
