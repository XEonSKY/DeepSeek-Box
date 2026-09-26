import { useI18n } from 'vue-i18n'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import { useSettingsStore } from './useSettingsStore'

/**
 * 「常规 → 启动与性能」一组的逻辑（原「系统与性能」独立面板，现并入常规页）。
 *
 * 抽成 composable 而不是留在组件里：常规页合并了原先三个面板的内容，
 * 若把每个面板的逻辑都塞进同一个 `<script setup>`，那个文件会变成一个什么都装的包袱。
 * 这里只导出**行为**（一个确认对话框 + 一次落盘 + 重启），面板结构留在 GeneralPanel.vue。
 *
 * ## 两组的生效方式不同（这是本组最需要说清的事）
 *
 *  - **启动增强**落盘即写系统登录项（见主进程 `app/autolaunch.ts`），无需重启；
 *    **用系统浏览器打开 DSH** 是启动期行为，下次启动生效。
 *  - **图形加速**只能在 `app ready` 之前决定（Electron 限制），改完必须重启：
 *    确认 → 落盘 → `relaunch()`。
 *
 * 原「浏览器标识（UserAgent）」一组已随 webview 功能迁到内置扩展 `xeonsky.browser`
 * 的设置面板 —— 内嵌页面的配置与内嵌页面功能放在一起更内聚，
 * 停用该扩展时这组设置也随之消失（不再在内核设置里留一个可选功能的字段）。
 */
export function useSystemSettings() {
    const { state } = useSettingsStore()
    const { t } = useI18n({ useScope: 'global' })

    /** 图形加速开关：确认后立即落盘并重启（不能等 store 的防抖保存）。 */
    async function onGpuAccel(v: boolean): Promise<void> {
        if (v === state.hardwareAcceleration) return
        const ok = await confirmDialog({
            title: t('sv.system.gpuAccel'),
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

    return { onGpuAccel, onGpuAccelChange }
}
