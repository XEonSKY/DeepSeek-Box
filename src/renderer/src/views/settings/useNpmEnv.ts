import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { InstalledVersions, NpmRuntimeStatus, NpmSource, NpmStatus } from '@shared/types'
import { withV } from '@shared/version'
import { errorMessage } from '@shared/errors'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import { formatDownload } from '../../lib/format'
import { refreshOperations, useOperation } from '../../shell/progressStore'
import { useInstallCancel } from './useInstallCancel'
import type { SettingsState } from './settingsStore'

/**
 * 「环境」页 · npm 来源面板的状态与动作。
 *
 * 与 usePnpmEnv 同构（三个标签 = 三个来源，其中只有内置来源有「已安装版本」列表），
 * 从 EnvPanel.vue 抽出后与 pnpm 那档并列。
 */

/** 探测未完成时统一显示省略号，而不是「未检测到」。 */
const PENDING = '…'

export function useNpmEnv(state: SettingsState) {
    /** npm 标签即选项（与 node 标签同一套 string 收窄写法，理由见 useNodeEnv）。 */
    const NPM_SOURCES: readonly string[] = ['bundled', 'system', 'localnode']
    const tab = ref<string>(state.npmSource)
    watch(tab, (v) => {
        if (NPM_SOURCES.includes(v)) state.npmSource = v as NpmSource
    })
    watch(
        () => state.npmSource,
        (v) => {
            if (tab.value !== v) tab.value = v
        }
    )

    /**
     * 三个标签的内容完全同构（当前/最新 + 说明 + 一个按钮），所以用一份数据 + `v-for` 渲染，
     * 不抄三遍；与 node 那三个手写面板的区别在于 node 的三个来源**本身**就不一样
     * （程序内置没有可比较项、系统来源要给外链、本地来源才有版本选择器）。
     */
    const TABS = [
        { key: 'bundled', labelKey: 'sv.env.npmBundled', hintKey: 'sv.env.npmBundledHint' },
        { key: 'system', labelKey: 'sv.env.npmSystem', hintKey: 'sv.env.npmSystemHint' },
        { key: 'localnode', labelKey: 'sv.env.npmLocalNode', hintKey: 'sv.env.npmLocalNodeHint' }
    ] as const

    const status = ref<NpmStatus | null>(null)
    const probed = ref(false)
    /** 本模块自己发起的 npm 操作在途标记（按钮 loading 用，理由同 useNodeEnv 的 nodeBusy）。 */
    const installing = ref(false)
    const npmOp = useOperation('npm')
    const busy = computed(() => installing.value || npmOp.busy.value)
    const progressPhase = computed(() => npmOp.op.value?.phase ?? 'download')
    const progressPercent = computed(() => npmOp.op.value?.percent ?? 0)
    const progressSeen = computed(() => npmOp.op.value !== null)
    const progressInfo = computed(() =>
        formatDownload(npmOp.op.value?.total ?? 0, npmOp.op.value?.downloaded ?? 0, npmOp.op.value?.speed ?? 0)
    )

    async function loadStatus(): Promise<void> {
        try {
            status.value = await window.api.get('/npm/status')
        } catch {
            status.value = null
        } finally {
            probed.value = true
        }
    }

    /** 可安装的 npm 版本（来自当前 registry；主进程侧缓存 10 分钟）。 */
    const versions = ref<string[]>([])
    const versionsLoading = ref(false)
    const includePre = ref(false)
    const selected = ref('')

    async function loadVersions(): Promise<void> {
        if (versionsLoading.value) return
        versionsLoading.value = true
        try {
            versions.value = await window.api.get('/npm/versions', { query: { prerelease: includePre.value } })
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

    /** 当前 npm 标签对应来源的状态。 */
    const cur = computed<NpmRuntimeStatus | null>(() => status.value?.[state.npmSource] ?? null)

    function versionText(src: NpmSource): string {
        if (!probed.value) return PENDING
        const s = status.value?.[src]
        if (!s?.present) return tt(src === 'bundled' ? 'sv.env.npmNotDownloaded' : 'sv.env.notDetected')
        return withV(s.version)
    }

    /** 该来源是否值得给按钮：还没就绪（未下载 / 未安装）或落后于最新版。 */
    function needsAction(src: NpmSource): boolean {
        if (!probed.value) return false
        const s = status.value?.[src]
        return !s?.present || s.outdated === true
    }

    function actionLabel(src: NpmSource): string {
        if (busy.value) return tt('sv.env.npmWorking')
        return status.value?.[src]?.present ? tt('sv.env.npmUpdate') : tt('sv.env.npmDownload')
    }

    /** 两个版本号是否同一个（一个带 v 前缀一个不带时也要能比出来）。 */
    function sameVersion(a: string, b: string | null | undefined): boolean {
        return !!b && withV(a) === withV(b)
    }

    /** a-select 的选项（项目约定用 :options）；label 内的「（当前）」标注随当前 npm 版本重算。 */
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
            installed.value = await window.api.get('/versions/:kind', { params: { kind: 'npm' } })
        } catch {
            installed.value = { installed: [], active: null }
        }
    }

    /** 切换生效版本只改指针、不重装；切换后刷新列表与状态。 */
    async function switchInstalled(version: string): Promise<void> {
        if (switching.value) return
        switching.value = version
        try {
            const r = await window.api.put('/versions/:kind/active', { params: { kind: 'npm' }, body: { version } })
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
            const r = await window.api.delete('/versions/:kind/:version', { params: { kind: 'npm', version } })
            if (r.ok) {
                await loadInstalled()
                await loadStatus()
            } else ElMessage.error(r.message || '')
        } catch (err) {
            ElMessage.error(errorMessage(err))
        }
    }

    /** 下载 / 切换 npm 版本：作用于**当前标签**表示的那个来源（三个来源的安装机制见 npmRunner.updateNpm）。 */
    async function install(version?: string): Promise<void> {
        if (installing.value) return
        const source = state.npmSource
        installing.value = true
        try {
            const r = await window.api.post('/npm/update', { body: version ? { source, version } : { source } })
            // 用户主动取消不算失败，静默返回即可（不弹错误 toast）。
            if (!r.canceled) {
                if (r.ok) ElMessage.success(tt('sv.env.npmOk', { version: withV(r.version) }))
                else ElMessage.error(r.message || tt('sv.env.npmFail'))
            }
        } catch (err) {
            ElMessage.error(errorMessage(err))
        } finally {
            installing.value = false
            // 操作已结束：把主进程的快照重新取一次，进度条才会收起来（事件流不含结束信号）。
            await refreshOperations()
            await loadStatus()
            await loadVersions()
            await loadInstalled()
        }
    }

    const { canceling, cancelInstall } = useInstallCancel()

    // 用 reactive 包一层：嵌套 ref 会被自动解包，模板里写 `npm.tab` 而不是 `npm.tab.value`。
    return reactive({
        tab,
        TABS,
        status,
        probed,
        busy,
        progressPhase,
        progressPercent,
        progressSeen,
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
