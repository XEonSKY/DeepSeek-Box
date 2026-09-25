<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { AppstoreOutlined, ReloadOutlined, FolderOpenOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { ExtInfo, ExtensionsInfo } from '@shared/extensions'
import { errorMessage } from '@shared/errors'
import { tt } from '../../lib/locales'

/**
 * 「扩展」页：列出全部已发现扩展，支持停用 / 启用 / 清除崩溃记录，
 * 并在安全模式时给出显式退出入口。
 *
 * 这一页是**外壳自带**的（不进扩展体系），否则一旦所有扩展被安全模式停掉，
 * 用户就没有界面去停用那个"罪魁祸首"了 —— 自助路径必须是内核自带的能力，
 * 不能依赖扩展本身。
 *
 * 列出的是主进程裁决的**全部**条目（含失败 / 跳过 / 停用），
 * 因为排查时最需要知道的是"为什么它没跑起来"。
 */

const info = ref<ExtensionsInfo | null>(null)
const loading = ref(false)
let offChanged: (() => void) | null = null

/** 拉取扩展列表。 */
async function reload(): Promise<void> {
    loading.value = true
    try {
        info.value = await window.api.get('/extensions')
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        loading.value = false
    }
}

/** 启用 / 停用某扩展（重启后生效）。 */
async function toggle(ext: ExtInfo): Promise<void> {
    try {
        info.value = await window.api.put('/extensions/:id/enabled', {
            params: { id: ext.id },
            body: { enabled: ext.status === 'disabled' }
        })
        ElMessage.success(tt('sv.extpage.restartHint'))
    } catch (err) {
        ElMessage.error(errorMessage(err))
    }
}

/** 清除某扩展的崩溃记录并解除停用（「我已知道并要试一次」）。 */
async function forgive(ext: ExtInfo): Promise<void> {
    try {
        info.value = await window.api.post('/extensions/:id/forgive', { params: { id: ext.id } })
        ElMessage.success(tt('sv.extpage.forgiven'))
    } catch (err) {
        ElMessage.error(errorMessage(err))
    }
}

/** 退出安全模式并清空崩溃计数。 */
async function exitSafeMode(): Promise<void> {
    try {
        info.value = await window.api.post('/extensions/exit-safe-mode')
        ElMessage.success(tt('sv.extpage.safeExited'))
    } catch (err) {
        ElMessage.error(errorMessage(err))
    }
}

/** 在文件管理器里打开外部扩展目录。 */
async function openDir(): Promise<void> {
    try {
        await window.api.post('/extensions/open-dir')
    } catch (err) {
        ElMessage.error(errorMessage(err))
    }
}

/** 状态标签的颜色。 */
function statusColor(status: ExtInfo['status']): string {
    if (status === 'active') return 'green'
    if (status === 'failed') return 'red'
    if (status === 'disabled') return 'default'
    return 'orange'
}

/** 状态标签的文案键（外层统一加 `sv.extpage.` 前缀）。 */
const STATUS_KEY: Record<ExtInfo['status'], string> = {
    active: 'stActive',
    disabled: 'stDisabled',
    failed: 'stFailed',
    skipped: 'stSkipped'
}

/** 来源（三级）的文案键。 */
const KIND_KEY: Record<ExtInfo['kind'], string> = {
    system: 'kindSystem',
    builtin: 'kindBuiltin',
    external: 'kindExternal'
}

onMounted(() => {
    void reload()
    offChanged = window.api.on('extensions:changed', () => void reload())
})
onBeforeUnmount(() => offChanged?.())
</script>

<template>
    <div class="panel" v-loading="loading">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><AppstoreOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.extensions') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.extensions') }}</div>
            </div>
        </div>

        <a-alert v-if="info?.safeMode" type="error" show-icon :message="$t('sv.extpage.safeMode')">
            <template #description>{{ $t('sv.extpage.safeModeDesc') }}</template>
        </a-alert>

        <div class="extpage__bar">
            <a-button size="small" @click="reload">
                <template #icon><ReloadOutlined /></template>
                {{ $t('sv.extpage.refresh') }}
            </a-button>
            <a-button size="small" @click="openDir">
                <template #icon><FolderOpenOutlined /></template>
                {{ $t('sv.extpage.openDir') }}
            </a-button>
            <a-button v-if="info?.safeMode" size="small" danger @click="exitSafeMode">
                {{ $t('sv.extpage.exitSafe') }}
            </a-button>
            <span class="extpage__dir" :title="info?.externalDir">{{ info?.externalDir }}</span>
        </div>

        <div class="iv extpage__list">
            <div class="iv__title">{{ $t('sv.extpage.listTitle') }}</div>
            <div v-if="info && !info.entries.length" class="hint">{{ $t('sv.extpage.empty') }}</div>
            <div v-else class="iv__list">
                <div class="iv__thead">
                    <span class="iv__c-name">{{ $t('sv.extpage.colName') }}</span>
                    <span class="iv__c-kind">{{ $t('sv.extpage.colKind') }}</span>
                    <span class="iv__c-status">{{ $t('sv.extpage.colStatus') }}</span>
                    <span class="iv__c4">{{ $t('sv.env.colActions') }}</span>
                </div>
                <div class="iv__tbody">
                    <div v-for="item in info?.entries ?? []" :key="item.id" class="iv__row">
                        <span class="iv__c-name">
                            <span class="extpage__name">{{ item.name }}</span>
                            <code class="extpage__id">{{ item.id }}<template v-if="item.version"> · {{ item.version }}</template></code>
                            <span v-if="item.message" class="extpage__msg" :title="item.message">{{ item.message }}</span>
                        </span>
                        <span class="iv__c-kind">
                            <a-tag>{{ $t('sv.extpage.' + KIND_KEY[item.kind]) }}</a-tag>
                        </span>
                        <span class="iv__c-status">
                            <a-tag :color="statusColor(item.status)">{{ $t('sv.extpage.' + STATUS_KEY[item.status]) }}</a-tag>
                        </span>
                        <span class="iv__c4">
                            <a-button v-if="item.removable" @click="toggle(item)">
                                {{ item.status === 'disabled' ? $t('sv.extpage.enable') : $t('sv.extpage.disable') }}
                            </a-button>
                            <a-button
                                v-if="item.removable && item.status !== 'disabled' && item.status !== 'active'"
                                @click="forgive(item)"
                            >
                                {{ $t('sv.extpage.forgive') }}
                            </a-button>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.extpage__bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 12px;
}
.extpage__dir {
    margin-left: auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
}

/*
 * 列表占满剩余高度：本页不用折叠卡片（内容就是一整张表），所以整页做成一条纵向 flex 链 ——
 * `.el-scrollbar__view` → `.cols` → `.panel` 都撑满，只有 `.iv__list` 滚动，
 * 页面本身不出现第二条滚动条。父级链的 flex 定义见 styles/settings.css。
 */
.panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
}
.extpage__list {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
}
.extpage__list .iv__list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
}

/* 列表是四列（名称 / 来源 / 状态 / 操作），与三列的版本列表不同，故单独定列宽。 */
.iv__c-name {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
}
.iv__c-kind {
    flex: 0 0 72px;
    display: flex;
    align-items: center;
}
.iv__c-status {
    flex: 0 0 88px;
    display: flex;
    align-items: center;
}
.iv__c4 {
    flex: 0 0 176px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
}

.extpage__name {
    font-weight: 600;
    flex: 0 0 auto;
}
.extpage__id {
    font-family: var(--el-font-family-mono);
    font-size: 12px;
    color: var(--el-text-color-secondary);
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.extpage__msg {
    font-size: 12px;
    color: var(--el-color-danger);
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
