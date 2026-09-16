import { ElMessage } from 'element-plus'
import { errorMessage } from '@shared/errors'
import type { SettingsState } from '../settingsStore'

/**
 * dsh 进程生命周期相关动作（读取版本、查询/启动/停止/重启）。
 *
 * 从 useSettingsStore 抽出：这组动作只依赖 `state` 与 `window.api`，与 store 内的
 * 防抖保存、表单填充等**没有共享可变状态**，因此可独立成模块而不需要额外注入。
 */

type DshActions = {
    loadVersion(): Promise<void>
    refreshRunning(): Promise<void>
    startDsh(): Promise<void>
    stopDsh(): Promise<void>
    restartDsh(): Promise<void>
}

export function createDshActions(state: SettingsState): DshActions {
    async function loadVersion(): Promise<void> {
        try {
            state.version = await window.api.get('/dsh/version')
        } catch {
            state.version = null
        }
    }

    /** 刷新 dsh 运行状态。 */
    async function refreshRunning(): Promise<void> {
        try {
            state.dshRunning = await window.api.get('/dsh/running')
        } catch {
            state.dshRunning = false
        }
    }

    /** 启动 dsh（未运行时拉起来）。 */
    async function startDsh(): Promise<void> {
        try {
            await window.api.post('/dsh/start')
        } catch (err) {
            ElMessage.error(errorMessage(err))
        } finally {
            await refreshRunning()
        }
    }

    /** 停止 dsh。 */
    async function stopDsh(): Promise<void> {
        try {
            await window.api.post('/dsh/stop')
        } catch (err) {
            ElMessage.error(errorMessage(err))
        } finally {
            await refreshRunning()
        }
    }

    /** 用当前配置重启 dsh。 */
    async function restartDsh(): Promise<void> {
        try {
            await window.api.post('/dsh/restart')
        } catch (err) {
            ElMessage.error(errorMessage(err))
        } finally {
            await refreshRunning()
        }
    }

    return { loadVersion, refreshRunning, startDsh, stopDsh, restartDsh }
}
