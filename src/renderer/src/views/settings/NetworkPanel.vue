<script setup lang="ts">
import { ref } from 'vue'
import { ApiOutlined, LinkOutlined, DownloadOutlined } from '@antdv-next/icons'
import { useSettingsStore } from './useSettingsStore'
import ProxyFields from '../../components/ProxyFields.vue'
import ThreadsField from '../../components/ThreadsField.vue'

const { state } = useSettingsStore()

const open = ref(['network-registry', 'network-proxy', 'network-download'])
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><el-icon :size="34"><ApiOutlined /></el-icon></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.network') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.network') }}</div>
            </div>
        </div>
        <el-collapse v-model="open">
            <el-collapse-item name="network-registry">
                <template #title>
                    <div class="sec__title"><el-icon><ApiOutlined /></el-icon> {{ $t('sv.network.registry') }}</div>
                </template>
                <el-form label-position="top">
                    <el-form-item :label="$t('sv.network.registry')">
                        <el-select v-model="state.npmRegistry" class="reg">
                            <el-option :label="$t('sv.dsh.registryNpmjs')" value="npmjs" />
                            <el-option :label="$t('sv.dsh.registryNpmmirror')" value="npmmirror" />
                        </el-select>
                        <div class="hint">{{ $t('sv.network.registryHint') }}</div>
                    </el-form-item>
                </el-form>
            </el-collapse-item>

            <el-collapse-item name="network-proxy">
                <template #title>
                    <div class="sec__title"><el-icon><LinkOutlined /></el-icon> {{ $t('sv.network.proxy') }}</div>
                </template>
                <el-form label-position="top">
                    <!-- 代理字段与首次安装向导共用同一组件（见 components/ProxyFields.vue） -->
                    <ProxyFields
                        v-model:enabled="state.proxyEnabled"
                        v-model:protocol="state.proxyProtocol"
                        v-model:host="state.proxyHost"
                        v-model:port="state.proxyPort"
                        v-model:scope="state.proxyScope"
                    />
                </el-form>
            </el-collapse-item>

            <el-collapse-item name="network-download">
                <template #title>
                    <div class="sec__title"><el-icon><DownloadOutlined /></el-icon> {{ $t('sv.network.download') }}</div>
                </template>
                <el-form label-position="top">
                    <ThreadsField v-model="state.downloadThreads" />
                </el-form>
            </el-collapse-item>
        </el-collapse>
    </div>
</template>

<style scoped>
.reg {
    width: 100%;
}
</style>
