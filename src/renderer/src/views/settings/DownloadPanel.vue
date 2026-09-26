<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DownloadOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { DownloadConfig, DownloadTaskStatus, DownloadTaskView, DownloadThreadsOption } from '@shared/download'

/**
 * 「下载」设置面板 —— 内核下载模块（`main/download/`）的界面。
 *
 * 它原先是内置扩展 `xeonsky.download` 的 `DownloadPanel.vue`，走扩展自己的 DIY 通道
 * （`ext:xeonsky.download:*`）。下载下沉内核后，界面也回到外壳自带的设置面板里，
 * 通信改成内核内置端点（`GET /download`、`POST /download/tasks` …）——
 * 于是它有 `sv.*` 命名空间的外壳文案，而不再是扩展的 `ext.xeonskyDownload.*`。
 *
 * 程序级下载并发已固定为自动（内核按 CPU 核心数自适应，见 `main/download` 的 resolveThreads），
 * 设置结构里没有对应字段。这里管的是下载**任务**与下载模块自身的配置（目录、并发、限速）。
 */

/** 任务状态 → 外壳文案键。 */
const STATUS_LABELS: Record<DownloadTaskStatus, string> = {
    queued: 'stQueued',
    running: 'stRunning',
    paused: 'stPaused',
    done: 'stDone',
    error: 'stError',
    canceled: 'stCanceled'
}

const tasks = ref<DownloadTaskView[]>([])
const config = ref<DownloadConfig | null>(null)
const effectiveThreads = ref(0)
const activeCount = ref(0)

// 新建表单
const newUrl = ref('')
const newDir = ref('')
const newName = ref('')

// 配置表单的本地副本（用户改完点「应用」）
const cfgDir = ref('')
const cfgConcurrent = ref(2)
const cfgSpeedLimitKb = ref(0)
const cfgThreads = ref<DownloadThreadsOption>('auto')

let unsubscribe: (() => void) | undefined

const busy = ref(false)

/** 格式化字节（B / KB / MB / GB，保留一位小数）。 */
function fmtBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let v = n
    let i = 0
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i += 1
    }
    return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`
}

/** 速度展示（/s）。 */
function fmtSpeed(n: number): string {
    return n > 0 ? `${fmtBytes(n)}/s` : ''
}

function statusLabel(s: DownloadTaskStatus): string {
    return `sv.download.panel.${STATUS_LABELS[s] ?? 'stPaused'}`
}

/** 应用一份状态快照（初次拉取与事件推送共用）。 */
function applyStatus(s: { tasks: DownloadTaskView[]; config: DownloadConfig; effectiveThreads: number; activeCount: number }): void {
    tasks.value = s.tasks
    config.value = s.config
    effectiveThreads.value = s.effectiveThreads
    activeCount.value = s.activeCount
    cfgDir.value = s.config.defaultDir
    cfgConcurrent.value = s.config.maxConcurrent
    cfgSpeedLimitKb.value = Math.round(s.config.speedLimit / 1024)
    cfgThreads.value = s.config.threads
}

async function reload(): Promise<void> {
    busy.value = true
    try {
        applyStatus(await window.api.get('/download'))
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
    } finally {
        busy.value = false
    }
}

async function addTask(): Promise<void> {
    const url = newUrl.value.trim()
    if (!url) return
    try {
        await window.api.post('/download/tasks', {
            body: {
                url,
                destDir: newDir.value.trim() || undefined,
                fileName: newName.value.trim() || undefined
            }
        })
        newUrl.value = ''
        newName.value = ''
        ElMessage.success(t('sv.download.panel.added'))
        await reload()
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
    }
}

async function act(id: string, action: 'start' | 'pause' | 'resume' | 'cancel'): Promise<void> {
    try {
        const path = {
            start: '/download/tasks/:id/start',
            pause: '/download/tasks/:id/pause',
            resume: '/download/tasks/:id/resume',
            cancel: '/download/tasks/:id/cancel'
        }[action] as
            | '/download/tasks/:id/start'
            | '/download/tasks/:id/pause'
            | '/download/tasks/:id/resume'
            | '/download/tasks/:id/cancel'
        await window.api.post(path, { params: { id } })
        await reload()
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
    }
}

async function removeTask(id: string, deleteFile: boolean): Promise<void> {
    try {
        await window.api.delete('/download/tasks/:id', { params: { id }, query: { deleteFile } })
        await reload()
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
    }
}

async function clearDone(): Promise<void> {
    for (const t of tasks.value.filter((x) => x.status === 'done' || x.status === 'canceled')) {
        await window.api.delete('/download/tasks/:id', { params: { id: t.id }, query: { deleteFile: false } })
    }
    await reload()
}

async function applyConfig(): Promise<void> {
    try {
        await window.api.put('/download/config', {
            body: {
                defaultDir: cfgDir.value,
                maxConcurrent: cfgConcurrent.value,
                speedLimit: Math.max(0, Math.round(cfgSpeedLimitKb.value)) * 1024,
                threads: cfgThreads.value
            }
        })
        ElMessage.success(t('sv.download.panel.saved'))
        await reload()
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
    }
}

/** 挑一个默认下载目录（原生目录选择器）。 */
async function pickDir(): Promise<void> {
    const dir = await window.api.post('/dialog/directory')
    if (dir) cfgDir.value = dir
}

const { t } = useI18n()

onMounted(async () => {    await reload()
    unsubscribe = window.api.on('download:progress', (payload) => {
        applyStatus(payload as unknown as { tasks: DownloadTaskView[]; config: DownloadConfig; effectiveThreads: number; activeCount: number })
    })
})

onUnmounted(() => {
    unsubscribe?.()
})
</script>

<template>
    <div class="dl">
        <a-collapse :default-active-key="['dl-new', 'dl-list', 'dl-config']">
            <!-- 新建下载 -->
            <a-collapse-panel key="dl-new">
                <template #header><DownloadOutlined /> {{ $t('sv.download.panel.newTitle') }}</template>
                <a-form layout="vertical">
                    <a-form-item :label="$t('sv.download.panel.url')">
                        <a-input
                            v-model:value="newUrl"
                            :placeholder="$t('sv.download.panel.urlPlaceholder')"
                            @press-enter="addTask"
                        />
                    </a-form-item>
                    <a-form-item :label="$t('sv.download.panel.dir')">
                        <a-input v-model:value="newDir" :placeholder="$t('sv.download.panel.dirPlaceholder')" />
                    </a-form-item>
                    <a-form-item :label="$t('sv.download.panel.name')">
                        <a-input v-model:value="newName" :placeholder="$t('sv.download.panel.namePlaceholder')" />
                    </a-form-item>
                    <a-button type="primary" :disabled="!newUrl.trim()" @click="addTask">
                        {{ $t('sv.download.panel.add') }}
                    </a-button>
                </a-form>
            </a-collapse-panel>

            <!-- 任务队列 -->
            <a-collapse-panel key="dl-list">
                <template #header>{{ $t('sv.download.panel.listTitle') }}</template>
                <div class="dl__bar">
                    <a-button size="small" :loading="busy" @click="reload">
                        <template #icon><ReloadOutlined /></template>
                        {{ $t('sv.download.panel.refresh') }}
                    </a-button>
                    <a-button size="small" :disabled="tasks.length === 0" @click="clearDone">
                        {{ $t('sv.download.panel.clearDone') }}
                    </a-button>
                    <span v-if="activeCount > 0" class="dl__active">
                        {{ $t('sv.download.panel.active', { n: activeCount }) }}
                    </span>
                </div>
                <a-empty v-if="tasks.length === 0" :description="$t('sv.download.panel.empty')" />
                <a-list v-else :data-source="tasks" size="small">
                    <template #renderItem="{ item }">
                        <a-list-item>
                            <div class="dl__row">
                                <div class="dl__meta">
                                    <div class="dl__name" :title="item.url">
                                        {{ item.fileName || $t('sv.download.panel.noName') }}
                                    </div>
                                    <div class="dl__sub">
                                        {{ item.destDir }}
                                    </div>
                                    <a-progress
                                        :percent="Math.round(item.percent)"
                                        :status="item.status === 'error' ? 'exception' : item.status === 'done' ? 'success' : 'normal'"
                                        size="small"
                                    />
                                    <div class="dl__stat">
                                        <span class="dl__tag">{{ $t(statusLabel(item.status)) }}</span>
                                        <span>{{ fmtBytes(item.downloaded) }} / {{ item.total > 0 ? fmtBytes(item.total) : $t('sv.download.panel.unknownSize') }}</span>
                                        <span v-if="fmtSpeed(item.speed)">{{ fmtSpeed(item.speed) }}</span>
                                    </div>
                                    <div v-if="item.error" class="dl__err">{{ item.error }}</div>
                                </div>
                                <div class="dl__ops">
                                    <a-button v-if="item.status === 'queued' || item.status === 'running'" size="small" @click="act(item.id, 'pause')">
                                        {{ $t('sv.download.panel.pause') }}
                                    </a-button>
                                    <a-button v-else size="small" @click="act(item.id, 'resume')">
                                        {{ $t('sv.download.panel.resume') }}
                                    </a-button>
                                    <a-button v-if="item.status === 'queued' || item.status === 'running'" size="small" danger @click="act(item.id, 'cancel')">
                                        {{ $t('sv.download.panel.cancel') }}
                                    </a-button>
                                    <a-button size="small" danger @click="removeTask(item.id, false)">
                                        {{ $t('sv.download.panel.remove') }}
                                    </a-button>
                                </div>
                            </div>
                        </a-list-item>
                    </template>
                </a-list>
            </a-collapse-panel>

            <!-- 下载设置 -->
            <a-collapse-panel key="dl-config">
                <template #header>{{ $t('sv.download.panel.settingsTitle') }}</template>
                <a-form layout="vertical">
                    <a-form-item :label="$t('sv.download.panel.defaultDir')">
                        <a-input-group compact>
                            <a-input v-model:value="cfgDir" :placeholder="$t('sv.download.panel.defaultDirPlaceholder')" style="width: calc(100% - 90px)" />
                            <a-button @click="pickDir">{{ $t('sv.download.panel.browse') }}</a-button>
                        </a-input-group>
                    </a-form-item>
                    <a-form-item :label="$t('sv.download.panel.maxConcurrent')">
                        <a-input-number v-model:value="cfgConcurrent" :min="1" :max="16" :step="1" />
                    </a-form-item>
                    <a-form-item :label="$t('sv.download.panel.speedLimit')">
                        <a-input-number v-model:value="cfgSpeedLimitKb" :min="0" :step="128" />
                    </a-form-item>
                    <a-form-item :label="$t('sv.download.panel.threads')">
                        <a-select v-model:value="cfgThreads" style="width: 200px">
                            <a-select-option value="auto">
                                {{ $t('sv.download.panel.threadsAuto', { n: effectiveThreads }) }}
                            </a-select-option>
                            <a-select-option v-for="n in 16" :key="n" :value="n">{{ n }}</a-select-option>
                        </a-select>
                    </a-form-item>
                    <a-button type="primary" @click="applyConfig">
                        {{ $t('sv.download.panel.apply') }}
                    </a-button>
                </a-form>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>

<style scoped>
.dl {
    padding: 4px 2px;
}

.dl__bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}

.dl__active {
    margin-left: auto;
    font-size: 12px;
    opacity: 0.7;
}

.dl__row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
}

.dl__meta {
    flex: 1;
    min-width: 0;
}

.dl__name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.dl__sub {
    font-size: 12px;
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.dl__stat {
    display: flex;
    gap: 10px;
    font-size: 12px;
    opacity: 0.75;
    margin-top: 4px;
}

.dl__tag {
    font-weight: 500;
}

.dl__err {
    margin-top: 4px;
    font-size: 12px;
    color: var(--el-color-danger, #f56c6c);
}

.dl__ops {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
</style>
