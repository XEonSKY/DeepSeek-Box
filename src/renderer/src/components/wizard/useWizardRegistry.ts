import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import type { RegistrySpeedResult } from '@shared/types'

/**
 * 向导 · 镜像源测速（第 1 步）。
 *
 * 只碰「测速结果」与「选中的镜像源」两样状态：`registry` 由调用方传入（同一份 ref 与
 * 安装设置共享），其余全部自持。从 DshWizard.vue 抽出后，测速这块可独立读与改。
 */
export function useWizardRegistry(registry: Ref<'npmjs' | 'npmmirror'>) {
    const testing = ref(false)
    const result = ref<RegistrySpeedResult | null>(null)
    const failed = computed(() => result.value !== null && result.value.fastest === null)

    /**
     * 测速选出最快的镜像源。全部失败时返回 null（调用方保留用户当前设置，不瞎选）。
     * 结果写进 `result` 供界面展示每个源的实测延迟。
     */
    async function pickFastest(): Promise<string | null> {
        testing.value = true
        try {
            const r = await window.api.post('/registries/speed')
            result.value = r
            if (r.fastest) registry.value = r.fastest
            return r.fastest
        } catch {
            // 测速本身失败不该阻断安装：沿用当前设置继续。
            // 但结果要留一个「空的成功结构」而不是 null —— 否则结果框整个消失，
            // 用户既看不到「测速失败」的说明，也不知道为什么源没被自动切换。
            result.value = { samples: [], fastest: null }
            return null
        } finally {
            testing.value = false
        }
    }

    return { testing, result, failed, pickFastest }
}
