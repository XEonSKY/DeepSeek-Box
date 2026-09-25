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
        ElMessage.success(tt('extpage.restartHint'))
    } catch (err) {
        ElMessage.error(errorMessage(err))
    }
}

/** 清除某扩展的崩溃记录并解除停用（「我已知道并要试一次」）。 */
async function forgive(ext: ExtInfo): Promise<void> {
    try {
        info.value = await window.api.post('/extensions/:id/forgive', { params: { id: ext.id } })
        ElMessage.success(tt('extpage.forgiven'))
    } catch (err) {
        ElMessage.error(errorMessage(err))
    }
}

/** 退出安全模式并清空崩溃计数。 */
async function exitSafeMode(): Promise<void> {
    try {
        info.value = await window.api.post('/extensions/exit-safe-mode')
        ElMessage.success(tt('extpage.safeExited'))
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

        <a-alert v-if="info?.safeMode" type="error" show-icon :message="$t('extpage.safeMode')">
            <template #description>{{ $t('extpage.safeModeDesc') }}</template>
        </a-alert>

        <div class="extpage__bar">
            <a-button size="small" @click="reload">
                <template #icon><ReloadOutlined /></template>
                {{ $t('extpage.refresh') }}
            </a-button>
            <a-button size="small" @click="openDir">
                <template #icon><FolderOpenOutlined /></template>
                {{ $t('extpage.openDir') }}
            </a-button>
            <a-button v-if="info?.safeMode" size="small" danger @click="exitSafeMode">
                {{ $t('extpage.exitSafe') }}
            </a-button>
            <span class="extpage__dir" :title="info?.externalDir">{{ info?.externalDir }}</span>
        </div>

        <a-list :data-source="info?.entries ?? []" size="small">
            <template #renderItem="{ item }">
                <a-list-item>
                    <a-list-item-meta>
                        <template #title>
                            <span class="extpage__name">{{ item.name }}</span>
                            <a-tag :color="statusColor(item.status)" class="extpage__tag">{{ item.status }}</a-tag>
                            <a-tag>{{ item.kind }}</a-tag>
                        </template>
                        <template #description>
                            <div class="extpage__id">{{ item.id }}<span v-if="item.version"> · {{ item.version }}</span></div>
                            <div v-if="item.message" class="extpage__msg">{{ item.message }}</div>
                        </template>
                    </a-list-item-meta>
                    <template #actions>
                        <a-button
                            v-if="item.removable"
                            size="small"
                            @click="toggle(item)"
                        >
                            {{ item.status === 'disabled' ? $t('extpage.enable') : $t('extpage.disable') }}
                        </a-button>
                        <a-button
                            v-if="item.removable && item.status !== 'disabled' && item.status !== 'active'"
                            size="small"
                            @click="forgive(item)"
                        >
                            {{ $t('extpage.forgive') }}
                        </a-button>
                    </template>
                </a-list-item>
            </template>
        </a-list>

        <a-empty v-if="info && info.entries.length === 0" :description="$t('extpage.empty')" />
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
.extpage__name {
    font-weight: 600;
    margin-right: 8px;
}
.extpage__tag {
    margin-right: 4px;
}
.extpage__id {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    word-break: break-all;
}
.extpage__msg {
    font-size: 12px;
    color: var(--el-color-danger);
    margin-top: 2px;
}
</style>
