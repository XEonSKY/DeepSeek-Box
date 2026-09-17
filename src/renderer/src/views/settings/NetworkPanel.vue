<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiOutlined, DownloadOutlined, LinkOutlined } from '@antdv-next/icons'
import { useSettingsStore } from './useSettingsStore'
import ProxyFields from '../../components/ProxyFields.vue'
import ThreadsField from '../../components/ThreadsField.vue'

/**
 * 「网络」页：npm 镜像源、代理与下载并发数。
 * 已从 Element Plus 迁到 antdv（折叠卡片 + 表单控件）；代理字段与首次安装向导共用
 * （见 components/ProxyFields.vue）。
 */
const { state } = useSettingsStore()
const { t } = useI18n({ useScope: 'global' })

/** 折叠面板展开项。用 `:active-key` + `@change` 而非 `v-model:active-key`：后者的更新事件未在组件类型里声明。 */
const open = ref<string[]>(['network-registry', 'network-proxy', 'network-download'])

function onOpenChange(keys: string[]): void {
    open.value = keys
}

/** 镜像源下拉：a-select 用 :options（项目约定，见 DshWizard.vue）；用 computed 跟随语言切换。 */
const registryOptions = computed(() => [
    { value: 'npmjs', label: t('sv.dsh.registryNpmjs') },
    { value: 'npmmirror', label: t('sv.dsh.registryNpmmirror') }
])
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><ApiOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.network') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.network') }}</div>
            </div>
        </div>
        <a-collapse :active-key="open" @change="onOpenChange">
            <a-collapse-panel key="network-registry">
                <template #header>
                    <div class="sec__title"><ApiOutlined /> {{ $t('sv.network.registry') }}</div>
                </template>
                <a-form layout="vertical">
                    <a-form-item :label="$t('sv.network.registry')">
                        <a-select v-model:value="state.npmRegistry" :options="registryOptions" class="reg" />
                        <div class="hint">{{ $t('sv.network.registryHint') }}</div>
                    </a-form-item>
                </a-form>
            </a-collapse-panel>

            <a-collapse-panel key="network-proxy">
                <template #header>
                    <div class="sec__title"><LinkOutlined /> {{ $t('sv.network.proxy') }}</div>
                </template>
                <a-form layout="vertical">
                    <!-- 代理字段与首次安装向导共用同一组件（见 components/ProxyFields.vue） -->
                    <ProxyFields
                        v-model:enabled="state.proxyEnabled"
                        v-model:protocol="state.proxyProtocol"
                        v-model:host="state.proxyHost"
                        v-model:port="state.proxyPort"
                        v-model:scope="state.proxyScope"
                    />
                </a-form>
            </a-collapse-panel>

            <a-collapse-panel key="network-download">
                <template #header>
                    <div class="sec__title"><DownloadOutlined /> {{ $t('sv.network.download') }}</div>
                </template>
                <a-form layout="vertical">
                    <ThreadsField v-model="state.downloadThreads" />
                </a-form>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>

<style scoped>
.reg {
    width: 100%;
}
</style>
