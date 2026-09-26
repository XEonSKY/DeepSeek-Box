import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { InstalledVersions, PnpmRuntimeStatus, PnpmSource, PnpmStatus } from '@shared/types'
import { withV } from '@shared/version'
import { errorMessage } from '@shared/errors'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import { formatDownload } from '../../lib/format'
import { refreshOperations, useOperation } from '../../shell/progressStore'
import { useInstallCancel } from './useInstallCancel'
import type { SettingsState } from './settingsStore'

/**
 * 「环境」页 · pnpm 来源面板的状态与动作。
 *
 * 与 useNpmEnv 同构（两个标签 = 两个来源；pnpm 没有「本地 Node 自带」这一档）。
 *
 * 为什么放这里而不是插件页：pnpm 就是「环境」的一部分（来源可选、可下载 / 更新、内置的可切换版本），
 * 插件页只回答「装哪些插件」，用哪个 pnpm 属于环境配置。
 */

/** 探测未完成时统一显示省略号，而不是「未检测到」。 */
const PENDING = '…'

export function usePnpmEnv(state: SettingsState) {
    /** pnpm 标签即选项（与 npm 同一套 string 收窄写法）。 */
    const PNPM_SOURCES: readonly string[] = ['bundled', 'system']
    const tab = ref<string>(state.pnpmSource)
    watch(tab, (v) => {
        if (PNPM_SOURCES.includes(v)) state.pnpmSource = v as PnpmSource
    })
    watch(
        () => state.pnpmSource,
        (v) => {
            if (tab.value !== v) tab.value = v
        }
    )

    /** 两个标签的内容同构（当前/最新 + 说明 + 按钮），用一份数据 + v-for 渲染。 */
    const TABS = [
        { key: 'bundled', labelKey: 'sv.env.pnpmBundled', hintKey: 'sv.env.pnpmBundledHint' },
        { key: 'system', labelKey: 'sv.env.pnpmSystem', hintKey: 'sv.env.pnpmSystemHint' }
    ] as const

    const status = ref<PnpmStatus | null>(null)
    const probed = ref(false)
    /** 本模块自己发起的 pnpm 操作在途标记（理由同 useNodeEnv 的 nodeBusy）。 */
    const installing = ref(false)
    const pnpmOp = useOperation('pnpm')
    const busy = computed(() => installing.value || pnpmOp.busy.value)
    const progress = computed(() => pnpmOp.op.value)
    const progressInfo = computed(() =>
        formatDownload(pnpmOp.op.value?.total ?? 0, pnpmOp.op.value?.downloaded ?? 0, pnpmOp.op.value?.speed ?? 0)
    )

    async function loadStatus(): Promise<void> {
        try {
            status.value = await window.api.get('/pnpm/status')
        } catch {
            status.value = null
        } finally {
            probed.value = true
        }
    }

    const versions = ref<string[]>([])
    const versionsLoading = ref(false)
    const includePre = ref(false)
    const selected = ref('')

    async function loadVersions(): Promise<void> {
        if (versionsLoading.value) return
        versionsLoading.value = true
        try {
            versions.value = await window.api.get('/pnpm/versions', { query: { prerelease: includePre.value } })
            if (selected.value && !versions.value.includes(selected.value)) selected.value = ''
        } catch {
            versions.value = []
        } finally {
            versionsLoading.value = false
        }
    }

    watch(includePre, () => void loadVersions())

    const latestText = computed(() => (probed.value ? withV(status.value?.latest) : PENDING))
    const latestUnknown = computed(() => probed.value && !status.value?.latest)

    /** 当前 pnpm 标签对应来源的状态。 */
    const cur = computed<PnpmRuntimeStatus | null>(() => status.value?.[state.pnpmSource] ?? null)

    function versionText(src: PnpmSource): string {
        if (!probed.value) return PENDING
        const s = status.value?.[src]
        if (!s?.present) return tt(src === 'bundled' ? 'sv.env.pnpmNotDownloaded' : 'sv.env.notDetected')
        return withV(s.version)
    }

    /** 该来源是否值得给按钮：还没就绪（未下载 / 未安装）或落后于最新版。 */
    function needsAction(src: PnpmSource): boolean {
        if (!probed.value) return false
        const s = status.value?.[src]
        return !s?.present || s.outdated === true
    }

    function actionLabel(src: PnpmSource): string {
        if (busy.value) return tt('sv.env.pnpmWorking')
        return status.value?.[src]?.present ? tt('sv.env.pnpmUpdate') : tt('sv.env.pnpmDownload')
    }

    /** 两个版本号是否同一个（一个带 v 前缀一个不带时也要能比出来）。 */
    function sameVersion(a: string, b: string | null | undefined): boolean {
        return !!b && withV(a) === withV(b)
    }

    /** a-select 的选项（label 内「（当前）」标注随当前版本重算）。 */
    const versionOptions = computed(() =>
        versions.value.map((v) => ({
            value: v,
            label: sameVersion(v, cur.value?.version) ? v + tt('sv.env.currentSuffix') : v
        }))
    )

    // ---- 已安装版本（只有内置来源是版本化目录）----
    const installed = ref<InstalledVersions>({ installed: [], active: null })
    const switching = ref('')

    async function loadInstalled(): Promise<void> {
        try {
            installed.value = await window.api.get('/versions/:kind', { params: { kind: 'pnpm' } })
        } catch {
            installed.value = { installed: [], active: null }
        }
    }

    /** 切换生效版本只改指针、不重装；切换后刷新列表与状态。 */
    async function switchInstalled(version: string): Promise<void> {
        if (switching.value) return
        switching.value = version
        try {
            const r = await window.api.put('/versions/:kind/active', { params: { kind: 'pnpm' }, body: { version } })
            if (r.ok) {
                ElMessage.success(tt('sv.env.versionSwitched', { version: withV(r.version) }))
                await loadInstalled()
                await loadStatus()
            } else {
                ElMessage.error(r.message || '')
            }
        } catch (err) {
            ElMessage.error(errorMessage(err))
        } finally {
            switching.value = ''
        }
    }

    /** 删除已安装版本；删除前确认，删除生效版本时主进程会自动切到剩余最新版。 */
    async function removeInstalled(version: string): Promise<void> {
        const ok = await confirmDialog({
            title: tt('sv.env.removeVersion'),
            message: tt('sv.env.removeVersionConfirm', { version: withV(version) }),
            confirmText: tt('sv.env.removeVersion'),
            cancelText: tt('msg.cancelBtn'),
            danger: true
        })
        if (!ok) return // 用户取消
        try {
            const r = await window.api.delete('/versions/:kind/:version', { params: { kind: 'pnpm', version } })
            if (r.ok) {
                await loadInstalled()
                await loadStatus()
            } else ElMessage.error(r.message || '')
        } catch (err) {
            ElMessage.error(errorMessage(err))
        }
    }

    /** 下载 / 升级 pnpm：作用于**当前标签**表示的那个来源（内置走下载解压，系统走系统 npm 的全局安装）。 */
    async function install(version?: string): Promise<void> {
        if (installing.value) return
        const source = state.pnpmSource
        installing.value = true
        try {
            const r = await window.api.post('/pnpm/update', { body: version ? { source, version } : { source } })
            // 用户主动取消不算失败，静默返回即可（不弹错误 toast）。
            if (!r.canceled) {
                if (r.ok) ElMessage.success(tt('sv.env.pnpmOk', { version: withV(r.version) }))
                else ElMessage.error(r.message || tt('sv.env.pnpmFail'))
            }
        } catch (err) {
            ElMessage.error(errorMessage(err))
        } finally {
            installing.value = false
            await refreshOperations()
            await loadStatus()
            await loadVersions()
            await loadInstalled()
        }
    }

    const { canceling, cancelInstall } = useInstallCancel()

    // 用 reactive 包一层：嵌套 ref 会被自动解包，模板里写 `pnpm.tab` 而不是 `pnpm.tab.value`。
    return reactive({
        tab,
        TABS,
        status,
        probed,
        busy,
        progress,
        progressInfo,
        versionsLoading,
        includePre,
        selected,
        latestText,
        latestUnknown,
        cur,
        installed,
        switching,
        versionOptions,
        canceling,
        loadStatus,
        loadVersions,
        loadInstalled,
        versionText,
        needsAction,
        actionLabel,
        install,
        switchInstalled,
        removeInstalled,
        cancelInstall,
        sameVersion
    })
}
