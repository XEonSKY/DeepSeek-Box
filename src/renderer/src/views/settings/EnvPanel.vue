<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AppstoreOutlined, DeploymentUnitOutlined, DownloadOutlined, LinkOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { InstalledVersions, NodeRuntimeKind, NodeStatus, NpmRuntimeStatus, NpmSource, NpmStatus } from '@shared/types'
import { MIN_NODE_MAJOR, nodeMajor } from '@shared/version'
import { tt } from '../../lib/locales'
import { formatDownload } from '../../lib/format'
import { useSettingsStore } from './useSettingsStore'

/**
 * 「环境」页：Node 运行时（三个来源）与各自的版本情况。
 *
 * 结构：一个 Collapse 面板（与其它设置页一致的折叠卡片）→ 里面三个标签，
 * **标签本身就是选项** —— 点「系统自带」即把 `nodeRuntime` 切成 system（原来的下拉框已去掉）。
 *
 * 数据来自两处：
 *   - `window.api.versions`：Electron 自带 Node / Chromium（preload 里读 `process.versions`，不需要 IPC）；
 *   - `window.api.get('/node/status')`：系统 / 本地部署 Node 的当前版本 + 最新 LTS 及「是否落后」。
 *     ⚠️ 它**会联网**取 nodejs.org/dist/index.json（主进程侧有 10 分钟缓存），所以只在进入本页时调一次。
 */

const { state, actions } = useSettingsStore()

const open = ref(['env-node', 'env-npm'])

/**
 * 标签即设置项。这里用 string|number 的本地 ref 承接 `el-tabs` 的 v-model，再在 watch 里收窄回
 * `NodeRuntimeKind`：直接把联合类型交给 el-tabs 的 v-model 会在 vue-tsc 下报类型不匹配。
 * 反向 watch 是为了让外部改动（settings:changed 广播）也能反映到标签上。
 */
const RUNTIMES: readonly string[] = ['electron', 'system', 'local']
const tab = ref<string | number>(state.nodeRuntime)
watch(tab, (v) => {
    if (typeof v === 'string' && RUNTIMES.includes(v)) state.nodeRuntime = v as NodeRuntimeKind
})
watch(
    () => state.nodeRuntime,
    (v) => {
        if (tab.value !== v) tab.value = v
    }
)

/** Electron 自带 Node / Chromium 版本（preload 注入的 process.versions，恒定不会变）。 */
const versions = window.api.versions

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
const percent = ref(0)
const downloaded = ref(0)
const total = ref(0)
const speed = ref(0)
/** 当前部署阶段：extract 时显示不确定动画，不显示百分比。 */
const deployPhase = ref<'download' | 'extract'>('download')
/** 进度条下方的「已下载 / 总大小 · 速度」。 */
const progressInfo = computed(() => formatDownload(total.value, downloaded.value, speed.value))
let offNodeProgress: (() => void) | null = null
let offNpmProgress: (() => void) | null = null

/** 内置 npm 的下载进度（非 bundled 来源不上报，用 progressSeen 区分）。 */
const npmInstalling = ref(false)
const npmPercent = ref(0)
const npmDownloaded = ref(0)
const npmTotal = ref(0)
const npmSpeed = ref(0)
const npmPhase = ref<'download' | 'extract'>('download')
const npmProgressSeen = ref(false)
const npmProgressInfo = computed(() => formatDownload(npmTotal.value, npmDownloaded.value, npmSpeed.value))

onMounted(() => {
    // Node 部署下载 / 解压进度由主进程广播（与 dsh 向导同一个事件源）。
    offNodeProgress = window.api.on('nodeenv:deploy-progress', (p) => {
        deployPhase.value = p.phase
        percent.value = p.percent
        downloaded.value = p.downloaded
        total.value = p.total
        speed.value = p.speed
    })
    // 内置 npm 下载 / 解压进度（只有 bundled 来源广播）。
    offNpmProgress = window.api.on('npmenv:progress', (p) => {
        npmProgressSeen.value = true
        npmPhase.value = p.phase
        npmPercent.value = p.percent
        npmDownloaded.value = p.downloaded
        npmTotal.value = p.total
        npmSpeed.value = p.speed
    })
    void loadStatus()
    void loadVersions()
    void loadNpmStatus()
    void loadNpmVersions()
    void loadInstalledNode()
    void loadInstalledNpm()
})

onBeforeUnmount(() => {
    offNodeProgress?.()
    offNpmProgress?.()
})

/** 统一显示成带 v 前缀：`process.versions.node` 不带 v，`node --version` 带。 */
function withV(v: string | null | undefined): string {
    if (!v) return '—'
    return v.startsWith('v') ? v : `v${v}`
}

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

// 勾选「包含非 LTS」即重取列表（用 watch 而非 el-checkbox 的 @change，少依赖一个事件签名）。
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
    if (state.nodeRuntime === 'electron') return true
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
    try {
        await ElMessageBox.confirm(tt('msg.nodeStopText'), tt('msg.dshRunningTitle'), {
            confirmButtonText: tt('msg.continueBtn'),
            cancelButtonText: tt('msg.cancelBtn'),
            type: 'warning'
        })
    } catch {
        return 'cancelled'
    }
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
    deployPhase.value = 'download'
    percent.value = 0
    downloaded.value = 0
    total.value = 0
    speed.value = 0
    try {
        const r = await window.api.post('/node/deploy', { body: version ? { version } : {} })
        // 用户主动取消不算失败，静默返回即可（不弹错误 toast）。
        if (!r.canceled) {
            if (r.ok) ElMessage.success(tt('sv.env.deployOk', { version: withV(r.version) }))
            else ElMessage.error(r.message || tt('sv.env.deployFail'))
        }
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
    } finally {
        deploying.value = false
        // 先重启 dsh，再刷新状态 —— 否则刚部署的 Node 可能正被 dsh 用着，版本读不准。
        if (stop === 'stopped') await actions.restartDsh()
        await loadStatus()
        await loadVersions()
        await loadInstalledNode()
    }
}

/** 取消按钮的进行中状态（Node / npm / dsh 通用）。 */
const canceling = ref(false)

/** 取消正在进行的安装（下载与解压阶段生效）。 */
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

/** 切换生效版本只改指针、不重装；切换后刷新列表与状态。 */
async function switchInstalled(kind: 'node' | 'npm', version: string): Promise<void> {
    const switching = kind === 'node' ? switchingNode : switchingNpm
    if (switching.value) return
    switching.value = version
    try {
        const r = await window.api.put('/versions/:kind/active', { params: { kind }, body: { version } })
        if (r.ok) {
            ElMessage.success(tt('sv.env.versionSwitched', { version: withV(r.version) }))
            if (kind === 'node') {
                await loadInstalledNode()
                await loadStatus()
            } else {
                await loadInstalledNpm()
                await loadNpmStatus()
            }
        } else {
            ElMessage.error(r.message || '')
        }
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
    } finally {
        switching.value = ''
    }
}

/** 删除已安装版本；删除前确认，删除生效版本时主进程会自动切到剩余最新版。 */
async function removeInstalled(kind: 'node' | 'npm', version: string): Promise<void> {
    try {
        await ElMessageBox.confirm(tt('sv.env.removeVersionConfirm', { version: withV(version) }), tt('sv.env.removeVersion'), {
            confirmButtonText: tt('sv.env.removeVersion'),
            cancelButtonText: tt('msg.cancelBtn'),
            type: 'warning'
        })
    } catch {
        return // 用户取消
    }
    try {
        const r = await window.api.delete('/versions/:kind/:version', { params: { kind, version } })
        if (r.ok) {
            if (kind === 'node') {
                await loadInstalledNode()
                await loadStatus()
            } else {
                await loadInstalledNpm()
                await loadNpmStatus()
            }
        } else {
            ElMessage.error(r.message || '')
        }
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
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

async function loadNpmStatus(): Promise<void> {
    try {
        npmStatus.value = await window.api.get('/npm/status')
    } catch {
        npmStatus.value = null
    } finally {
        npmProbed.value = true
    }
}

/** npm 标签即选项（与 node 标签同一套收窄写法，理由见上）。 */
const NPM_SOURCES: readonly string[] = ['bundled', 'system', 'localnode']
const npmTab = ref<string | number>(state.npmSource)
watch(npmTab, (v) => {
    if (typeof v === 'string' && NPM_SOURCES.includes(v)) state.npmSource = v as NpmSource
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
    if (npmInstalling.value) return tt('sv.env.npmWorking')
    return npmStatus.value?.[src]?.present ? tt('sv.env.npmUpdate') : tt('sv.env.npmDownload')
}

function npmVersionLabel(v: string): string {
    return sameVersion(v, npmCur.value?.version) ? v + tt('sv.env.currentSuffix') : v
}

/** 下载 / 切换 npm 版本：作用于**当前标签**表示的那个来源（三个来源的安装机制见 npmRunner.updateNpm）。 */
async function installNpm(version?: string): Promise<void> {
    if (npmInstalling.value) return
    const source = state.npmSource
    npmInstalling.value = true
    npmProgressSeen.value = false
    npmPhase.value = 'download'
    npmPercent.value = 0
    npmDownloaded.value = 0
    npmTotal.value = 0
    npmSpeed.value = 0
    try {
        const r = await window.api.post('/npm/update', { body: version ? { source, version } : { source } })
        // 用户主动取消不算失败，静默返回即可（不弹错误 toast）。
        if (!r.canceled) {
            if (r.ok) ElMessage.success(tt('sv.env.npmOk', { version: withV(r.version) }))
            else ElMessage.error(r.message || tt('sv.env.npmFail'))
        }
    } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : String(err))
    } finally {
        npmInstalling.value = false
        await loadNpmStatus()
        await loadNpmVersions()
        await loadInstalledNpm()
    }
}
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><el-icon :size="34"><DeploymentUnitOutlined /></el-icon></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.env') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.env') }}</div>
            </div>
        </div>

        <el-collapse v-model="open">
            <el-collapse-item name="env-node">
                <template #title>
                    <div class="sec__title"><el-icon><DeploymentUnitOutlined /></el-icon> {{ $t('sv.env.nodeRuntime') }}</div>
                </template>

                <el-tabs v-model="tab">
                    <!-- 程序内置：随应用升级，没有「更新」按钮 -->
                    <el-tab-pane :label="$t('sv.env.nodeElectron')" name="electron">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ withV(versions.node) }}</code>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.builtinChrome') }}</span>
                            <code class="kv__v">{{ withV(versions.chrome) }}</code>
                        </div>
                        <div class="hint">{{ $t('sv.env.builtinHint') }}</div>
                    </el-tab-pane>

                    <!-- 系统自带：只比较版本，升级动作交给用户 -->
                    <el-tab-pane :label="$t('sv.env.nodeSystem')" name="system">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ systemVersionText }}</code>
                            <el-tag v-if="probed && status?.system.outdated" size="small" type="warning" effect="plain">
                                {{ $t('sv.env.outdated') }}
                            </el-tag>
                            <el-tag v-else-if="probed && status?.system.present" size="small" type="success" effect="plain">
                                {{ $t('sv.env.upToDate') }}
                            </el-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestLts') }}</span>
                            <code class="kv__v">{{ latestText }}</code>
                        </div>

                        <div class="hint">
                            {{ latestUnknown ? $t('sv.env.latestUnknown') : $t('sv.env.systemUpdateHint') }}
                        </div>

                        <div v-if="probed && status?.system.outdated" class="act">
                            <el-button size="small" :icon="LinkOutlined" @click="openNodeDownload">
                                {{ $t('sv.env.systemUpdate') }}
                            </el-button>
                        </div>
                    </el-tab-pane>

                    <!-- 本地部署：由应用代管，可直接下载 / 更新 -->
                    <el-tab-pane :label="$t('sv.env.nodeLocal')" name="local">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ localVersionText }}</code>
                            <el-tag v-if="probed && status?.local.outdated" size="small" type="warning" effect="plain">
                                {{ $t('sv.env.outdated') }}
                            </el-tag>
                            <el-tag v-else-if="probed && status?.local.present" size="small" type="success" effect="plain">
                                {{ $t('sv.env.upToDate') }}
                            </el-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestLts') }}</span>
                            <code class="kv__v">{{ latestText }}</code>
                        </div>

                        <div class="hint">
                            {{ latestUnknown ? $t('sv.env.latestUnknown') : $t('sv.env.localHint') }}
                        </div>

                        <el-progress
                            v-if="deploying"
                            :percentage="deployPhase === 'extract' ? 0 : percent"
                            :indeterminate="deployPhase === 'extract'"
                            :show-text="deployPhase !== 'extract'"
                            :stroke-width="6"
                            class="dep-progress"
                        />
                        <div v-if="deploying" class="hint dep-info">
                            {{ deployPhase === 'extract' ? $t('sv.env.extracting') : progressInfo }}
                        </div>

                        <div v-if="deploying" class="act">
                            <el-button size="small" :loading="canceling" @click="cancelInstall()">
                                {{ canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                            </el-button>
                        </div>

                        <div v-if="localNeedsAction" class="act">
                            <el-button type="primary" size="small" :icon="DownloadOutlined" :loading="deploying" @click="installNode()">
                                {{
                                    deploying
                                        ? $t('sv.env.deploying')
                                        : deployKind === 'update'
                                            ? $t('sv.env.localUpdate', { version: latestText })
                                            : $t('sv.env.localDeploy')
                                }}
                            </el-button>
                        </div>

                        <!-- 下载 / 切换任意版本：与 dsh 页的「版本管理」同一套交互与样式 -->
                        <div class="upd-sep" />
                        <el-form label-position="top" class="vm-in">
                            <el-form-item :label="$t('sv.env.selectVersion')">
                                <div class="vm-row">
                                    <el-select
                                        v-model="selectedVersion"
                                        filterable
                                        :placeholder="$t('sv.env.selectPlaceholder')"
                                        class="vm-sel"
                                        :disabled="versionsLoading || deploying"
                                    >
                                        <el-option v-for="v in nodeVersions" :key="v" :label="versionLabel(v)" :value="v" />
                                    </el-select>
                                    <el-button :icon="ReloadOutlined" :loading="versionsLoading" @click="loadVersions()">
                                        {{ $t('sv.env.refresh') }}
                                    </el-button>
                                    <el-button
                                        type="primary"
                                        :icon="DownloadOutlined"
                                        :loading="deploying"
                                        :disabled="deploying || versionsLoading || !selectedVersion || sameVersion(selectedVersion, deployedNode)"
                                        @click="installNode(selectedVersion)"
                                    >
                                        {{ $t('sv.env.installVersion') }}
                                    </el-button>
                                </div>
                                <el-checkbox v-model="includeNonLts">{{ $t('sv.env.includeNonLts') }}</el-checkbox>
                                <div v-if="selectedTooOld" class="warn">
                                    {{ $t('sv.env.tooOld', { major: MIN_NODE_MAJOR }) }}
                                </div>
                                <div class="hint">{{ $t('sv.env.versionListHint') }}</div>
                            </el-form-item>
                        </el-form>

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
                                            <el-tag v-if="v === installedNode.active" size="small" type="success" effect="plain">
                                                {{ $t('sv.env.activeVersion') }}
                                            </el-tag>
                                            <span v-else class="iv__dash">—</span>
                                        </span>
                                        <span class="iv__c3">
                                            <el-button v-if="v !== installedNode.active" size="small" :loading="switchingNode === v" @click="switchInstalled('node', v)">
                                                {{ $t('sv.env.switchVersion') }}
                                            </el-button>
                                            <el-button size="small" type="danger" plain @click="removeInstalled('node', v)">
                                                {{ $t('sv.env.removeVersion') }}
                                            </el-button>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </el-tab-pane>
                </el-tabs>

                <div class="hint">{{ $t('sv.env.nodeRuntimeHint') }}</div>

                <div class="apply-sec">
                    <div class="apply-row">
                        <div class="apply__txt">
                            {{ $t('sv.env.applyTxt') }}
                            <div v-if="!runtimeUsable" class="warn">
                                {{ $t('sv.env.runtimeUnusable', { major: MIN_NODE_MAJOR }) }}
                            </div>
                        </div>
                        <el-button type="primary" :loading="state.applying" :disabled="!runtimeUsable" @click="actions.apply()">
                            {{ $t('sv.env.applyBtn') }}
                        </el-button>
                    </div>
                </div>
            </el-collapse-item>

            <!-- npm 来源：与 node 同构（折叠卡片 → 三个标签 = 三个来源） -->
            <el-collapse-item name="env-npm">
                <template #title>
                    <div class="sec__title"><el-icon><AppstoreOutlined /></el-icon> {{ $t('sv.env.npmSource') }}</div>
                </template>

                <div v-if="state.dshSource === 'global'" class="hint">{{ $t('sv.env.npmGlobalNote') }}</div>

                <el-tabs v-model="npmTab">
                    <el-tab-pane v-for="t in NPM_TABS" :key="t.key" :label="$t(t.labelKey)" :name="t.key">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ npmVersionText(t.key) }}</code>
                            <el-tag v-if="npmProbed && npmStatus?.[t.key]?.outdated" size="small" type="warning" effect="plain">
                                {{ $t('sv.env.outdated') }}
                            </el-tag>
                            <el-tag v-else-if="npmProbed && npmStatus?.[t.key]?.present" size="small" type="success" effect="plain">
                                {{ $t('sv.env.upToDate') }}
                            </el-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestVersion') }}</span>
                            <code class="kv__v">{{ npmLatestText }}</code>
                        </div>

                        <div class="hint">{{ npmLatestUnknown ? $t('sv.env.latestUnknown') : $t(t.hintKey) }}</div>

                        <div v-if="npmNeedsAction(t.key)" class="act">
                            <el-button
                                type="primary"
                                size="small"
                                :icon="DownloadOutlined"
                                :loading="npmInstalling"
                                @click="installNpm()"
                            >
                                {{ npmActionLabel(t.key) }}
                            </el-button>
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
                                            <el-tag v-if="v === installedNpm.active" size="small" type="success" effect="plain">
                                                {{ $t('sv.env.activeVersion') }}
                                            </el-tag>
                                            <span v-else class="iv__dash">—</span>
                                        </span>
                                        <span class="iv__c3">
                                            <el-button v-if="v !== installedNpm.active" size="small" :loading="switchingNpm === v" @click="switchInstalled('npm', v)">
                                                {{ $t('sv.env.switchVersion') }}
                                            </el-button>
                                            <el-button size="small" type="danger" plain @click="removeInstalled('npm', v)">
                                                {{ $t('sv.env.removeVersion') }}
                                            </el-button>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </el-tab-pane>
                </el-tabs>

                <div v-if="npmInstalling" class="act">
                    <el-progress
                        v-if="npmProgressSeen"
                        :percentage="npmPhase === 'extract' ? 0 : npmPercent"
                        :indeterminate="npmPhase === 'extract'"
                        :show-text="npmPhase !== 'extract'"
                        :stroke-width="6"
                        class="dep-progress"
                    />
                    <div v-if="npmProgressSeen" class="hint dep-info">
                        {{ npmPhase === 'extract' ? $t('sv.env.extracting') : npmProgressInfo }}
                    </div>
                    <el-button size="small" :loading="canceling" @click="cancelInstall()">
                        {{ canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                    </el-button>
                </div>

                <!-- 版本选择器放在标签之外共用：三个来源都能装任意版本，抄三遍纯属重复 -->
                <div class="upd-sep" />
                <el-form label-position="top" class="vm-in">
                    <el-form-item :label="$t('sv.env.selectVersion')">
                        <div class="vm-row">
                            <el-select
                                v-model="npmSelected"
                                filterable
                                :placeholder="$t('sv.env.selectPlaceholder')"
                                class="vm-sel"
                                :disabled="npmVersionsLoading || npmInstalling"
                            >
                                <el-option v-for="v in npmVersions" :key="v" :label="npmVersionLabel(v)" :value="v" />
                            </el-select>
                            <el-button :icon="ReloadOutlined" :loading="npmVersionsLoading" @click="loadNpmVersions()">
                                {{ $t('sv.env.refresh') }}
                            </el-button>
                            <el-button
                                type="primary"
                                :icon="DownloadOutlined"
                                :loading="npmInstalling"
                                :disabled="npmInstalling || npmVersionsLoading || !npmSelected || sameVersion(npmSelected, npmCur?.version)"
                                @click="installNpm(npmSelected)"
                            >
                                {{ $t('sv.env.installVersion') }}
                            </el-button>
                        </div>
                        <el-checkbox v-model="npmIncludePre">{{ $t('sv.env.includePrerelease') }}</el-checkbox>
                        <div class="hint">{{ $t('sv.env.npmListHint') }}</div>
                    </el-form-item>
                </el-form>
                <div class="hint">{{ $t('sv.env.npmNoRestart') }}</div>
            </el-collapse-item>
        </el-collapse>
    </div>
</template>

<style scoped>
.dep-info {
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
/* 只留本组件专用规则；跨组件通用样式一律进 styles/*.css（见 AGENT.md §3 样式约定）。 */
.kv {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 0;
  font-size: 13px;
}
.kv__k {
  flex: 0 0 auto;
  min-width: 150px;
  color: var(--el-text-color-secondary);
}
.kv__v {
  font-family: var(--el-font-family-mono);
  color: var(--el-text-color-primary);
  background: var(--el-fill-color-light);
  padding: 1px 8px;
  border-radius: 6px;
}
.act {
  margin-top: 14px;
}
.dep-progress {
  margin-top: 14px;
}
</style>
