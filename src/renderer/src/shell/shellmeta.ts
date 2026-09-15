import { reactive } from 'vue'

/**
 * 当前窗口元信息（winId + 是否核心窗口）。核心窗口才承载 dsh UI；多窗口架构中，
 * 新开的非核心窗口 isCore=false。由 bootstrap 在挂载前读取。
 */
export const shellMeta = reactive<{ winId: number; isCore: boolean; loaded: boolean }>({
    winId: 0,
    isCore: true,
    loaded: false
})

export async function loadShellMeta(): Promise<void> {
    try {
        const m = await window.api.get('/shell/meta')
        shellMeta.winId = m.winId
        shellMeta.isCore = m.isCore
    } catch {
    /* 异常环境按核心窗口处理 */
    }
    shellMeta.loaded = true
}
