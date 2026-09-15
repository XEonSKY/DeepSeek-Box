import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import { isDark } from './theme'
import iconLight from '../assets/icon.png'
import iconDark from '../assets/icon-dark.png'
import type { AppIconState } from '@shared/types'

/**
 * 当前生效的程序图标预览（自定义 / 预制图标的 data URL；用内置 Logo 时为 null）。
 * 由主进程广播（保存设置 / 上传 / 删除图标）与 `initAppIcon()` 的首次拉取共同维护。
 */
const customIcon = ref<string | null>(null)

/** 应用一次主进程给出的图标状态：id 为空表示内置 Logo。 */
export function applyAppIconState(s: AppIconState): void {
    customIcon.value = s && s.id && s.dataUrl ? s.dataUrl : null
}

let inited = false

/**
 * 订阅并拉取一次程序图标（幂等）。在 App.vue 的 boot() 里调用一次即可：
 * 订阅与渲染进程同寿，不需要（也不应）在组件卸载时退订。
 */
export async function initAppIcon(): Promise<void> {
    if (inited) return
    inited = true
    window.api.on('appicon:changed', applyAppIconState)
    try {
        applyAppIconState(await window.api.get('/icons/current'))
    } catch {
    /* 读不到就保持内置 Logo */
    }
}

/**
 * 应用 Logo 的图片来源：用户自定义 / 预制图标优先（见主进程 appicon.ts），
 * 否则深色模式用 `icon-dark.png`、其余用 `icon.png`。
 *
 * 复用 `theme.ts` 的 `isDark`——它由 useDark 驱动 `<html>.dark`，且 `applyTheme()` 已把
 * `theme: 'system'` 解析为实际明暗并实时跟随系统偏好，因此这里**不要**直接判断
 * `settings.theme === 'dark'`（那会漏掉 system 场景）。
 *
 * 用法（`<script setup>` 内取局部 ref，模板中自动解包）：
 *   const appIcon = useAppIcon()
 *   <img :src="appIcon" />
 */
export function useAppIcon(): ComputedRef<string> {
    return computed(() => customIcon.value ?? (isDark.value ? iconDark : iconLight))
}
