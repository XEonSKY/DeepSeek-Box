import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage } from '@shared/errors'
import { formatDownload } from '../../lib/format'
import { refreshOperations, useOperation } from '../../shell/progressStore'

/**
 * 向导 · 「程序内置」npm 环境（第 3 步）。
 *
 * 负责：可下载版本列表、是否已缓存、以及「未缓存则先下载再继续」的 ensure 流程。
 * 从 DshWizard.vue 抽出；`canceling` 与调用方共用（同一批安装动作共用一个取消按钮）。
 */
export function useWizardNpm(canceling: Ref<boolean>) {
    /** 是否已缓存内置 npm（决定第 3 步是否需要先下载）。 */
    const bundledPresent = ref(false)
    /** 本向导自己发起的 npm 准备在途标记。 */
    const preparing = ref(false)

    const { op } = useOperation('npm')
    const extracting = computed(() => op.value?.phase === 'extract')
    const percent = computed(() => op.value?.percent ?? 0)
    const info = computed(() => formatDownload(op.value?.total ?? 0, op.value?.downloaded ?? 0, op.value?.speed ?? 0))

    const versions = ref<string[]>([])
    const versionsLoading = ref(false)
    const includePre = ref(false)
    const version = ref('')
    const versionOptions = computed(() => versions.value.map((v) => ({ value: v, label: v })))

    /** 拉取可下载的 npm 版本（新 → 旧）；是否含预发布由开关决定，默认选中最新一项。 */
    async function loadVersions(): Promise<void> {
        if (versionsLoading.value) return
        versionsLoading.value = true
        try {
            const list = await window.api.get('/npm/versions', { query: { prerelease: includePre.value } })
            versions.value = list
            if (!list.includes(version.value)) version.value = list[0] ?? ''
        } catch {
            versions.value = []
        } finally {
            versionsLoading.value = false
        }
    }

    /** 探测「程序内置」npm 是否已缓存：决定第 3 步是否需要先下载。 */
    async function loadStatus(): Promise<void> {
        try {
            bundledPresent.value = (await window.api.get('/npm/status')).bundled.present
        } catch {
            bundledPresent.value = false
        }
    }

    /** 确保「程序内置」npm 就绪：已缓存直接通过，未缓存 / 指定版本则先下载（带进度）再进入下一步。 */
    async function ensure(v?: string): Promise<boolean> {
        canceling.value = false
        preparing.value = true
        try {
            const r = await window.api.post('/npm/ensure', { body: v ? { version: v } : {} })
            if (r.canceled) {
                // 用户主动取消：不算失败，也不弹错误提示。
                ElMessage.info(r.message || '')
                return false
            }
            if (r.ok) {
                bundledPresent.value = true
                return true
            }
            ElMessage.error(r.message)
            return false
        } catch (err) {
            ElMessage.error(errorMessage(err))
            return false
        } finally {
            preparing.value = false
            canceling.value = false
            await refreshOperations()
        }
    }

    return {
        bundledPresent,
        preparing,
        extracting,
        percent,
        info,
        versions,
        versionsLoading,
        includePre,
        version,
        versionOptions,
        loadVersions,
        loadStatus,
        ensure
    }
}
