<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { DashboardOutlined, IdcardOutlined, ReloadOutlined, RocketOutlined, ThunderboltOutlined } from '@antdv-next/icons'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import TagLabel from '../../components/TagLabel.vue'
import { useSettingsStore } from './useSettingsStore'

/**
 * 「系统与性能」页：启动行为、图形加速与内嵌页面的浏览器标识（UserAgent）。
 *
 * 三组的生效方式不同：
 *  - **启动增强**落盘即写系统登录项（见主进程 autolaunch.ts），无需重启；
 *    **用系统浏览器打开 DSH** 是启动期行为，下次启动生效。
 *  - **图形加速**只能在 `app ready` 之前决定（Electron 限制），改完必须重启：确认 → 落盘 → `relaunch()`。
 *  - **UserAgent** 落盘后主进程立刻 `session.defaultSession.setUserAgent()`，新请求即生效；
 *    已加载的页面要重新请求（刷新 / 重开标签）才带新 UA。
 *
 * 本页已从 Element Plus 迁到 antdv（折叠卡片 + 开关 + 文本域），结构从原来的
 * 「启动 / 性能 / 浏览器」三组重组为「启动 / 性能 / 浏览器标识」：浏览器打开方式并入「启动」，
 * 原独立的「Webview」页只此一项设置，整体并入本页。
 */
const { state } = useSettingsStore()

/** 折叠面板展开项。用 `:active-key` + `@change` 而非 `v-model:active-key`：后者的更新事件未在组件类型里声明。 */
const open = ref<string[]>(['system-startup', 'system-performance', 'system-identity'])

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

// ---- 浏览器标识（UserAgent）--------------------------------------------------
// 默认 UA 由主进程按当前平台 / Chromium 版本 / 程序版本生成（渲染层拿不到这些）。

const defaultUa = ref('')
const currentUa = ref('')

onMounted(async () => {
    try {
        const info = await window.api.get('/webview/info')
        defaultUa.value = info.defaultUserAgent
        currentUa.value = info.currentUserAgent
    } catch {
        /* 拿不到就只显示输入框 */
    }
})

/** 清空 = 回到默认 UA（实际字符串由主进程生成）。 */
function resetUa(): void {
    state.webviewUserAgent = ''
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

            <a-collapse-panel key="system-identity">
                <template #header>
                    <div class="sec__title"><IdcardOutlined /> {{ $t('sv.system.identity') }}</div>
                </template>

                <!-- UserAgent：留空即默认；默认串由主进程按平台/版本生成 -->
                <div class="ua">
                    <div class="ua__t">{{ $t('sv.system.ua') }}</div>
                    <a-textarea
                        v-model:value="state.webviewUserAgent"
                        :rows="3"
                        :placeholder="defaultUa"
                        spellcheck="false"
                    />
                    <div class="ua-actions">
                        <a-button :icon="ReloadOutlined" :disabled="!state.webviewUserAgent" @click="resetUa">
                            {{ $t('sv.system.uaReset') }}
                        </a-button>
                    </div>
                    <div class="hint">{{ $t('sv.system.uaHint') }}</div>

                    <div class="ua-cur">
                        <div class="ua-cur__t">{{ $t('sv.system.uaDefault') }}</div>
                        <code class="ua-cur__v">{{ defaultUa }}</code>
                        <template v-if="state.webviewUserAgent">
                            <div class="ua-cur__t ua-cur__t--top">{{ $t('sv.system.uaCurrent') }}</div>
                            <code class="ua-cur__v">{{ currentUa }}</code>
                        </template>
                    </div>
                </div>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>

<style scoped>
/* UA 串很长：允许折行、等宽字体，别撑破面板（随设置项从原 Webview 页迁入）。 */
.ua {
    margin-top: 2px;
}
.ua__t {
    margin-bottom: 6px;
    font-weight: 600;
}
.ua-actions {
    margin-top: 8px;
}
.ua-cur {
    margin-top: 6px;
}
.ua-cur__t {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-bottom: 4px;
}
.ua-cur__t--top {
    margin-top: 12px;
}
.ua-cur__v {
    display: block;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--el-fill-color-light);
    font-family: var(--el-font-family-mono);
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
    color: var(--el-text-color-regular);
}
</style>
