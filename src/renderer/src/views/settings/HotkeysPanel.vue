<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ControlOutlined, DeleteOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { HotkeyState } from '@shared/types'
import { buildAccelerator, prettyAccelerator } from '@shared/hotkeys'
import { tt } from '../../lib/locales'
import { useSettingsStore } from './useSettingsStore'

/**
 * 「快捷键」页。
 *
 * 三个快捷键共用一个录制交互：点「修改」→ 本行进入录制态 → 按下组合键即写入（Esc 取消）。
 * 写入走 store 的防抖落盘；**系统全局**那个由主进程在 `settings:save` 时重新注册
 * （`syncGlobalHotkey()`，幂等），注册结果经 `hotkey:state` 广播回来 —— 被别的程序占用时
 * 这里会显示提示，而不是让用户以为设好了。
 */

const { state } = useSettingsStore()

const isMac = window.api.platform === 'darwin'

/** 已注册的全局快捷键状态（主进程 globalShortcut 的真实结果）。 */
const globalState = ref<HotkeyState | null>(null)
let offState: (() => void) | null = null

/** 正在录制哪一行（字段名）；null 表示没有在录制。 */
const recording = ref<HotkeyField | null>(null)

type HotkeyField = 'hotkeyFocusWindow' | 'hotkeyToggleTerminal' | 'hotkeyDevTools'

const ROWS: Array<{ field: HotkeyField; labelKey: string; hintKey: string; global?: boolean }> = [
    { field: 'hotkeyFocusWindow', labelKey: 'sv.hotkeys.focusWindow', hintKey: 'sv.hotkeys.focusWindowHint', global: true },
    { field: 'hotkeyToggleTerminal', labelKey: 'sv.hotkeys.toggleTerminal', hintKey: 'sv.hotkeys.toggleTerminalHint' },
    { field: 'hotkeyDevTools', labelKey: 'sv.hotkeys.devTools', hintKey: 'sv.hotkeys.devToolsHint' }
]

const open = ref(['hotkeys'])

onMounted(async () => {
    window.addEventListener('keydown', onKeydown, true)
    offState = window.api.on('hotkey:state', (s) => {
        globalState.value = s
    })
    try {
        globalState.value = await window.api.get('/hotkeys/state')
    } catch {
        globalState.value = null
    }
})

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown, true)
    offState?.()
})

/** 录制态下抓取按键：Esc 取消，纯修饰键忽略，其余交给 buildAccelerator 判定是否可接受。 */
function onKeydown(e: KeyboardEvent): void {
    const field = recording.value
    if (!field) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') {
        recording.value = null
        return
    }
    const accel = buildAccelerator(
        { key: e.key, control: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey },
        isMac
    )
    if (!accel) return // 纯修饰键 / 不支持的主键 → 继续等
    state[field] = accel
    recording.value = null
}

function startRecord(field: HotkeyField): void {
    recording.value = field
}

/** 清空 = 禁用（全局那个会立刻注销，见主进程 syncGlobalHotkey）。 */
function clearHotkey(field: HotkeyField): void {
    state[field] = ''
    if (field === 'hotkeyFocusWindow') ElMessage.success(tt('sv.hotkeys.cleared'))
}

function resetHotkey(field: HotkeyField): void {
    // 默认值只从 DEFAULT_SETTINGS 取 —— 不在文案文件里再抄一份，避免两处漂移。
    state[field] = DEFAULT_SETTINGS[field]
}

/** 显示用的键名（CommandOrControl → 本平台的 Ctrl / Cmd）。 */
function display(field: HotkeyField): string {
    return prettyAccelerator(state[field], isMac) || tt('sv.hotkeys.none')
}

/** 全局快捷键被占用：只有它注册失败了才提示。 */
const globalFailed = computed(() => state.hotkeyFocusWindow !== '' && globalState.value?.ok === false)
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><el-icon :size="34"><ControlOutlined /></el-icon></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.hotkeys') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.hotkeys') }}</div>
            </div>
        </div>

        <el-collapse v-model="open">
            <el-collapse-item name="hotkeys">
                <template #title>
                    <div class="sec__title"><el-icon><ControlOutlined /></el-icon> {{ $t('sv.hotkeys.title') }}</div>
                </template>

                <div v-for="row in ROWS" :key="row.field" class="hk">
                    <div class="hk__txt">
                        <div class="hk__t">
                            {{ $t(row.labelKey) }}
                            <el-tag v-if="row.global" size="small" type="warning" effect="plain">{{ $t('sv.hotkeys.global') }}</el-tag>
                        </div>
                        <div class="hk__desc">{{ $t(row.hintKey) }}</div>
                    </div>
                    <div class="hk__keys">
                        <kbd class="hk__kbd" :class="{ 'hk__kbd--rec': recording === row.field }">
                            {{ recording === row.field ? $t('sv.hotkeys.recording') : display(row.field) }}
                        </kbd>
                        <el-button size="small" :type="recording === row.field ? 'primary' : 'default'" @click="startRecord(row.field)">
                            {{ $t('sv.hotkeys.change') }}
                        </el-button>
                        <el-button size="small" :icon="DeleteOutlined" :disabled="!state[row.field]" @click="clearHotkey(row.field)">
                            {{ $t('sv.hotkeys.clear') }}
                        </el-button>
                        <el-button size="small" :icon="ReloadOutlined" @click="resetHotkey(row.field)">
                            {{ $t('sv.hotkeys.reset') }}
                        </el-button>
                    </div>
                </div>

                <!-- 被占用时说清楚：快捷键有可能已经被别的程序抢走 -->
                <div v-if="globalFailed" class="warn">
                    {{ $t('sv.hotkeys.busy', { accel: display('hotkeyFocusWindow') }) }}
                </div>

                <div class="hint">{{ $t('sv.hotkeys.hint') }}</div>
            </el-collapse-item>
        </el-collapse>
    </div>
</template>

<style scoped>
/* 只留本组件专用规则；跨组件通用样式一律进 styles/*.css（见 AGENT.md §3 样式约定）。 */
.hk {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 0;
}
.hk + .hk {
  border-top: 1px solid var(--el-border-color-lighter);
}
.hk__txt {
  flex: 1 1 auto;
  min-width: 240px;
}
.hk__t {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 4px;
}
.hk__desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.hk__keys {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.hk__kbd {
  min-width: 118px;
  padding: 3px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-light);
  font-family: var(--el-font-family-mono);
  font-size: 12px;
  text-align: center;
  color: var(--el-text-color-primary);
}
/* 录制态：给出明显的视觉反馈，否则用户不知道程序在等按键 */
.hk__kbd--rec {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
</style>
