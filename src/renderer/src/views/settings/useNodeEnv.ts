import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { InstalledVersions, NodeRuntimeKind, NodeStatus } from '@shared/types'
import { MIN_NODE_MAJOR, nodeMajor, withV } from '@shared/version'
import { errorMessage } from '@shared/errors'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import { formatDownload } from '../../lib/format'
import { refreshOperations, useOperation } from '../../shell/progressStore'
import { useInstallCancel } from './useInstallCancel'
import type { SettingsActions, SettingsState } from './settingsStore'

/**
 * 「环境」页 · Node 运行时面板的状态与动作。
 *
 * 从 EnvPanel.vue 抽出：Node 这一档与 npm / pnpm 两档相互独立（各自的探测、版本列表、
 * 安装按钮、已装列表），拆开后三档互不影响，EnvPanel 只负责拼装模板。
 */

/** 探测未完成时统一显示省略号，而不是「未检测到」。 */
const PENDING = '…'

export function useNodeEnv(state: SettingsState, actions: SettingsActions) {
    /**
     * 标签即设置项。antdv 的 `a-tabs` 用 `v-model:active-key`（activeKey 类型是 string），这里用
     * string 承接，再在 watch 里收窄回 `NodeRuntimeKind`；反向 watch 让外部改动
     * （settings:changed 广播）也能反映到标签上。
     */
    const RUNTIMES: readonly string[] = ['system', 'local']
    const tab = ref<string>(state.nodeRuntime)
    watch(tab, (v) => {
        if (RUNTIMES.includes(v)) state.nodeRuntime = v as NodeRuntimeKind
    })
    watch(
        () => state.nodeRuntime,
        (v) => {
            if (tab.value !== v) tab.value = v
        }
    )

    /** 系统 / 本地部署的实际版本由主进程探测（会跑 `node --version`，并联网取最新 LTS）。 */
    const status = ref<NodeStatus | null>(null)

    /**
     * 探测是否已回来。**必须先区分「还没探测」与「探测到没有」** —— 探测含网络请求（最长 20s），
     * 期间若直接按 `present` 渲染，会先闪一段「未检测到」，看起来像环境缺失。
     */
    const probed = ref(false)

    async function loadStatus(): Promise<void> {
        try {
            status.value = await window.api.get('/node/status')
        } catch {
            status.value = null
        } finally {
            probed.value = true
        }
    }

    const deploying = ref(false)
    /**
     * 进度状态来自**共享 store**（shell/progressStore），不再在组件里订阅 / 存 ref：
     * 切到别的设置子页再切回来时，面板重新挂载会先拉一次快照，正在跑的操作依然可见。
     */
    const nodeOp = useOperation('node')
    const progressInfo = computed(() =>
        formatDownload(nodeOp.op.value?.total ?? 0, nodeOp.op.value?.downloaded ?? 0, nodeOp.op.value?.speed ?? 0)
    )

    /**
     * 本模块自己发起的操作在途标记（按钮 loading 用）。
     *
     * 与 `nodeOp.busy` 的区别：广播**先**到、`await post()` 后**才**返回，且取消时主进程会
     * 立刻清空进度 → `busy` 变假，但发起方还在等返回。所以按钮要「两者取或」，否则取消瞬间按钮会闪回可点。
     * 「离开面板期间由**别处**发起的操作」只有 `busy` 能反映，这就是必须要共享 store 的原因。
     */
    const nodeBusy = computed(() => deploying.value || nodeOp.busy.value)
    const deployPhase = computed(() => nodeOp.op.value?.phase ?? 'download')
    const percent = computed(() => nodeOp.op.value?.percent ?? 0)

    /** 探测未完成时统一显示省略号，而不是「未检测到」。 */
    const systemVersionText = computed(() =>
        probed.value ? (status.value?.system.present ? withV(status.value.system.version) : tt('sv.env.notDetected')) : PENDING
    )
    const localVersionText = computed(() =>
        probed.value ? (status.value?.local.present ? withV(status.value.local.version) : tt('sv.env.notDeployed')) : PENDING
    )
    const latestText = computed(() => (probed.value ? withV(status.value?.latest) : PENDING))
    /** 最新 LTS 取不到（离线/代理不通）→ 用「无法获取」替换各标签的正常说明。 */
    const latestUnknown = computed(() => probed.value && !status.value?.latest)

    /** 本地部署：只有「还没部署」或「落后于最新 LTS」时才给按钮。 */
    const localNeedsAction = computed(
        () => probed.value && (!status.value?.local.present || status.value?.local.outdated === true)
    )

    /**
     * 按钮语义：已部署且探到最新版 → 「更新到 vX」；否则 → 「部署 Node」。
     * 文案本身在模板里用 `$t` 取（`tt()` 写在 computed 里不会随语言切换重算）。
     */
    const deployKind = computed<'deploy' | 'update'>(() =>
        status.value?.local.present && status.value?.latest ? 'update' : 'deploy'
    )

    // ---- 版本选择（下载 / 切换）----
    // 只在本模块内维护：dsh 页的 state.versions 是 dsh 版本，绝不能共用同一个字段。

    /** 可安装的版本列表（默认只 LTS，勾选后含 Current）。主进程侧对发行索引有 10 分钟缓存。 */
    const nodeVersions = ref<string[]>([])
    const versionsLoading = ref(false)
    const includeNonLts = ref(false)
    const selectedVersion = ref('')

    async function loadVersions(): Promise<void> {
        if (versionsLoading.value) return
        versionsLoading.value = true
        try {
            nodeVersions.value = await window.api.get('/node/versions', { query: { includeNonLts: includeNonLts.value } })
            if (selectedVersion.value && !nodeVersions.value.includes(selectedVersion.value)) selectedVersion.value = ''
        } catch {
            nodeVersions.value = []
        } finally {
            versionsLoading.value = false
        }
    }

    // 勾选「包含非 LTS」即重取列表（用 watch 而非 a-checkbox 的 @change，少依赖一个事件签名）。
    watch(includeNonLts, () => void loadVersions())

    /** 已部署的那份 Node —— 列表里的「（当前）」按它标记。 */
    const deployedNode = computed(() => status.value?.local.version ?? null)

    /** 两个版本号是否同一个（一个带 v 前缀一个不带时也要能比出来）。 */
    function sameVersion(a: string, b: string | null | undefined): boolean {
        return !!b && withV(a) === withV(b)
    }

    function versionLabel(v: string): string {
        return sameVersion(v, deployedNode.value) ? v + tt('sv.env.currentSuffix') : v
    }

    /** a-select 的选项（项目约定用 :options）；label 内的「（当前）」标注随已部署版本重算。 */
    const nodeVersionOptions = computed(() => nodeVersions.value.map((v) => ({ value: v, label: versionLabel(v) })))

    /**
     * 选中的版本低于 dsh 要求的最低主版本 —— 装了 dsh 也跑不起来。
     * LTS 列表里仍有 Node 18/16 这种老 LTS，所以这个提示不是多余的。
     */
    const selectedTooOld = computed(() => {
        const major = nodeMajor(selectedVersion.value)
        return major !== null && major < MIN_NODE_MAJOR
    })

    /**
     * 当前选中的运行时是否可用。不可用时**不能应用** —— 应用即重启 dsh，而 dsh 起不来会直接弹错误框，
     * 比拦住更糟。探测还没回来时不拦（`probed` 为假），免得刚进页面按钮就是灰的。
     */
    const runtimeUsable = computed(() => {
        if (!probed.value) return true
        if (state.nodeRuntime === 'system') {
            const s = status.value?.system
            const major = nodeMajor(s?.version)
            return !!s?.present && major !== null && major >= MIN_NODE_MAJOR
        }
        return status.value?.local.present === true
    })

    /**
     * 需要时先确认并停掉 dsh：只有「用本地 Node 跑」时 `<configDir>/node` 才被占用（Windows 上运行中的
     * node.exe 被锁，替换会失败）。'stopped' 表示确实停过，装完要把它重启回来。
     */
    async function stopDshForNode(): Promise<'ok' | 'stopped' | 'cancelled'> {
        if (state.nodeRuntime !== 'local') return 'ok'
        let running: boolean
        try {
            running = await window.api.get('/dsh/running')
        } catch {
            running = false
        }
        if (!running) return 'ok'
        const ok = await confirmDialog({
            title: tt('msg.dshRunningTitle'),
            message: tt('msg.nodeStopText'),
            confirmText: tt('msg.continueBtn'),
            cancelText: tt('msg.cancelBtn'),
            danger: true
        })
        if (!ok) return 'cancelled'
        await actions.stopDsh()
        return 'stopped'
    }

    /**
     * 部署本地 Node：不传版本时是最新 LTS（「更新到 vX」/「部署 Node」那条快按钮）。
     * 多版本并存于 <configDir>/node/<版本>，部署完把生效指针切到该版本；行内切换见 switchInstalled。
     */
    async function installNode(version?: string): Promise<void> {
        if (deploying.value) return
        const stop = await stopDshForNode()
        if (stop === 'cancelled') return
        deploying.value = true
        try {
            const r = await window.api.post('/node/deploy', { body: version ? { version } : {} })
            // 用户主动取消不算失败，静默返回即可（不弹错误 toast）。
            if (!r.canceled) {
                if (r.ok) ElMessage.success(tt('sv.env.deployOk', { version: withV(r.version) }))
                else ElMessage.error(r.message || tt('sv.env.deployFail'))
            }
        } catch (err) {
            ElMessage.error(errorMessage(err))
        } finally {
            deploying.value = false
            await refreshOperations()
            // 先重启 dsh，再刷新状态 —— 否则刚部署的 Node 可能正被 dsh 用着，版本读不准。
            if (stop === 'stopped') await actions.restartDsh()
            await loadStatus()
            await loadVersions()
            await loadInstalled()
        }
    }

    const { canceling, cancelInstall } = useInstallCancel()

    // ---- 已安装版本：多版本并存，列表行内切换 / 删除 ----------------------------

    const installed = ref<InstalledVersions>({ installed: [], active: null })
    const switching = ref('')

    async function loadInstalled(): Promise<void> {
        try {
            installed.value = await window.api.get('/versions/:kind', { params: { kind: 'node' } })
        } catch {
            installed.value = { installed: [], active: null }
        }
    }

    /** 切换生效版本只改指针、不重装；切换后刷新列表与状态。 */
    async function switchInstalled(version: string): Promise<void> {
        if (switching.value) return
        switching.value = version
        try {
            const r = await window.api.put('/versions/:kind/active', { params: { kind: 'node' }, body: { version } })
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
            const r = await window.api.delete('/versions/:kind/:version', { params: { kind: 'node', version } })
            if (r.ok) {
                await loadInstalled()
                await loadStatus()
            } else ElMessage.error(r.message || '')
        } catch (err) {
            ElMessage.error(errorMessage(err))
        }
    }

    /**
     * 系统 Node 是安装包 / winget / nvm / brew 装的，在配置目录之外，应用无法安全地就地升级它，
     * 所以这里只把人送到官方下载页；想由应用代管的可以切到「本地部署」。
     */
    function openNodeDownload(): void {
        void window.api.post('/shell/open-external', { body: { url: 'https://nodejs.org/en/download' } })
    }

    // 用 reactive 包一层：嵌套 ref 会被自动解包，模板里写 `node.tab` 而不是 `node.tab.value`，
    // 同时保持响应性（`reactive` 的解包是双向的）。
    return reactive({
        tab,
        status,
        probed,
        nodeBusy,
        deployPhase,
        percent,
        progressInfo,
        systemVersionText,
        localVersionText,
        latestText,
        latestUnknown,
        localNeedsAction,
        deployKind,
        versionsLoading,
        includeNonLts,
        selectedVersion,
        nodeVersionOptions,
        selectedTooOld,
        runtimeUsable,
        installed,
        switching,
        canceling,
        loadStatus,
        loadVersions,
        loadInstalled,
        installNode,
        switchInstalled,
        removeInstalled,
        openNodeDownload,
        cancelInstall,
        sameVersion
    })
}
