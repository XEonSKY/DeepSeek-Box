<script setup lang="ts">
import { ref } from 'vue'
import { DashboardOutlined, RocketOutlined, ThunderboltOutlined } from '@antdv-next/icons'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import TagLabel from '../../components/TagLabel.vue'
import { useSettingsStore } from './useSettingsStore'

/**
 * 「系统与性能」页：启动行为与图形加速。
 *
 * 两组的生效方式不同：
 *  - **启动增强**落盘即写系统登录项（见主进程 autolaunch.ts），无需重启；
 *    **用系统浏览器打开 DSH** 是启动期行为，下次启动生效。
 *  - **图形加速**只能在 `app ready` 之前决定（Electron 限制），改完必须重启：确认 → 落盘 → `relaunch()`。
 *
 * 原「浏览器标识（UserAgent）」一组已随 webview 功能迁到内置扩展 `xeonsky.browser`
 * 的设置面板（`/settings/browser`）—— 内嵌页面的配置与内嵌页面功能放在一起更内聚，
 * 停用该扩展时这组设置也随之消失（不再在内核设置里留一个可选功能的字段）。
 */
const { state } = useSettingsStore()

/** 折叠面板展开项。用 `:active-key` + `@change` 而非 `v-model:active-key`：后者的更新事件未在组件类型里声明。 */
const open = ref<string[]>(['system-startup', 'system-performance'])

function onOpenChange(keys: string[]): void {
    open.value = keys
}

/** 图形加速开关：确认后立即落盘并重启（不能等 store 的防抖保存）。 */
async function onGpuAccel(v: boolean): Promise<void> {
    if (v === state.hardwareAcceleration) return
    const ok = await confirmDialog({
        title: tt('sv.system.gpuAccel'),
        message: tt('sv.system.gpuAccelText'),
        confirmText: tt('sv.system.restartNow'),
        cancelText: tt('msg.cancelBtn')
    })
    if (!ok) return // 取消：不动设置
    state.hardwareAcceleration = v
    try {
        const cur = await window.api.get('/settings')
        await window.api.put('/settings', { body: { ...cur, hardwareAcceleration: v } })
    } catch {
        /* 忽略：重启后仍会按内存里的设置走 */
    }
    void window.api.post('/app/relaunch')
}

/** a-switch 的 change 是 (checked, event) 两参签名，包一层只取布尔值。 */
function onGpuAccelChange(checked: boolean): void {
    void onGpuAccel(checked)
}
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><DashboardOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.system') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.system') }}</div>
            </div>
        </div>

        <a-collapse :active-key="open" @change="onOpenChange">
            <a-collapse-panel key="system-startup">
                <template #header>
                    <div class="sec__title"><RocketOutlined /> {{ $t('sv.system.startup') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t"><TagLabel :label="$t('sv.system.autoLaunch')" /></div>
                        <div class="au__desc">{{ $t('sv.system.autoLaunchHint') }}</div>
                    </div>
                    <a-switch v-model:checked="state.autoLaunch" />
                </div>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.system.openInBrowser') }}</div>
                        <div class="au__desc">{{ $t('sv.system.openInBrowserHint') }}</div>
                    </div>
                    <a-switch v-model:checked="state.openDshInBrowser" />
                </div>
            </a-collapse-panel>

            <a-collapse-panel key="system-performance">
                <template #header>
                    <div class="sec__title"><ThunderboltOutlined /> {{ $t('sv.system.performance') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.system.gpuAccel') }}</div>
                        <div class="au__desc">{{ $t('sv.system.gpuAccelHint') }}</div>
                    </div>
                    <a-switch :checked="state.hardwareAcceleration" @change="onGpuAccelChange" />
                </div>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>

<style scoped></style>
