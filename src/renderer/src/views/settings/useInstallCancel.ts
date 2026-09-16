import { ref } from 'vue'
import type { Ref } from 'vue'

/**
 * 「取消当前在途安装」的共享实现。
 *
 * dsh 的安装 / 更新 / 切换与 Node / npm 的部署共用主进程的同一个取消入口
 * （`/installs/cancel` 会中止所有登记中的可取消操作，见 main/dsh/cancel.ts），
 * 因此 DshPanel 与 EnvPanel 里那份逐字相同的「防重入 + loading 开关」逻辑
 * 收敛到一处；各页面只需要一个自己的按钮状态。
 */
export function useInstallCancel(): { canceling: Ref<boolean>; cancelInstall: () => Promise<void> } {
    /** 取消按钮的进行中状态。 */
    const canceling = ref(false)

    async function cancelInstall(): Promise<void> {
        if (canceling.value) return
        canceling.value = true
        try {
            await window.api.post('/installs/cancel')
        } catch {
            /* 取消失败无需打扰用户 */
        } finally {
            canceling.value = false
        }
    }

    return { canceling, cancelInstall }
}
