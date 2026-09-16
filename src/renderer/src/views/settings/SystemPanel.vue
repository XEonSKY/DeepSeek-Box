<script setup lang="ts">
import { ref } from 'vue'
import { DashboardOutlined, RocketOutlined, ThunderboltOutlined, CompassOutlined } from '@antdv-next/icons'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import { useSettingsStore } from './useSettingsStore'

/**
 * 「系统与性能」页：启动增强（开机自启）、图形加速与浏览器打开方式。
 *
 * 三项的生效方式不同：
 *  - **图形加速**只能在 `app ready` 之前决定（Electron 限制），改完必须重启；交互照抄外观页
 *    「禁用系统缩放」：确认 → 落盘 → `relaunch()`。
 *  - **启动增强**落盘即写系统登录项（见主进程 autolaunch.ts），无需重启。
 *  - **用系统浏览器打开 DSH** 与启动隐藏到托盘是启动期行为，下次启动生效。
 */
const { state } = useSettingsStore()

const open = ref(['system-startup', 'system-performance', 'system-browser'])

/** 图形加速开关：确认后保存并重启。 */
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
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><el-icon :size="34"><DashboardOutlined /></el-icon></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.system') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.system') }}</div>
            </div>
        </div>

        <el-collapse v-model="open">
            <el-collapse-item name="system-startup">
                <template #title>
                    <div class="sec__title"><el-icon><RocketOutlined /></el-icon> {{ $t('sv.system.startup') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.system.autoLaunch') }}</div>
                        <div class="au__desc">{{ $t('sv.system.autoLaunchHint') }}</div>
                    </div>
                    <el-switch v-model="state.autoLaunch" />
                </div>
            </el-collapse-item>

            <el-collapse-item name="system-performance">
                <template #title>
                    <div class="sec__title"><el-icon><ThunderboltOutlined /></el-icon> {{ $t('sv.system.performance') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.system.gpuAccel') }}</div>
                        <div class="au__desc">{{ $t('sv.system.gpuAccelHint') }}</div>
                    </div>
                    <el-switch :model-value="state.hardwareAcceleration" @update:model-value="onGpuAccel" />
                </div>
            </el-collapse-item>

            <el-collapse-item name="system-browser">
                <template #title>
                    <div class="sec__title"><el-icon><CompassOutlined /></el-icon> {{ $t('sv.system.browser') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.system.openInBrowser') }}</div>
                        <div class="au__desc">{{ $t('sv.system.openInBrowserHint') }}</div>
                    </div>
                    <el-switch v-model="state.openDshInBrowser" />
                </div>
            </el-collapse-item>
        </el-collapse>
    </div>
</template>
