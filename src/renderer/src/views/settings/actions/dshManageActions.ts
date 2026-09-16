import { ElMessage } from 'element-plus'
import { errorMessage } from '@shared/errors'
import { tt } from '../../../lib/locales'
import { confirmDialog } from '../../../lib/confirm'
import { dshCheck, checkAndNotify } from '../../../lib/update'
import type { SettingsState } from '../settingsStore'

/**
 * @deepseek-ai/dsh 包版本管理相关动作：版本列表、更新检查/升级、切换版本、卸载。
 *
 * 从 useSettingsStore 抽出：这组动作自成一体（只依赖 `state` + `window.api` + 提示框），
 * 且都围绕「dsh 会被替换，替换前必须先停 dsh」这一约束展开，内聚度高。
 */

type DshManageActions = {
    loadVersions(): Promise<void>
    versionLabel(v: string): string
    runUpdateCheck(): Promise<void>
    runUpdateDsh(): Promise<void>
    switchVersion(): Promise<void>
    confirmUninstall(): Promise<void>
}

export function createDshManageActions(state: SettingsState): DshManageActions {
    async function loadVersions(): Promise<void> {
        if (state.versionsLoading) return
        state.versionsLoading = true
        try {
            const list = await window.api.get('/dsh/versions', {
                query: {
                    prerelease: state.autoCheckPrerelease,
                    registry: state.npmRegistry
                }
            })
            state.versions = list
            if (state.selectedVersion && !list.includes(state.selectedVersion)) state.selectedVersion = ''
        } catch {
            state.versions = []
        } finally {
            state.versionsLoading = false
        }
    }

    function versionLabel(v: string): string {
        return v === state.version ? v + tt('sv.dsh.currentSuffix') : v
    }

    /**
   * dsh-modifying operations (upgrade / version switch) must first stop any
   * running dsh. Only when one is actually running do we confirm before closing
   * it; the main process also force-stops it independently before the npm step.
   * Resolves true when it is safe to proceed (not running, or user confirmed).
   */
    async function confirmStopDshIfRunning(body: string): Promise<boolean> {
        let running: boolean
        try {
            running = await window.api.get('/dsh/running')
        } catch {
            running = false
        }
        if (!running) return true
        const ok = await confirmDialog({
            title: tt('msg.dshRunningTitle'),
            message: body,
            confirmText: tt('msg.continueBtn'),
            cancelText: tt('msg.cancelBtn'),
            danger: true
        })
        return ok
    }

    async function runUpdateCheck(): Promise<void> {
        if (state.updating) return
        state.updating = true
        try {
            await checkAndNotify({
                prerelease: state.autoCheckPrerelease,
                registry: state.npmRegistry
            })
        } finally {
            state.updating = false
        }
    }

    async function runUpdateDsh(): Promise<void> {
        if (state.updatingDsh) return
        if (!(await confirmStopDshIfRunning(tt('msg.updateStopText')))) return
        state.updatingDsh = true
        try {
            const r = await window.api.post('/dsh/update', { body: { registry: state.npmRegistry } })
            if (r.ok) {
                state.version = r.version
                dshCheck.found = false
                dshCheck.latest = null
                // 装/切换完版本后清掉「检查过」标记：否则「dsh」页会拿旧的检查结果继续显示「已是最新」。
                dshCheck.checked = false
                ElMessage.success(r.message)
            } else if (!r.canceled) {
                // 用户主动取消不算失败，静默返回。
                ElMessage.error(r.message || '')
            }
        } catch (err) {
            ElMessage.error(tt('msg.updateDshFail', { err: errorMessage(err) }))
        } finally {
            state.updatingDsh = false
        }
    }

    async function switchVersion(): Promise<void> {
        const target = state.selectedVersion
        if (!target || state.switchingDsh) return
        if (!(await confirmStopDshIfRunning(tt('msg.switchStopText')))) return
        state.switchingDsh = true
        try {
            // 目标版本已在本地安装列表中 → 只切生效指针（不重装）；否则才真正下载安装。
            const local = await window.api.get('/versions/:kind', { params: { kind: 'dsh' } })
            const r = local.installed.includes(target)
                ? await window.api.put('/versions/:kind/active', { params: { kind: 'dsh' }, body: { version: target } })
                : await window.api.post('/dsh/install', { body: { version: target, registry: state.npmRegistry } })
            if (r.ok) {
                state.version = r.version
                dshCheck.found = false
                dshCheck.latest = null
                // 装/切换完版本后清掉「检查过」标记：否则「dsh」页会拿旧的检查结果继续显示「已是最新」。
                dshCheck.checked = false
                await loadVersions()
                ElMessage.success(r.message)
            } else if (!r.canceled) {
                // 用户主动取消不算失败，静默返回。
                ElMessage.error(r.message || '')
            }
        } catch (err) {
            ElMessage.error(tt('msg.installFail', { err: errorMessage(err) }))
        } finally {
            state.switchingDsh = false
        }
    }

    async function confirmUninstall(): Promise<void> {
        const ok = await confirmDialog({
            title: tt('msg.uninstallBoxTitle'),
            message: tt('msg.uninstallBoxText', { pkg: '@deepseek-ai/dsh' }),
            confirmText: tt('msg.uninstallOkBtn'),
            cancelText: tt('msg.cancelBtn'),
            danger: true
        })
        if (!ok) return // cancelled
        state.uninstalling = true
        try {
            const r = await window.api.delete('/dsh')
            if (r.ok) {
                ElMessage.success(tt('msg.uninstallOk'))
            } else {
                ElMessage.error(r.message || tt('msg.uninstallFail', { err: '' }))
            }
        } catch (err) {
            ElMessage.error(tt('msg.uninstallFail', { err: errorMessage(err) }))
        } finally {
            state.uninstalling = false
        }
    }

    return { loadVersions, versionLabel, runUpdateCheck, runUpdateDsh, switchVersion, confirmUninstall }
}
