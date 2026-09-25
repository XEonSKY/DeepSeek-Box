<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { AppstoreOutlined, CodeFilled, DeploymentUnitOutlined, DownloadOutlined, LinkOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type {
    InstallKind,
    InstalledVersions,
    NodeRuntimeKind,
    NodeStatus,
    NpmRuntimeStatus,
    NpmSource,
    NpmStatus,
    PnpmRuntimeStatus,
    PnpmSource,
    PnpmStatus
} from '@shared/types'
import { MIN_NODE_MAJOR, nodeMajor, withV } from '@shared/version'
import { errorMessage } from '@shared/errors'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import TagLabel from '../../components/TagLabel.vue'
import { formatDownload } from '../../lib/format'
import { useSettingsStore } from './useSettingsStore'
import { useInstallCancel } from './useInstallCancel'
import { refreshOperations, useOperation } from '../../shell/progressStore'

/**
 * 「环境」页：Node 运行时（系统自带 / 本地部署）与各自的版本情况。
 *
 * 结构：一个 Collapse 面板（与其它设置页一致的折叠卡片）→ 里面两个标签，
 * **标签本身就是选项** —— 点「系统自带」即把 `nodeRuntime` 切成 system（原来的下拉框已去掉）。
 * 默认是「本地部署」（按当前架构下载最新 LTS 到配置目录）。
 *
 * 数据来自 `window.api.get('/node/status')`：系统 / 本地部署 Node 的当前版本 + 最新 LTS 及「是否落后」。
 * ⚠️ 它**会联网**取 nodejs.org/dist/index.json（主进程侧有 10 分钟缓存），所以只在进入本页时调一次。
 */

const { state, actions } = useSettingsStore()

const open = ref<string[]>(['env-node', 'env-npm', 'env-pnpm'])

/** 折叠面板：antdv 的 activeKey 不通过 v-model 更新，用 @change 同步（见 SystemPanel）。 */
function onOpenChange(keys: string[]): void {
    open.value = keys
}

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
 * 进度状态来自**共享 store**（shell/progressStore），不再在本组件里订阅 / 存 ref：
 * 切到别的设置子页再切回来时，面板重新挂载会先拉一次快照，正在跑的操作依然可见。
 */
const nodeOp = useOperation('node')
const progressInfo = computed(() =>
    formatDownload(nodeOp.op.value?.total ?? 0, nodeOp.op.value?.downloaded ?? 0, nodeOp.op.value?.speed ?? 0)
)

/**
 * 本组件自己发起的操作在途标记（按钮 loading 用）。
 *
 * 与 `nodeOp.busy` 的区别：广播**先**到、`await post()` 后**才**返回，且取消时主进程会
 * 立刻清空进度 → `busy` 变假，但发起方还在等返回。所以按钮要「两者取或」，否则取消瞬间按钮会闪回可点。
 * 「离开面板期间由**别处**发起的操作」只有 `busy` 能反映，这就是必须要共享 store 的原因。
 */
const nodeBusy = computed(() => deploying.value || nodeOp.busy.value)
const deployPhase = computed(() => nodeOp.op.value?.phase ?? 'download')
const percent = computed(() => nodeOp.op.value?.percent ?? 0)

/** 内置 npm 的进度（非 bundled 来源不上报，所以「有没有 op」即是否已见进度）。 */
const npmOp = useOperation('npm')
const npmPhase = computed(() => npmOp.op.value?.phase ?? 'download')
const npmPercent = computed(() => npmOp.op.value?.percent ?? 0)
const npmProgressSeen = computed(() => npmOp.op.value !== null)
const npmProgressInfo = computed(() =>
    formatDownload(npmOp.op.value?.total ?? 0, npmOp.op.value?.downloaded ?? 0, npmOp.op.value?.speed ?? 0)
)

/** 内置 pnpm 的进度（与 npm 同构）。 */
const pnpmOp = useOperation('pnpm')
const pnpmProgressInfo = computed(() =>
    formatDownload(pnpmOp.op.value?.total ?? 0, pnpmOp.op.value?.downloaded ?? 0, pnpmOp.op.value?.speed ?? 0)
)

onMounted(() => {
    // 先补一次快照：离开本页期间由别处（初始化向导 / 插件页）发起的操作也应当出现在这里。
    void refreshOperations()
    void loadStatus()
    void loadVersions()
    void loadNpmStatus()
    void loadNpmVersions()
    void loadPnpmStatus()
    void loadPnpmVersions()
    void loadInstalledNode()
    void loadInstalledNpm()
    void loadInstalledPnpm()
})

/** 探测未完成时统一显示省略号，而不是「未检测到」。 */
const PENDING = '…'

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
// 只在本组件内维护：dsh 页的 state.versions 是 dsh 版本，绝不能共用同一个字段。

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
        await loadInstalledNode()
    }
}

const { canceling, cancelInstall } = useInstallCancel()

// ---- 已安装版本：多版本并存，列表行内切换 / 删除 ----------------------------

const installedNode = ref<InstalledVersions>({ installed: [], active: null })
const installedNpm = ref<InstalledVersions>({ installed: [], active: null })
const switchingNode = ref('')
const switchingNpm = ref('')

async function loadInstalledNode(): Promise<void> {
    try {
        installedNode.value = await window.api.get('/versions/:kind', { params: { kind: 'node' } })
    } catch {
        installedNode.value = { installed: [], active: null }
    }
}

async function loadInstalledNpm(): Promise<void> {
    try {
        installedNpm.value = await window.api.get('/versions/:kind', { params: { kind: 'npm' } })
    } catch {
        installedNpm.value = { installed: [], active: null }
    }
}

/** 切换 / 删除生效版本后要刷新什么：按工具分派（pnpm 与 npm 同构，node 另有部署状态）。 */
async function reloadKind(kind: InstallKind): Promise<void> {
    if (kind === 'node') {
        await loadInstalledNode()
        await loadStatus()
        return
    }
    if (kind === 'npm') {
        await loadInstalledNpm()
        await loadNpmStatus()
        return
    }
    await loadInstalledPnpm()
    await loadPnpmStatus()
}

/** 切换生效版本只改指针、不重装；切换后刷新列表与状态。 */
async function switchInstalled(kind: InstallKind, version: string): Promise<void> {
    const switching = kind === 'node' ? switchingNode : kind === 'npm' ? switchingNpm : switchingPnpm
    if (switching.value) return
    switching.value = version
    try {
        const r = await window.api.put('/versions/:kind/active', { params: { kind }, body: { version } })
        if (r.ok) {
            ElMessage.success(tt('sv.env.versionSwitched', { version: withV(r.version) }))
            await reloadKind(kind)
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
async function removeInstalled(kind: InstallKind, version: string): Promise<void> {
    const ok = await confirmDialog({
        title: tt('sv.env.removeVersion'),
        message: tt('sv.env.removeVersionConfirm', { version: withV(version) }),
        confirmText: tt('sv.env.removeVersion'),
        cancelText: tt('msg.cancelBtn'),
        danger: true
    })
    if (!ok) return // 用户取消
    try {
        const r = await window.api.delete('/versions/:kind/:version', { params: { kind, version } })
        if (r.ok) await reloadKind(kind)
        else ElMessage.error(r.message || '')
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

// ---- npm 来源（与上面 node 面板同构：三个标签即三个来源）----------------------

const npmStatus = ref<NpmStatus | null>(null)
const npmProbed = ref(false)
/** 本组件自己发起的 npm 操作在途标记（按钮 loading 用，理由同 nodeBusy）。 */
const npmInstalling = ref(false)
const npmBusy = computed(() => npmInstalling.value || npmOp.busy.value)

async function loadNpmStatus(): Promise<void> {
    try {
        npmStatus.value = await window.api.get('/npm/status')
    } catch {
        npmStatus.value = null
    } finally {
        npmProbed.value = true
    }
}

/** npm 标签即选项（与 node 标签同一套 string 收窄写法，理由见上）。 */
const NPM_SOURCES: readonly string[] = ['bundled', 'system', 'localnode']
const npmTab = ref<string>(state.npmSource)
watch(npmTab, (v) => {
    if (NPM_SOURCES.includes(v)) state.npmSource = v as NpmSource
})
watch(
    () => state.npmSource,
    (v) => {
        if (npmTab.value !== v) npmTab.value = v
    }
)

/**
 * 三个标签的内容完全同构（当前/最新 + 说明 + 一个按钮），所以用一份数据 + `v-for` 渲染，
 * 不抄三遍；与 node 那三个手写面板的区别在于 node 的三个来源**本身**就不一样
 * （程序内置没有可比较项、系统来源要给外链、本地来源才有版本选择器）。
 */
const NPM_TABS = [
    { key: 'bundled', labelKey: 'sv.env.npmBundled', hintKey: 'sv.env.npmBundledHint' },
    { key: 'system', labelKey: 'sv.env.npmSystem', hintKey: 'sv.env.npmSystemHint' },
    { key: 'localnode', labelKey: 'sv.env.npmLocalNode', hintKey: 'sv.env.npmLocalNodeHint' }
] as const

/** 可安装的 npm 版本（来自当前 registry；主进程侧缓存 10 分钟）。 */
const npmVersions = ref<string[]>([])
const npmVersionsLoading = ref(false)
const npmIncludePre = ref(false)
const npmSelected = ref('')

async function loadNpmVersions(): Promise<void> {
    if (npmVersionsLoading.value) return
    npmVersionsLoading.value = true
    try {
        npmVersions.value = await window.api.get('/npm/versions', { query: { prerelease: npmIncludePre.value } })
        if (npmSelected.value && !npmVersions.value.includes(npmSelected.value)) npmSelected.value = ''
    } catch {
        npmVersions.value = []
    } finally {
        npmVersionsLoading.value = false
    }
}

watch(npmIncludePre, () => void loadNpmVersions())

const npmLatestText = computed(() => (npmProbed.value ? withV(npmStatus.value?.latest) : PENDING))
const npmLatestUnknown = computed(() => npmProbed.value && !npmStatus.value?.latest)

/** 当前 npm 标签对应来源的状态。 */
const npmCur = computed<NpmRuntimeStatus | null>(() => npmStatus.value?.[state.npmSource] ?? null)

function npmVersionText(src: NpmSource): string {
    if (!npmProbed.value) return PENDING
    const s = npmStatus.value?.[src]
    if (!s?.present) return tt(src === 'bundled' ? 'sv.env.npmNotDownloaded' : 'sv.env.notDetected')
    return withV(s.version)
}

/** 该来源是否值得给按钮：还没就绪（未下载 / 未安装）或落后于最新版。 */
function npmNeedsAction(src: NpmSource): boolean {
    if (!npmProbed.value) return false
    const s = npmStatus.value?.[src]
    return !s?.present || s.outdated === true
}

function npmActionLabel(src: NpmSource): string {
    if (npmBusy.value) return tt('sv.env.npmWorking')
    return npmStatus.value?.[src]?.present ? tt('sv.env.npmUpdate') : tt('sv.env.npmDownload')
}

function npmVersionLabel(v: string): string {
    return sameVersion(v, npmCur.value?.version) ? v + tt('sv.env.currentSuffix') : v
}

/** a-select 的选项（项目约定用 :options）；label 内的「（当前）」标注随当前 npm 版本重算。 */
const npmVersionOptions = computed(() => npmVersions.value.map((v) => ({ value: v, label: npmVersionLabel(v) })))

/** 下载 / 切换 npm 版本：作用于**当前标签**表示的那个来源（三个来源的安装机制见 npmRunner.updateNpm）。 */
async function installNpm(version?: string): Promise<void> {
    if (npmInstalling.value) return
    const source = state.npmSource
    npmInstalling.value = true
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
        npmInstalling.value = false
        // 操作已结束：把主进程的快照重新取一次，进度条才会收起来（事件流不含结束信号）。
        await refreshOperations()
        await loadNpmStatus()
        await loadNpmVersions()
        await loadInstalledNpm()
    }
}

// ---- pnpm 来源（与 npm 同构：两个标签 = 两个来源；pnpm 没有「本地 Node 自带」这一档）----
//
// 为什么放这里而不是插件页：pnpm 就是「环境」的一部分（来源可选、可下载 / 更新、内置的可切换版本），
// 插件页只回答「装哪些插件」，用哪个 pnpm 属于环境配置。

const pnpmStatus = ref<PnpmStatus | null>(null)
const pnpmProbed = ref(false)

async function loadPnpmStatus(): Promise<void> {
    try {
        pnpmStatus.value = await window.api.get('/pnpm/status')
    } catch {
        pnpmStatus.value = null
    } finally {
        pnpmProbed.value = true
    }
}

/** pnpm 标签即选项（与 npm 同一套 string 收窄写法）。 */
const PNPM_SOURCES: readonly string[] = ['bundled', 'system']
const pnpmTab = ref<string>(state.pnpmSource)
watch(pnpmTab, (v) => {
    if (PNPM_SOURCES.includes(v)) state.pnpmSource = v as PnpmSource
})
watch(
    () => state.pnpmSource,
    (v) => {
        if (pnpmTab.value !== v) pnpmTab.value = v
    }
)

/** 两个标签的内容同构（当前/最新 + 说明 + 按钮），用一份数据 + v-for 渲染。 */
const PNPM_TABS = [
    { key: 'bundled', labelKey: 'sv.env.pnpmBundled', hintKey: 'sv.env.pnpmBundledHint' },
    { key: 'system', labelKey: 'sv.env.pnpmSystem', hintKey: 'sv.env.pnpmSystemHint' }
] as const

const pnpmVersions = ref<string[]>([])
const pnpmVersionsLoading = ref(false)
const pnpmIncludePre = ref(false)
const pnpmSelected = ref('')
/** 本组件自己发起的 pnpm 操作在途标记（理由同 nodeBusy）。 */
const pnpmInstalling = ref(false)
const pnpmBusy = computed(() => pnpmInstalling.value || pnpmOp.busy.value)

async function loadPnpmVersions(): Promise<void> {
    if (pnpmVersionsLoading.value) return
    pnpmVersionsLoading.value = true
    try {
        pnpmVersions.value = await window.api.get('/pnpm/versions', { query: { prerelease: pnpmIncludePre.value } })
        if (pnpmSelected.value && !pnpmVersions.value.includes(pnpmSelected.value)) pnpmSelected.value = ''
    } catch {
        pnpmVersions.value = []
    } finally {
        pnpmVersionsLoading.value = false
    }
}

watch(pnpmIncludePre, () => void loadPnpmVersions())

const installedPnpm = ref<InstalledVersions>({ installed: [], active: null })
const switchingPnpm = ref('')

async function loadInstalledPnpm(): Promise<void> {
    try {
        installedPnpm.value = await window.api.get('/versions/:kind', { params: { kind: 'pnpm' } })
    } catch {
        installedPnpm.value = { installed: [], active: null }
    }
}

const pnpmLatestText = computed(() => (pnpmProbed.value ? withV(pnpmStatus.value?.latest) : PENDING))
const pnpmLatestUnknown = computed(() => pnpmProbed.value && !pnpmStatus.value?.latest)

/** 当前 pnpm 标签对应来源的状态。 */
const pnpmCur = computed<PnpmRuntimeStatus | null>(() => pnpmStatus.value?.[state.pnpmSource] ?? null)

function pnpmVersionText(src: PnpmSource): string {
    if (!pnpmProbed.value) return PENDING
    const s = pnpmStatus.value?.[src]
    if (!s?.present) return tt(src === 'bundled' ? 'sv.env.pnpmNotDownloaded' : 'sv.env.notDetected')
    return withV(s.version)
}

/** 该来源是否值得给按钮：还没就绪（未下载 / 未安装）或落后于最新版。 */
function pnpmNeedsAction(src: PnpmSource): boolean {
    if (!pnpmProbed.value) return false
    const s = pnpmStatus.value?.[src]
    return !s?.present || s.outdated === true
}

function pnpmActionLabel(src: PnpmSource): string {
    if (pnpmBusy.value) return tt('sv.env.pnpmWorking')
    return pnpmStatus.value?.[src]?.present ? tt('sv.env.pnpmUpdate') : tt('sv.env.pnpmDownload')
}

/** a-select 的选项（label 内「（当前）」标注随当前版本重算）。 */
const pnpmVersionOptions = computed(() =>
    pnpmVersions.value.map((v) => ({
        value: v,
        label: sameVersion(v, pnpmCur.value?.version) ? v + tt('sv.env.currentSuffix') : v
    }))
)

/** 下载 / 升级 pnpm：作用于**当前标签**表示的那个来源（内置走下载解压，系统走系统 npm 的全局安装）。 */
async function installPnpm(version?: string): Promise<void> {
    if (pnpmInstalling.value) return
    const source = state.pnpmSource
    pnpmInstalling.value = true
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
        pnpmInstalling.value = false
        await refreshOperations()
        await loadPnpmStatus()
        await loadPnpmVersions()
        await loadInstalledPnpm()
    }
}
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><DeploymentUnitOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.env') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.env') }}</div>
            </div>
        </div>

        <a-collapse :active-key="open" @change="onOpenChange">
            <a-collapse-panel key="env-node">
                <template #header>
                    <div class="sec__title"><DeploymentUnitOutlined /> {{ $t('sv.env.nodeRuntime') }}</div>
                </template>

                <a-tabs v-model:active-key="tab">
                    <!-- 系统自带：只比较版本，升级动作交给用户 -->
                    <a-tab-pane :tab="$t('sv.env.nodeSystem')" key="system">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ systemVersionText }}</code>
                            <a-tag v-if="probed && status?.system.outdated" color="orange">
                                {{ $t('sv.env.outdated') }}
                            </a-tag>
                            <a-tag v-else-if="probed && status?.system.present" color="green">
                                {{ $t('sv.env.upToDate') }}
                            </a-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestLts') }}</span>
                            <code class="kv__v">{{ latestText }}</code>
                        </div>

                        <div class="hint">
                            {{ latestUnknown ? $t('sv.env.latestUnknown') : $t('sv.env.systemUpdateHint') }}
                        </div>

                        <div v-if="probed && status?.system.outdated" class="act">
                            <a-button :icon="LinkOutlined" @click="openNodeDownload">
                                {{ $t('sv.env.systemUpdate') }}
                            </a-button>
                        </div>
                    </a-tab-pane>

                    <!-- 本地部署：由应用代管，可直接下载 / 更新 -->
                    <a-tab-pane :tab="$t('sv.env.nodeLocal')" key="local">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ localVersionText }}</code>
                            <a-tag v-if="probed && status?.local.outdated" color="orange">
                                {{ $t('sv.env.outdated') }}
                            </a-tag>
                            <a-tag v-else-if="probed && status?.local.present" color="green">
                                {{ $t('sv.env.upToDate') }}
                            </a-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestLts') }}</span>
                            <code class="kv__v">{{ latestText }}</code>
                        </div>

                        <div class="hint">
                            {{ latestUnknown ? $t('sv.env.latestUnknown') : $t('sv.env.localHint') }}
                        </div>

                        <a-progress
                            v-if="nodeBusy"
                            :percent="deployPhase === 'extract' ? 100 : percent"
                            :status="deployPhase === 'extract' ? 'active' : 'normal'"
                            :show-info="deployPhase !== 'extract'"
                            :stroke-width="6"
                            class="dep-progress"
                        />
                        <div v-if="nodeBusy" class="hint dep-info">
                            {{ deployPhase === 'extract' ? $t('sv.env.extracting') : progressInfo }}
                        </div>

                        <div v-if="nodeBusy" class="act">
                            <a-button :loading="canceling" @click="cancelInstall()">
                                {{ canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                            </a-button>
                        </div>

                        <div v-if="localNeedsAction" class="act">
                            <a-button type="primary" :icon="DownloadOutlined" :loading="nodeBusy" @click="installNode()">
                                {{
                                    nodeBusy
                                        ? $t('sv.env.deploying')
                                        : deployKind === 'update'
                                            ? $t('sv.env.localUpdate', { version: latestText })
                                            : $t('sv.env.localDeploy')
                                }}
                            </a-button>
                        </div>

                        <!-- 下载 / 切换任意版本：与 dsh 页的「版本管理」同一套交互与样式 -->
                        <div class="upd-sep" />
                        <a-form layout="vertical" class="vm-in">
                            <a-form-item :label="$t('sv.env.selectVersion')">
                                <div class="vm-row">
                                    <a-select
                                        v-model:value="selectedVersion"
                                        :options="nodeVersionOptions"
                                        show-search
                                        :placeholder="$t('sv.env.selectPlaceholder')"
                                        class="vm-sel"
                                        :disabled="versionsLoading || nodeBusy"
                                    />
                                    <a-button :icon="ReloadOutlined" :loading="versionsLoading" @click="loadVersions()">
                                        {{ $t('sv.env.refresh') }}
                                    </a-button>
                                    <a-button
                                        type="primary"
                                        :icon="DownloadOutlined"
                                        :loading="nodeBusy"
                                        :disabled="nodeBusy || versionsLoading || !selectedVersion || sameVersion(selectedVersion, deployedNode)"
                                        @click="installNode(selectedVersion)"
                                    >
                                        {{ $t('sv.env.installVersion') }}
                                    </a-button>
                                </div>
                                <a-checkbox v-model:checked="includeNonLts"><TagLabel :label="$t('sv.env.includeNonLts')" /></a-checkbox>
                                <div v-if="selectedTooOld" class="warn">
                                    {{ $t('sv.env.tooOld', { major: MIN_NODE_MAJOR }) }}
                                </div>
                                <div class="hint">{{ $t('sv.env.versionListHint') }}</div>
                            </a-form-item>
                        </a-form>

                        <div class="upd-sep" />
                        <div class="iv">
                            <div class="iv__title">{{ $t('sv.env.installedVersions') }}</div>
                            <div v-if="!installedNode.installed.length" class="hint">{{ $t('sv.env.installedNone') }}</div>
                            <div v-else class="iv__list">
                                <div class="iv__thead">
                                    <span class="iv__c1">{{ $t('sv.env.colVersion') }}</span>
                                    <span class="iv__c2">{{ $t('sv.env.colStatus') }}</span>
                                    <span class="iv__c3">{{ $t('sv.env.colActions') }}</span>
                                </div>
                                <div class="iv__tbody">
                                    <div v-for="v in installedNode.installed" :key="v" class="iv__row">
                                        <span class="iv__c1"><code class="iv__ver">{{ withV(v) }}</code></span>
                                        <span class="iv__c2">
                                            <a-tag v-if="v === installedNode.active" color="green">
                                                {{ $t('sv.env.activeVersion') }}
                                            </a-tag>
                                            <span v-else class="iv__dash">—</span>
                                        </span>
                                        <span class="iv__c3">
                                            <a-button v-if="v !== installedNode.active" :loading="switchingNode === v" @click="switchInstalled('node', v)">
                                                {{ $t('sv.env.switchVersion') }}
                                            </a-button>
                                            <a-button danger @click="removeInstalled('node', v)">
                                                {{ $t('sv.env.removeVersion') }}
                                            </a-button>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </a-tab-pane>
                </a-tabs>

                <div class="hint">{{ $t('sv.env.nodeRuntimeHint') }}</div>

                <div class="apply-sec">
                    <div class="apply-row">
                        <div class="apply__txt">
                            {{ $t('sv.env.applyTxt') }}
                            <div v-if="!runtimeUsable" class="warn">
                                {{ $t('sv.env.runtimeUnusable', { major: MIN_NODE_MAJOR }) }}
                            </div>
                        </div>
                        <a-button type="primary" :loading="state.applying" :disabled="!runtimeUsable" @click="actions.apply()">
                            {{ $t('sv.env.applyBtn') }}
                        </a-button>
                    </div>
                </div>
            </a-collapse-panel>

            <!-- npm 来源：与 node 同构（折叠卡片 → 三个标签 = 三个来源） -->
            <a-collapse-panel key="env-npm">
                <template #header>
                    <div class="sec__title"><AppstoreOutlined /> {{ $t('sv.env.npmSource') }}</div>
                </template>

                <div v-if="state.dshSource === 'global'" class="hint">{{ $t('sv.env.npmGlobalNote') }}</div>

                <a-tabs v-model:active-key="npmTab">
                    <a-tab-pane v-for="t in NPM_TABS" :key="t.key" :tab="$t(t.labelKey)">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ npmVersionText(t.key) }}</code>
                            <a-tag v-if="npmProbed && npmStatus?.[t.key]?.outdated" color="orange">
                                {{ $t('sv.env.outdated') }}
                            </a-tag>
                            <a-tag v-else-if="npmProbed && npmStatus?.[t.key]?.present" color="green">
                                {{ $t('sv.env.upToDate') }}
                            </a-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestVersion') }}</span>
                            <code class="kv__v">{{ npmLatestText }}</code>
                        </div>

                        <div class="hint">{{ npmLatestUnknown ? $t('sv.env.latestUnknown') : $t(t.hintKey) }}</div>

                        <div v-if="npmNeedsAction(t.key)" class="act">
                            <a-button
                                type="primary"
                                :icon="DownloadOutlined"
                                :loading="npmBusy"
                                @click="installNpm()"
                            >
                                {{ npmActionLabel(t.key) }}
                            </a-button>
                        </div>

                        <div v-if="t.key === 'bundled'" class="iv">
                            <div class="iv__title">{{ $t('sv.env.installedVersions') }}</div>
                            <div v-if="!installedNpm.installed.length" class="hint">{{ $t('sv.env.installedNone') }}</div>
                            <div v-else class="iv__list">
                                <div class="iv__thead">
                                    <span class="iv__c1">{{ $t('sv.env.colVersion') }}</span>
                                    <span class="iv__c2">{{ $t('sv.env.colStatus') }}</span>
                                    <span class="iv__c3">{{ $t('sv.env.colActions') }}</span>
                                </div>
                                <div class="iv__tbody">
                                    <div v-for="v in installedNpm.installed" :key="v" class="iv__row">
                                        <span class="iv__c1"><code class="iv__ver">{{ withV(v) }}</code></span>
                                        <span class="iv__c2">
                                            <a-tag v-if="v === installedNpm.active" color="green">
                                                {{ $t('sv.env.activeVersion') }}
                                            </a-tag>
                                            <span v-else class="iv__dash">—</span>
                                        </span>
                                        <span class="iv__c3">
                                            <a-button v-if="v !== installedNpm.active" :loading="switchingNpm === v" @click="switchInstalled('npm', v)">
                                                {{ $t('sv.env.switchVersion') }}
                                            </a-button>
                                            <a-button danger @click="removeInstalled('npm', v)">
                                                {{ $t('sv.env.removeVersion') }}
                                            </a-button>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </a-tab-pane>
                </a-tabs>

                <div v-if="npmBusy" class="act">
                    <a-progress
                        v-if="npmProgressSeen"
                        :percent="npmPhase === 'extract' ? 100 : npmPercent"
                        :status="npmPhase === 'extract' ? 'active' : 'normal'"
                        :show-info="npmPhase !== 'extract'"
                        :stroke-width="6"
                        class="dep-progress"
                    />
                    <div v-if="npmProgressSeen" class="hint dep-info">
                        {{ npmPhase === 'extract' ? $t('sv.env.extracting') : npmProgressInfo }}
                    </div>
                    <a-button :loading="canceling" @click="cancelInstall()">
                        {{ canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                    </a-button>
                </div>

                <!-- 版本选择器放在标签之外共用：三个来源都能装任意版本，抄三遍纯属重复 -->
                <div class="upd-sep" />
                <a-form layout="vertical" class="vm-in">
                    <a-form-item :label="$t('sv.env.selectVersion')">
                        <div class="vm-row">
                            <a-select
                                v-model:value="npmSelected"
                                :options="npmVersionOptions"
                                show-search
                                :placeholder="$t('sv.env.selectPlaceholder')"
                                class="vm-sel"
                                :disabled="npmVersionsLoading || npmBusy"
                            />
                            <a-button :icon="ReloadOutlined" :loading="npmVersionsLoading" @click="loadNpmVersions()">
                                {{ $t('sv.env.refresh') }}
                            </a-button>
                            <a-button
                                type="primary"
                                :icon="DownloadOutlined"
                                :loading="npmBusy"
                                :disabled="npmBusy || npmVersionsLoading || !npmSelected || sameVersion(npmSelected, npmCur?.version)"
                                @click="installNpm(npmSelected)"
                            >
                                {{ $t('sv.env.installVersion') }}
                            </a-button>
                        </div>
                        <a-checkbox v-model:checked="npmIncludePre">{{ $t('sv.env.includePrerelease') }}</a-checkbox>
                        <div class="hint">{{ $t('sv.env.npmListHint') }}</div>
                    </a-form-item>
                </a-form>
                <div class="hint">{{ $t('sv.env.npmNoRestart') }}</div>
            </a-collapse-panel>

            <!-- pnpm 来源：与 npm 同构（折叠卡片 → 两个标签 = 两个来源；pnpm 没有「本地 Node 自带」档） -->
            <a-collapse-panel key="env-pnpm">
                <template #header>
                    <div class="sec__title"><CodeFilled /> {{ $t('sv.env.pnpmSource') }}</div>
                </template>

                <a-tabs v-model:active-key="pnpmTab">
                    <a-tab-pane v-for="t in PNPM_TABS" :key="t.key" :tab="$t(t.labelKey)">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ pnpmVersionText(t.key) }}</code>
                            <a-tag v-if="pnpmProbed && pnpmStatus?.[t.key]?.outdated" color="orange">
                                {{ $t('sv.env.outdated') }}
                            </a-tag>
                            <a-tag v-else-if="pnpmProbed && pnpmStatus?.[t.key]?.present" color="green">
                                {{ $t('sv.env.upToDate') }}
                            </a-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestVersion') }}</span>
                            <code class="kv__v">{{ pnpmLatestText }}</code>
                        </div>

                        <div class="hint">{{ pnpmLatestUnknown ? $t('sv.env.latestUnknown') : $t(t.hintKey) }}</div>

                        <div v-if="pnpmNeedsAction(t.key)" class="act">
                            <a-button type="primary" :icon="DownloadOutlined" :loading="pnpmBusy" @click="installPnpm()">
                                {{ pnpmActionLabel(t.key) }}
                            </a-button>
                        </div>

                        <!-- 只有内置来源是「版本化目录」，才有已安装列表可切换 / 删除 -->
                        <div v-if="t.key === 'bundled'" class="iv">
                            <div class="iv__title">{{ $t('sv.env.installedVersions') }}</div>
                            <div v-if="!installedPnpm.installed.length" class="hint">{{ $t('sv.env.installedNone') }}</div>
                            <div v-else class="iv__list">
                                <div class="iv__thead">
                                    <span class="iv__c1">{{ $t('sv.env.colVersion') }}</span>
                                    <span class="iv__c2">{{ $t('sv.env.colStatus') }}</span>
                                    <span class="iv__c3">{{ $t('sv.env.colActions') }}</span>
                                </div>
                                <div class="iv__tbody">
                                    <div v-for="v in installedPnpm.installed" :key="v" class="iv__row">
                                        <span class="iv__c1"><code class="iv__ver">{{ withV(v) }}</code></span>
                                        <span class="iv__c2">
                                            <a-tag v-if="v === installedPnpm.active" color="green">
                                                {{ $t('sv.env.activeVersion') }}
                                            </a-tag>
                                            <span v-else class="iv__dash">—</span>
                                        </span>
                                        <span class="iv__c3">
                                            <a-button v-if="v !== installedPnpm.active" :loading="switchingPnpm === v" @click="switchInstalled('pnpm', v)">
                                                {{ $t('sv.env.switchVersion') }}
                                            </a-button>
                                            <a-button danger @click="removeInstalled('pnpm', v)">
                                                {{ $t('sv.env.removeVersion') }}
                                            </a-button>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </a-tab-pane>
                </a-tabs>

                <div v-if="pnpmBusy" class="act">
                    <a-progress
                        v-if="pnpmOp.op.value"
                        :percent="pnpmOp.op.value.phase === 'extract' ? 100 : pnpmOp.op.value.percent"
                        :status="pnpmOp.op.value.phase === 'extract' ? 'active' : 'normal'"
                        :show-info="pnpmOp.op.value.phase !== 'extract'"
                        :stroke-width="6"
                        class="dep-progress"
                    />
                    <div v-if="pnpmOp.op.value" class="hint dep-info">
                        {{ pnpmOp.op.value.phase === 'extract' ? $t('sv.env.extracting') : pnpmProgressInfo }}
                    </div>
                    <a-button :loading="canceling" @click="cancelInstall()">
                        {{ canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                    </a-button>
                </div>

                <!-- 版本选择器放在标签之外共用：两个来源都能装任意版本 -->
                <div class="upd-sep" />
                <a-form layout="vertical" class="vm-in">
                    <a-form-item :label="$t('sv.env.selectVersion')">
                        <div class="vm-row">
                            <a-select
                                v-model:value="pnpmSelected"
                                :options="pnpmVersionOptions"
                                show-search
                                :placeholder="$t('sv.env.selectPlaceholder')"
                                class="vm-sel"
                                :disabled="pnpmVersionsLoading || pnpmBusy"
                            />
                            <a-button :icon="ReloadOutlined" :loading="pnpmVersionsLoading" @click="loadPnpmVersions()">
                                {{ $t('sv.env.refresh') }}
                            </a-button>
                            <a-button
                                type="primary"
                                :icon="DownloadOutlined"
                                :loading="pnpmBusy"
                                :disabled="pnpmBusy || pnpmVersionsLoading || !pnpmSelected || sameVersion(pnpmSelected, pnpmCur?.version)"
                                @click="installPnpm(pnpmSelected)"
                            >
                                {{ $t('sv.env.installVersion') }}
                            </a-button>
                        </div>
                        <a-checkbox v-model:checked="pnpmIncludePre">{{ $t('sv.env.includePrerelease') }}</a-checkbox>
                        <div class="hint">{{ $t('sv.env.pnpmListHint') }}</div>
                    </a-form-item>
                </a-form>
                <div class="hint">{{ $t('sv.env.pnpmPluginNote') }}</div>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>
