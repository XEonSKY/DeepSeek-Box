<script setup lang="ts">
import { computed } from 'vue'
import type { DownloadThreads } from '@shared/types'

/**
 * 下载并发连接数（「自动 / 手动」开关 + 数值）。设置页的「网络」面板与首次安装向导共用。
 *
 * 「自动」= 按本机 CPU 核心数自适应（取值见 main/dsh/downloader.ts 的 autoDownloadThreads）；
 * 手动档默认给 4，仅在用户拖动后才落成具体数字。
 */

const threads = defineModel<DownloadThreads>({ required: true })

/** 是否手动指定：关 = 自动。 */
const manual = computed({
    get: () => threads.value !== 'auto',
    set: (on: boolean) => {
        threads.value = on ? 4 : 'auto'
    }
})

/** 手动档下的连接数（自动档时给个合法值，避免 el-input-number 拿到 'auto'）。 */
const count = computed({
    get: () => (threads.value === 'auto' ? 4 : threads.value),
    set: (n: number | undefined) => {
        threads.value = typeof n === 'number' && n >= 1 ? n : 'auto'
    }
})
</script>

<template>
    <el-form-item :label="$t('sv.network.downloadThreads')">
        <div class="tf__row">
            <el-switch
                v-model="manual"
                :width="64"
                inline-prompt
                :active-text="$t('sv.network.downloadThreadsManual')"
                :inactive-text="$t('sv.network.downloadThreadsAuto')"
            />
            <el-input-number v-if="manual" v-model="count" :min="1" :max="16" :step="1" />
        </div>
        <div class="nf-hint">{{ $t('sv.network.downloadThreadsHint') }}</div>
    </el-form-item>
</template>

<style scoped>
.tf__row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}
</style>
