<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import type { Component } from 'vue'
import { AppstoreOutlined, FolderOpenOutlined, ReloadOutlined } from '@antdv-next/icons'
import { useRoute } from 'vue-router'
import { extState } from '../../extensions/store'
import { extTabId } from '../../extensions/tabs'
import { resolveExtPanelView } from '../../extensions/panels'
import { findTab, webTabs } from '../../shell/tabs'
import type { ExtInfo } from '@shared/extensions'

/**
 * 扩展设置面板。
 *
 * 渲染策略取决于扩展级别：
 *  - **内置 / 系统扩展**：若贡献声明了 `view` 且该名在外壳登记表里，挂载真实组件
 *    （「扩展管理」页就是这样来的）；
 *  - **外部扩展**（以及未声明 view 的内置扩展）：落到本文件的通用容器视图，
 *    展示扩展元信息与它贡献的标签页入口。
 *
 * 这个二分是为了让外部扩展**无法**往外壳的 JS 上下文里注入组件 ——
 * 它只能得到一个受控的信息面板，想要更丰富的界面就贡献一个标签页（URL）。
 */

const route = useRoute()

const ext = computed<ExtInfo | null>(() => {
    const entry = extState.panels.find((p) => p.key === panelKey.value)
    if (!entry) return null
    return extState.info?.entries.find((e) => e.id === entry.extId) ?? null
})

/** 当前路由对应的扩展面板 key：来自兜底路由的动态段 `:panelKey`。 */
const panelKey = computed<string>(() => {
    const p = route.params.panelKey
    return typeof p === 'string' ? p : Array.isArray(p) ? (p[0] ?? '') : ''
})

/** 当前面板贡献。 */
const panel = computed(() => extState.panels.find((p) => p.key === panelKey.value) ?? null)

/** 该扩展能解析到本地视图时，用它替代通用容器。 */
const localComponent = ref<Component | null>(null)
watch(
    [() => panel.value?.view, () => ext.value?.kind],
    async () => {
        const loader = resolveExtPanelView(panel.value?.view, ext.value?.kind)
        localComponent.value = loader ? defineAsyncComponent(loader) : null
    },
    { immediate: true }
)

/** 该扩展贡献的标签页入口。 */
const tabs = computed(() => extState.tabs.filter((t) => t.extId === ext.value?.id))

/** 打开该扩展贡献的某个标签页（已存在则激活）。 */
function openTabOf(key: string): void {
    if (!ext.value) return
    const id = extTabId(ext.value.id, key)
    if (findTab(id)) {
        webTabs.activeId = id
        return
    }
    void import('../../extensions/tabs').then((m) => m.openExtTab(ext.value!.id, key))
}

/** 在文件管理器里定位扩展目录（仅外部扩展有意义）。 */
async function revealDir(): Promise<void> {
    if (ext.value?.kind === 'external') await window.api.post('/extensions/open-dir')
}

/** 该扩展是不是安全模式 / 停用等非正常态。 */
const abnormal = computed(() => !!ext.value && ext.value.status !== 'active')
</script>

<template>
    <!-- 内置 / 系统扩展：挂载外壳登记的本地组件（如「扩展管理」页）。 -->
    <component :is="localComponent" v-if="localComponent" />
    <div class="panel" v-else>
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><AppstoreOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ ext?.name ?? panelKey }}</div>
                <div class="dsh-brand__desc">{{ ext?.id ?? $t('extpanel.missing') }}</div>
            </div>
        </div>

        <a-alert v-if="!ext" type="warning" show-icon :message="$t('extpanel.missing')" />

        <template v-else>
            <a-alert v-if="abnormal" type="warning" show-icon :message="ext.message || $t('extpanel.inactive')" />

            <a-collapse :active-key="['info']">
                <a-collapse-panel key="info" :header="$t('extpanel.info')">
                    <div class="extinfo">
                        <div class="extinfo__row"><span>{{ $t('extpanel.kind') }}</span><b>{{ ext.kind }}</b></div>
                        <div class="extinfo__row"><span>{{ $t('extpanel.version') }}</span><b>{{ ext.version || '-' }}</b></div>
                        <div class="extinfo__row"><span>{{ $t('extpanel.status') }}</span><b>{{ ext.status }}</b></div>
                        <div class="extinfo__row">
                            <span>{{ $t('extpanel.caps') }}</span>
                            <b>{{ ext.capabilities.length ? ext.capabilities.join(', ') : '-' }}</b>
                        </div>
                        <div class="extinfo__row extinfo__row--path">
                            <span>{{ $t('extpanel.dir') }}</span><b :title="ext.dir">{{ ext.dir }}</b>
                        </div>
                    </div>
                    <div class="extinfo__actions">
                        <a-button v-if="ext.kind === 'external'" size="small" @click="revealDir">
                            <template #icon><FolderOpenOutlined /></template>
                            {{ $t('extpanel.reveal') }}
                        </a-button>
                    </div>
                </a-collapse-panel>

                <a-collapse-panel v-if="tabs.length" key="tabs" :header="$t('extpanel.tabs')">
                    <div class="exttabs">
                        <a-button v-for="t in tabs" :key="t.key" size="small" @click="openTabOf(t.key)">
                            <template #icon><ReloadOutlined /></template>
                            {{ t.titleKey }}
                        </a-button>
                    </div>
                </a-collapse-panel>
            </a-collapse>
        </template>
    </div>
</template>

<style scoped>
.extinfo {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.extinfo__row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    font-size: 13px;
}
.extinfo__row > span {
    color: var(--el-text-color-secondary);
    flex: 0 0 auto;
}
.extinfo__row > b {
    font-weight: 500;
    word-break: break-all;
    text-align: right;
}
.extinfo__actions {
    margin-top: 14px;
}
.exttabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
</style>
