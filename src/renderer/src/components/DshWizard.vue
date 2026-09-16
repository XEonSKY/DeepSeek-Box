<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloseOutlined, FileTextOutlined, DownloadOutlined, LinkOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { ConfigDirInfo, EnvProbe, NodeRuntimeKind, NpmSource, ProxyProtocol, ProxyScope, RegistrySpeedResult } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { MIN_NODE_MAJOR, isPrerelease, nodeMajor } from '@shared/version'
import { errorMessage } from '@shared/errors'
import { useAppIcon } from '../lib/appIcon'
import { formatDownload } from '../lib/format'
import ProxyFields from './ProxyFields.vue'
import WindowControls from './WindowControls.vue'
import WizardSteps from './WizardSteps.vue'

/**
 * @deepseek-ai/dsh 包缺失时的全屏安装向导。
 *
 * 从 App.vue 抽出：它自带完整状态（四步流程 / 环境探测 / 版本选择 / 安装日志）与独立样式，
 * 与外壳其余部分只通过「是否显示」和「装完了」两点耦合，因此适合作为独立组件。
 * 由父组件用 `v-if="showMissing"` 控制挂载——每次挂载都会重新探测环境并把步骤归零。
 */
const emit = defineEmits<{ done: [] }>()

const { t } = useI18n({ useScope: 'global' })
const appIcon = useAppIcon()

type Reg = 'npmjs' | 'npmmirror'

const installingDsh = ref(false)
const installError = ref('')
const installReg = ref<Reg>('npmjs')

// Optional dsh-version selection on first install: pick a specific published
// version and whether to include pre-releases (the list is re-fetched accordingly).
const installPrerelease = ref(false)
const installVersions = ref<string[]>([])
const versionsLoading = ref(false)
const installVersion = ref('')

// dsh 来源(local/global)与 npm(source)：本页选择后、安装前会持久化到设置。
const installSource = ref<'local' | 'global'>('local')
const installNpm = ref<NpmSource>('system')
// 安装过程的实时日志（本页展示，安装结束时保留以便回看）。
const installLog = ref<string[]>([])
// 是否打开全屏安装日志。
const logFullscreen = ref(false)

// ---- 首次安装引导 ---------------------------------------------------
// 0 安装方式 · 1 镜像源 · 2 Node 环境 · 3 NPM 环境 · 4 DSH 环境
// 第 0 步决定后面是「简易安装」自动跑完 1–4，还是「自定义安装」由用户逐步选择。
const step = ref(0)

/** 安装方式：简易（自动）/ 自定义（逐步）；null = 尚未选择。 */
type InstallMode = 'simple' | 'custom'
const mode = ref<InstallMode | null>(null)

/** 步骤条的分段定义（与 step 下标一一对应）。 */
const STEP_KEYS = ['mode', 'source', 'node', 'npm', 'dsh'] as const
const wizardSteps = computed(() => STEP_KEYS.map((k) => ({ key: k, label: t(`dshMissing.wiz.${k}`) })))

/**
 * 整体进度（0–100）：把「走到第几步」与「当前步做了多少」合成**一条**进度。
 *
 * 为什么不按步分段画：分段进度要求每一步都报得出百分比，而简单安装里
 * 测速、装 dsh 这类阶段根本拿不到百分比 —— 结果就是有的段满、有的段空、
 * 有的段在跑动画，反而更难一眼看出「装到哪了」。合成一条后：
 *
 *   整体进度 = (已完成步数 + 当前步完成比例) / 总步数
 *
 * 于是它必定单调不减，且任何时刻都读得出一个确切的百分比 ——
 * 不需要「不确定进度」那种滑动动画。
 */
const overallProgress = computed(() => {
    // 当前步完成了多少（0–1）。拿不到百分比的阶段按 0 处理：进度条停在这一步的起点，
    // 由下方的文字说明「正在做什么」，而不是用动画假装有进度。
    const within = deployingNode.value
        ? (nodeExtracting.value ? 0 : clamp01(deployPercent.value / 100))
        : installingNpm.value
            ? (npmExtracting.value ? 0 : clamp01(npmPercent.value / 100))
            : 0
    const total = STEP_KEYS.length
    return Math.round(((step.value + within) / total) * 100)
})

/** 把比例夹到 0–1：下载进度偶有越界或 NaN。 */
function clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(1, n))
}

// ---- 镜像源测速（简易安装用来自动选源）----
const speedTesting = ref(false)
const speedResult = ref<RegistrySpeedResult | null>(null)
const speedFailed = computed(() => speedResult.value !== null && speedResult.value.fastest === null)

// ---- 简易安装 ----
const simpleRunning = ref(false)
/** 简易安装选定的 dsh 版本与其来源（用于给用户一句「要装什么」的说明）。 */
const simpleVersion = ref('')
const simplePrerelease = ref(false)

const envProbe = ref<EnvProbe | null>(null)
const probingEnv = ref(false)
/** 环境探测 / 初始化失败的原因（原文，展示时套 i18n 前缀）；非空说明选项不可用是「探测失败」而非「真的没有」。 */
const envError = ref<string | null>(null)

/** 系统 Node 是否可用（存在且主版本 ≥ dsh 要求，阈值见 shared/version.ts）。 */
const systemNodeOk = computed(() => {
    const v = envProbe.value?.node.version
    if (!envProbe.value?.node.present || !v) return false
    const major = nodeMajor(v)
    return major !== null && major >= MIN_NODE_MAJOR
})

// 所选 Node 运行时（安装时随设置持久化）。
const nodeRuntimeChoice = ref<NodeRuntimeKind>('electron')
const deployingNode = ref(false)
const deployPercent = ref(0)
const deployDownloaded = ref(0)
const deployTotal = ref(0)
const deploySpeed = ref(0)
/** 进度条下方的「已下载 / 总大小 · 速度」。 */
const deployInfo = computed(() => formatDownload(deployTotal.value, deployDownloaded.value, deploySpeed.value))

// 「程序内置」npm：第 2 步选中且尚未缓存时，点下一步先下载再继续（进度由主进程广播）。
const installingNpm = ref(false)
const npmPercent = ref(0)
const npmDownloaded = ref(0)
const npmTotal = ref(0)
const npmSpeed = ref(0)
const npmBundledPresent = ref(false)
const npmInfo = computed(() => formatDownload(npmTotal.value, npmDownloaded.value, npmSpeed.value))

// ---- Node 版本选择（第 1 步「部署并使用本地 Node」）----
const nodeVersions = ref<string[]>([])
const nodeVersionsLoading = ref(false)
const nodeIncludeNonLts = ref(false)
const nodeVersion = ref('')
// 「当前生效」的兜底来源：envProbe.local.version 读不到时用已安装版本列表的 active。
const nodeActiveVersion = ref<string | null>(null)
/** 当前生效的本地 Node 版本：优先环境探测，其次已安装版本列表。 */
const localNodeActive = computed(() => envProbe.value?.local.version ?? nodeActiveVersion.value)

// ---- npm 版本选择（第 2 步「程序内置」）----
const npmVersions = ref<string[]>([])
const npmVersionsLoading = ref(false)
const npmIncludePre = ref(false)
const npmVersion = ref('')

// 解压阶段改用不确定动画（不显示百分比）；取消进行中禁用「取消」按钮。
const nodeExtracting = ref(false)
const npmExtracting = ref(false)
const canceling = ref(false)

/** 没有专用进度条（Node / npm 下载）时，通用执行条的文案。 */
const installLabel = computed(() => (step.value === 4 ? t('dshMissing.progressDsh') : t('dshMissing.executing')))

/** 安装 / 测速期间：禁用一切会改变流程的按钮。 */
const busy = computed(() => installingDsh.value || simpleRunning.value || speedTesting.value)

/** 第 0 步还没选装法时，主按钮不可点（否则点了也没反应，像是坏了）。 */
const primaryDisabled = computed(() => step.value === 0 && mode.value === null)

/** 主按钮文案：第 0 步按装法区分，最后一步是「安装」，其余是「执行并下一步」。 */
const primaryLabel = computed(() => {
    if (step.value === 0) {
        return mode.value === 'simple' ? t('dshMissing.modeSimpleStart') : t('dshMissing.next')
    }
    return step.value < 4 ? t('dshMissing.runStep') : t('dshMissing.install')
})

/** 简易安装期间显示的说明：最终会装哪个版本（含「没有正式版」的提示）。 */
const simplePlan = computed(() => {
    if (!simpleVersion.value) return ''
    return simplePrerelease.value
        ? t('dshMissing.simplePlanPrerelease', { version: simpleVersion.value })
        : t('dshMissing.simplePlanStable', { version: simpleVersion.value })
})

const runtimeHint = computed(() => {
    const c = nodeRuntimeChoice.value
    if (c === 'system') return t('dshMissing.node.hintSystem')
    if (c === 'local') return t('dshMissing.node.hintLocal')
    return t('dshMissing.node.hintElectron')
})

async function deployOnce(version?: string): Promise<boolean> {
    if (deployingNode.value) return false
    deployingNode.value = true
    canceling.value = false
    nodeExtracting.value = false
    deployPercent.value = 0
    deployDownloaded.value = 0
    deployTotal.value = 0
    deploySpeed.value = 0
    try {
        const r = await window.api.post('/node/deploy', { body: version ? { version } : {} })
        if (r.canceled) {
            // 用户主动取消：不算失败，也不弹错误提示。
            ElMessage.info(r.message || t('dshMissing.cancel'))
            return false
        }
        if (r.ok) {
            deployPercent.value = 100
            ElMessage.success(r.message)
            return true
        }
        ElMessage.error(r.message)
        return false
    } catch (err) {
        ElMessage.error(errorMessage(err))
        return false
    } finally {
        deployingNode.value = false
        nodeExtracting.value = false
        canceling.value = false
        await probeEnv()
        await loadInstalledNode()
    }
}
/** 下载并部署本地 Node：默认最新 LTS，选定版本时装指定版本。 */
const deployNode = (): Promise<void> => deployOnce(nodeVersion.value || undefined).then(() => undefined)

/** 确保「程序内置」npm 就绪：已缓存直接通过，未缓存 / 指定版本则先下载（带进度）再进入下一步。 */
async function ensureNpmOnce(version?: string): Promise<boolean> {
    canceling.value = false
    npmExtracting.value = false
    try {
        const r = await window.api.post('/npm/ensure', { body: version ? { version } : {} })
        if (r.canceled) {
            // 用户主动取消：不算失败，也不弹错误提示。
            ElMessage.info(r.message || t('dshMissing.cancel'))
            return false
        }
        if (r.ok) {
            npmBundledPresent.value = true
            return true
        }
        ElMessage.error(r.message)
        return false
    } catch (err) {
        ElMessage.error(errorMessage(err))
        return false
    } finally {
        installingNpm.value = false
        npmExtracting.value = false
        canceling.value = false
    }
}

/** 探测「程序内置」npm 是否已缓存：决定第 2 步是否需要先下载。 */
async function loadNpmStatus(): Promise<void> {
    try {
        npmBundledPresent.value = (await window.api.get('/npm/status')).bundled.present
    } catch {
        npmBundledPresent.value = false
    }
}

/** 拉取可部署的 Node 版本（新 → 旧）；默认只 LTS，勾选后含 Current，默认选中最新一项。 */
async function loadNodeVersions(): Promise<void> {
    if (nodeVersionsLoading.value) return
    nodeVersionsLoading.value = true
    try {
        const list = await window.api.get('/node/versions', { query: { includeNonLts: nodeIncludeNonLts.value } })
        nodeVersions.value = list
        if (!list.includes(nodeVersion.value)) nodeVersion.value = list[0] ?? ''
    } catch {
        nodeVersions.value = []
    } finally {
        nodeVersionsLoading.value = false
    }
}

/** 拉取可下载的 npm 版本（新 → 旧）；是否含预发布由开关决定，默认选中最新一项。 */
async function loadNpmVersions(): Promise<void> {
    if (npmVersionsLoading.value) return
    npmVersionsLoading.value = true
    try {
        const list = await window.api.get('/npm/versions', { query: { prerelease: npmIncludePre.value } })
        npmVersions.value = list
        if (!list.includes(npmVersion.value)) npmVersion.value = list[0] ?? ''
    } catch {
        npmVersions.value = []
    } finally {
        npmVersionsLoading.value = false
    }
}

/** 读取本地 Node 已安装版本的生效项（envProbe 读不到时的兜底）。 */
async function loadInstalledNode(): Promise<void> {
    try {
        nodeActiveVersion.value = (await window.api.get('/versions/:kind', { params: { kind: 'node' } })).active
    } catch {
        nodeActiveVersion.value = null
    }
}

/** 取消正在进行的下载 / 解压；按钮在安装流程结束前保持禁用。 */
async function cancelCurrentInstall(): Promise<void> {
    if (canceling.value) return
    canceling.value = true
    try {
        await window.api.post('/installs/cancel')
    } catch {
        // 取消失败不额外打扰用户，等安装流程自行结束。
    }
}

async function probeEnv(): Promise<void> {
    probingEnv.value = true
    try {
        envProbe.value = await window.api.get('/env')
        envError.value = null
        // 所选 npm 在不可用时回退到内置 npm。
        if (envProbe.value) {
            if (installNpm.value === 'system' && !envProbe.value.npm) installNpm.value = 'bundled'
            else if (installNpm.value === 'localnode' && !envProbe.value.local.present) installNpm.value = 'bundled'
        }
        // 选了系统 Node 但实际不可用（<20 / 缺失）时回退到 Electron。
        if (envProbe.value && nodeRuntimeChoice.value === 'system' && !systemNodeOk.value) {
            nodeRuntimeChoice.value = 'electron'
        }
    } catch (err) {
        // 探测失败不能静默：否则界面表现为「系统 Node / 系统 npm 全部灰掉」却给不出任何原因。
        envProbe.value = null
        envError.value = errorMessage(err)
    } finally {
        probingEnv.value = false
    }
}

// 配置目录选择（第 0 步）：当前有效路径 + 默认路径。
const cfgDir = ref('')
const cfgDefaultDir = ref('')
async function loadConfigDir(): Promise<void> {
    try {
        const info = await window.api.get('/config-dir')
        cfgDir.value = info.current
        cfgDefaultDir.value = info.default
    } catch {
    /* ignore */
    }
}
/** 同步向导里的配置目录展示；旧目录有内容时提示将在重启后迁移。 */
function applyConfigDir(info: ConfigDirInfo): void {
    cfgDir.value = info.current
    cfgDefaultDir.value = info.default
    if (info.pending) ElMessage.info(t('dshMissing.configDirPending'))
}
async function pickConfigDir(): Promise<void> {
    const p = await window.api.post('/dialog/directory')
    if (!p) return
    applyConfigDir(await window.api.put('/config-dir', { body: { dir: p } }))
}
async function resetConfigDir(): Promise<void> {
    applyConfigDir(await window.api.put('/config-dir', { body: { dir: null } }))
}
// ---- 代理设置（右上角入口 → 全屏面板）----
// 向导本身**不铺开网络表单**，只在右上角留一个入口，点开才是全屏的代理设置。
// 为什么必须能在这里配：Node / npm / dsh 都要在线下载，「必须先能出网才能装、装完才能配代理」
// 是个死锁；而每步执行前都会 persistWizard()，所以这里改完立刻作用于本次安装。
const proxyEnabled = ref(DEFAULT_SETTINGS.proxyEnabled)
const proxyProtocol = ref<ProxyProtocol>(DEFAULT_SETTINGS.proxyProtocol)
const proxyHost = ref(DEFAULT_SETTINGS.proxyHost)
const proxyPort = ref<number | null>(DEFAULT_SETTINGS.proxyPort)
const proxyScope = ref<ProxyScope[]>([...DEFAULT_SETTINGS.proxyScope])
/** 是否打开全屏代理设置。 */
const proxyFull = ref(false)

const back = (): void => {
    if (step.value > 0) step.value = step.value - 1
}

/** 关闭全屏代理设置：顺手落盘，避免用户「设置了却忘了按下一步」。 */
async function closeProxySettings(): Promise<void> {
    proxyFull.value = false
    await persistWizard()
}

/** 把向导当前选择持久化到设置。 */
async function persistWizard(): Promise<boolean> {
    try {
        const cur = await window.api.get('/settings')
        await window.api.put('/settings', {
            body: {
                ...cur,
                npmRegistry: installReg.value,
                dshSource: installSource.value,
                nodeRuntime: nodeRuntimeChoice.value,
                npmSource: installSource.value === 'local' ? installNpm.value : cur.npmSource,
                proxyEnabled: proxyEnabled.value,
                proxyProtocol: proxyProtocol.value,
                proxyHost: proxyHost.value,
                proxyPort: proxyPort.value,
                proxyScope: [...proxyScope.value]
            }
        })
        return true
    } catch (err) {
        ElMessage.error(errorMessage(err))
        return false
    }
}

/** 第 3 步：真正安装 dsh。 */
async function performInstall(): Promise<boolean> {
    installLog.value = []
    try {
        if (!(await persistWizard())) return false
        const r = await window.api.post('/dsh/install', {
            body: {
                version: installVersion.value || null,
                registry: installReg.value
            }
        })
        if (!r.ok) {
            installError.value = r.message
            return false
        }
        return true
    } catch (err) {
        installError.value = errorMessage(err)
        return false
    }
}

/** 执行当前步（持久化 + 该步动作），成功后自动进入下一步 / 完成。 */
async function runCurrentStep(): Promise<void> {
    if (installingDsh.value || simpleRunning.value) return
    // 第 0 步不联网也不写设置：选了简易安装就直接交给自动流程，选了自定义才往下走。
    if (step.value === 0) {
        if (mode.value === 'simple') {
            await runSimpleInstall()
            return
        }
        if (mode.value === 'custom') step.value = 1
        return
    }
    installingDsh.value = true
    installError.value = ''
    let ok: boolean
    try {
        // 下标 1–4 依次是「镜像源 · Node · NPM · DSH」，相比原来的 0–3 整体后移一位。
        if (step.value === 1) {
            ok = await persistWizard()
        } else if (step.value === 2) {
            ok = await persistWizard()
            // 选了本地 Node 但尚未部署 → 自动按所选版本下载部署（带进度）。
            if (ok && nodeRuntimeChoice.value === 'local' && envProbe.value && !envProbe.value.local.present) {
                ok = await deployOnce(nodeVersion.value || undefined)
            }
        } else if (step.value === 3) {
            ok = await persistWizard()
            // 「程序内置」npm 由应用代管：选版本时装该版本，未选则由主进程复用缓存 / 拉最新。
            if (ok && installNpm.value === 'bundled') {
                ok = await ensureNpmOnce(npmVersion.value || undefined)
            }
        } else {
            ok = await performInstall()
        }
    } finally {
        installingDsh.value = false
    }
    if (!ok) return
    if (step.value >= 4) {
        emit('done') // 安装完成：主进程会自动启动 dsh，由父组件收起本向导
    } else {
        step.value = step.value + 1
    }
}

/**
 * 测速选出最快的镜像源。全部失败时返回 null（调用方保留用户当前设置，不瞎选）。
 * 结果写进 `speedResult` 供界面展示每个源的实测延迟。
 */
async function pickFastestRegistry(): Promise<string | null> {
    speedTesting.value = true
    try {
        const r = await window.api.post('/registries/speed')
        speedResult.value = r
        if (r.fastest) installReg.value = r.fastest
        return r.fastest
    } catch {
        // 测速本身失败不该阻断安装：沿用当前设置继续。
        // 但结果要留一个「空的成功结构」而不是 null —— 否则结果框整个消失，
        // 用户既看不到「测速失败」的说明，也不知道为什么源没被自动切换。
        speedResult.value = { samples: [], fastest: null }
        return null
    } finally {
        speedTesting.value = false
    }
}

/**
 * 选 dsh 版本：**优先最新正式版，没有正式版时退回最新测试版**。
 *
 * 无需自己判两次：主进程的 `filterByPrerelease` 在「过滤掉预发布后为空」时会自动回退到全量，
 * 所以传 `prerelease: false` 一次请求就同时满足这两种情况。
 * 返回是否为「退回了测试版」，用于给用户一句说明。
 */
async function pickLatestDsh(): Promise<boolean> {
    installPrerelease.value = false
    // 先同步写上「已加载」标记：watch(step) 会在下一个 tick 看到 step 变成 4 并检查这个标记，
    // 不先占位的话它会再发一次一模一样的请求。
    versionsLoadedFor.value = versionsScope()
    try {
        const list = await window.api.get('/dsh/versions', { query: { prerelease: false, registry: installReg.value } })
        installVersions.value = list
        installVersion.value = list[0] ?? ''
        simpleVersion.value = installVersion.value
        simplePrerelease.value = list.length > 0 && isPrerelease(list[0])
        return simplePrerelease.value
    } catch (err) {
        // 失败就别把标记留着，否则用户点「重试」时会被当成「已经加载过」而不再请求。
        versionsLoadedFor.value = ''
        throw err
    }
}

/**
 * 简易安装：按固定策略自动跑完「镜像源 → Node → NPM → DSH」四步。
 *
 * 策略（用户选定，见 modeSimpleDesc）：
 *  1. 镜像源：实测两个源，取最快（都失败则沿用当前设置）；
 *  2. Node：用 Electron 自带的 Node —— 不需要下载任何东西，是唯一「零等待」的选项；
 *  3. npm：用内置 npm，未缓存时由主进程下载；
 *  4. dsh：装最新正式版，没有正式版则装最新测试版。
 *
 * 每一步都先把 `step` 推到位再执行，这样步骤条的进度与真实进度一致 ——
 * 简易安装里用户唯一能看到流程的地方就是这条步骤条。
 */
async function runSimpleInstall(): Promise<void> {
    if (simpleRunning.value) return
    simpleRunning.value = true
    installError.value = ''
    try {
        // 1) 镜像源：测速选最快
        step.value = 1
        speedResult.value = null
        await pickFastestRegistry()

        // 2) Node：用 Electron 自带（无需部署）
        step.value = 2
        nodeRuntimeChoice.value = 'electron'
        // dsh 装进配置目录（应用默认），全程不碰用户的全局 npm。
        installSource.value = 'local'
        if (!(await persistWizard())) return

        // 3) npm：内置（未缓存则先下载）
        step.value = 3
        installNpm.value = 'bundled'
        if (!(await persistWizard())) return
        if (!(await ensureNpmOnce(npmVersion.value || undefined))) return

        // 4) dsh：最新正式版，没有则最新测试版
        step.value = 4
        await pickLatestDsh()
        if (!(await performInstall())) return

        emit('done')
    } catch (err) {
        installError.value = errorMessage(err)
    } finally {
        simpleRunning.value = false
    }
}

/** 已加载版本列表对应的（镜像源 + 预发布）组合，用于按需重建、避免无谓的联网请求。 */
const versionsLoadedFor = ref('')
function versionsScope(): string {
    return installReg.value + '|' + String(installPrerelease.value)
}

async function loadInstallVersions(): Promise<void> {
    if (versionsLoading.value) return
    versionsLoading.value = true
    const scope = versionsScope()
    try {
        const list = await window.api.get('/dsh/versions', {
            query: {
                prerelease: installPrerelease.value,
                registry: installReg.value
            }
        })
        installVersions.value = list
        versionsLoadedFor.value = scope
        // Default to the newest version within the current selection scope.
        if (!list.includes(installVersion.value)) installVersion.value = list[0] ?? ''
    } catch {
        installVersions.value = []
        versionsLoadedFor.value = ''
    } finally {
        versionsLoading.value = false
    }
}

/**
 * 按步骤懒加载：进入第 2 步才探测内置 npm 缓存状态，进入第 3 步才拉取版本列表
 * （不再在向导一挂载时就联网取版本）。
 */
watch(step, (s) => {
    if (s === 2) {
        void loadNodeVersions()
        void loadInstalledNode()
    }
    if (s === 3) {
        void loadNpmStatus()
        void loadNpmVersions()
    }
    // 第 4 步（DSH）：简易安装会自己先把标记写上并取版本，这里的判断因此会跳过、不重复请求。
    if (s === 4 && versionsLoadedFor.value !== versionsScope()) void loadInstallVersions()
})

// 预发布开关 / 镜像源变化时，若正停留在第 4 步则重建版本列表。
watch([installPrerelease, installReg], () => {
    if (step.value === 4) void loadInstallVersions()
})

// 「包含非 LTS（Current）」/「包含预发布」切换后重新拉取对应版本列表。
watch(nodeIncludeNonLts, () => void loadNodeVersions())
watch(npmIncludePre, () => void loadNpmVersions())

const quitShell = (): void => void window.api.post('/app/quit')

let offLog: (() => void) | null = null
let offDeploy: (() => void) | null = null
let offNpm: (() => void) | null = null

onMounted(() => {
    // 安装时把主进程的 stdout/stderr 追加到本页日志。
    offLog = window.api.on('dsh:log', (entry) => {
        // 简易安装全程自动，installingDsh 一直是 false —— 只判断它会让日志面板空白。
        if (!installingDsh.value && !simpleRunning.value) return
        const line = (entry.k === 'e' ? '[err] ' : '') + entry.s
        installLog.value.push(line)
        if (installLog.value.length > 500) installLog.value.splice(0, installLog.value.length - 500)
    })
    offDeploy = window.api.on('nodeenv:deploy-progress', (p) => {
        // 解压阶段只显示不确定动画，不显示百分比。
        nodeExtracting.value = p.phase === 'extract'
        deployPercent.value = p.percent
        deployDownloaded.value = p.downloaded
        deployTotal.value = p.total
        deploySpeed.value = p.speed
    })
    offNpm = window.api.on('npmenv:progress', (p) => {
        installingNpm.value = true
        npmExtracting.value = p.phase === 'extract'
        npmPercent.value = p.percent
        npmDownloaded.value = p.downloaded
        npmTotal.value = p.total
        npmSpeed.value = p.speed
    })
    void (async () => {
        try {
            const s = await window.api.get('/settings')
            installReg.value = s.npmRegistry
            installPrerelease.value = s.checkPrerelease === true
            installSource.value = s.dshSource ?? 'local'
            installNpm.value = s.npmSource ?? 'system'
            nodeRuntimeChoice.value = s.nodeRuntime ?? 'electron'
            proxyEnabled.value = s.proxyEnabled === true
            proxyProtocol.value = s.proxyProtocol ?? DEFAULT_SETTINGS.proxyProtocol
            proxyHost.value = s.proxyHost ?? DEFAULT_SETTINGS.proxyHost
            proxyPort.value = s.proxyPort ?? DEFAULT_SETTINGS.proxyPort
            proxyScope.value = Array.isArray(s.proxyScope) ? [...s.proxyScope] : [...DEFAULT_SETTINGS.proxyScope]
            await loadConfigDir()
            await loadInstalledNode()
            await probeEnv()
        } catch (err) {
            // 初始化失败必须让用户看见原因，否则只剩一个「选项全都不可用」的死界面
            envError.value = errorMessage(err)
        }
    })()
})

onBeforeUnmount(() => {
    offLog?.()
    offDeploy?.()
    offNpm?.()
})
</script>

<template>
    <div class="missing-mask">
        <!--
            向导专属顶部导航栏：**步骤条在左，向导入口与窗口控制在右**。
            向导是覆盖整个窗口的遮罩（z-index 高于应用标题栏），此时标题栏上的窗口按钮
            被完全挡住 —— 安装期间窗口就既不能拖也不能最小化 / 关闭。这里复刻一份
            （窗口按钮直接复用 WindowControls，行为与标题栏完全一致）。
            导航栏整条可拖动窗口，按钮与步骤条区域不可拖。
        -->
        <header class="wiz-navbar">
            <WizardSteps :steps="wizardSteps" :active="step" :percent="overallProgress" />

            <div class="wiz-navbar__acts">
                <el-button size="small" :icon="LinkOutlined" @click="proxyFull = true">{{ $t('dshMissing.proxySettings') }}</el-button>
                <el-button size="small" :icon="FileTextOutlined" @click="logFullscreen = true">{{ $t('dshMissing.viewLog') }}</el-button>
                <span class="divider" />
                <WindowControls />
            </div>
        </header>

        <div class="missing-card">
            <div class="missing-icon"><img :src="appIcon" alt="DeepSeek Box" draggable="false" class="missing-logo" /></div>
            <h2 class="missing-title">{{ $t('dshMissing.title') }}</h2>
            <p class="missing-desc">{{ $t('dshMissing.wizIntro', { pkg: '@deepseek-ai/dsh' }) }}</p>

            <div class="wiz-body">
                <!-- 探测/初始化失败：明确告知原因并提供重试，避免「选项全都不可用」的无解释界面 -->
                <div v-if="envError" class="wiz-err">
                    <span>{{ $t('dshMissing.probeFailed', { err: envError }) }}</span>
                    <el-button size="small" :loading="probingEnv" @click="probeEnv">{{ $t('dshMissing.retry') }}</el-button>
                </div>
                <!-- 第 0 步：先问装法。简易安装会自动跑完后四步，自定义安装逐步选择 -->
                <div v-if="step === 0" class="wiz-pane">
                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.modeTitle') }}</label>
                        <div class="wiz-hint">{{ $t('dshMissing.modeIntro') }}</div>
                    </div>
                    <div class="mode-opts">
                        <button
                            type="button"
                            class="mode-card"
                            :class="{ on: mode === 'simple' }"
                            @click="mode = 'simple'"
                        >
                            <span class="mode-card__head">
                                <span class="mode-card__name">{{ $t('dshMissing.modeSimple') }}</span>
                                <span v-if="mode === 'simple'" class="mode-card__badge">{{ $t('dshMissing.modeSimpleStart') }}</span>
                            </span>
                            <span class="mode-card__desc">{{ $t('dshMissing.modeSimpleDesc') }}</span>
                        </button>
                        <button
                            type="button"
                            class="mode-card"
                            :class="{ on: mode === 'custom' }"
                            @click="mode = 'custom'"
                        >
                            <span class="mode-card__head">
                                <span class="mode-card__name">{{ $t('dshMissing.modeCustom') }}</span>
                            </span>
                            <span class="mode-card__desc">{{ $t('dshMissing.modeCustomDesc') }}</span>
                        </button>
                    </div>
                </div>

                <!-- 第 1 步：镜像源（简易安装下自动测速选源，同时把测速结果展示出来） -->
                <div v-else-if="step === 1" class="wiz-pane">
                    <!-- 测速进行中 / 已出结果：简易安装的核心依据，必须让用户看得见 -->
                    <div v-if="speedTesting || speedResult" class="speed-box">
                        <div class="speed-box__head">
                            <span class="wiz-label">{{ speedTesting ? $t('dshMissing.speedTitle') : speedFailed ? $t('dshMissing.speedFailed') : $t('dshMissing.speedPicked') }}</span>
                            <el-button v-if="!speedTesting && !simpleRunning" size="small" :loading="speedTesting" @click="pickFastestRegistry">
                                {{ $t('dshMissing.speedRetest') }}
                            </el-button>
                        </div>
                        <div v-if="speedTesting || !speedResult || speedResult.samples.length === 0" class="wiz-hint">
                            {{ $t('dshMissing.speedDesc') }}
                        </div>
                        <ul v-if="speedResult" class="speed-list">
                            <li v-for="s in speedResult.samples" :key="s.registry" class="speed-list__row" :class="{ on: s.registry === speedResult.fastest }">
                                <span class="speed-list__name">{{ s.registry === 'npmjs' ? $t('dshMissing.registryNpmjs') : $t('dshMissing.registryNpmmirror') }}</span>
                                <span class="speed-list__ms">{{ s.ms === null ? $t('dshMissing.speedUnavailable') : $t('dshMissing.speedMs', { ms: s.ms }) }}</span>
                            </li>
                        </ul>
                    </div>

                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.registry') }}</label>
                        <el-select v-model="installReg" class="missing-reg">
                            <el-option :label="$t('dshMissing.registryNpmjs')" value="npmjs" />
                            <el-option :label="$t('dshMissing.registryNpmmirror')" value="npmmirror" />
                        </el-select>
                        <div class="wiz-hint">{{ $t('dshMissing.registryHint') }}</div>
                    </div>

                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.configDir') }}</label>
                        <div class="cfg-row">
                            <el-input :model-value="cfgDir" readonly :placeholder="cfgDefaultDir" />
                            <el-button type="primary" @click="pickConfigDir">{{ $t('dshMissing.choose') }}</el-button>
                            <el-button v-if="cfgDir !== cfgDefaultDir" @click="resetConfigDir">{{ $t('dshMissing.restoreDefault') }}</el-button>
                        </div>
                        <div class="wiz-hint">{{ $t('dshMissing.configDirHint') }}</div>
                    </div>
                </div>

                <div v-else-if="step === 2" class="wiz-pane">
                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.node.pick') }}</label>
                        <el-radio-group v-model="nodeRuntimeChoice" class="nr-opts">
                            <el-radio :value="'system'" :disabled="!systemNodeOk">
                                {{ $t('dshMissing.node.runtimeSystem') }}
                                <span v-if="!envProbe || !envProbe.node.present" class="muted">（{{ $t('dshMissing.node.notFound') }}）</span>
                                <span v-else-if="!systemNodeOk" class="muted">（{{ $t('dshMissing.node.need20') }}）</span>
                                <code v-else class="node-ver">{{ envProbe?.node.version }}</code>
                            </el-radio>
                            <el-radio :value="'electron'">
                                {{ $t('dshMissing.node.runtimeElectron') }}
                                <span class="muted">（{{ $t('dshMissing.node.rtDefault') }}）</span>
                            </el-radio>
                            <el-radio :value="'local'">{{ $t('dshMissing.node.runtimeLocal') }}</el-radio>
                        </el-radio-group>
                        <div class="wiz-hint">{{ runtimeHint }}</div>
                    </div>

                    <div v-if="nodeRuntimeChoice === 'local'" class="wiz-field nr-local">
                        <div class="wiz-active">
                            <span class="wiz-hint">{{ $t('sv.env.activeVersion') }}：</span>
                            <code v-if="localNodeActive" class="node-ver">{{ localNodeActive }}</code>
                            <span v-else class="muted">{{ $t('dshMissing.node.notFound') }}</span>
                        </div>
                        <el-tag v-if="envProbe?.local.present" type="success" size="small" effect="plain">
                            {{ $t('dshMissing.node.localReady') }}&nbsp;{{ envProbe.local.version }}
                        </el-tag>
                        <p v-else class="wiz-hint">{{ $t('dshMissing.node.deployHint') }}</p>

                        <div class="wiz-field">
                            <label class="wiz-label">{{ $t('dshMissing.pickNodeVersion') }}</label>
                            <div class="missing-vrow">
                                <el-select
                                    v-model="nodeVersion"
                                    filterable
                                    clearable
                                    :loading="nodeVersionsLoading"
                                    :disabled="deployingNode"
                                    :placeholder="$t('dshMissing.nodeVersionDefault')"
                                    class="missing-reg"
                                >
                                    <el-option v-for="v in nodeVersions" :key="v" :value="v" :label="v" />
                                </el-select>
                                <el-button :icon="ReloadOutlined" circle :loading="nodeVersionsLoading" @click="loadNodeVersions" />
                            </div>
                            <div class="missing-opt">
                                <span>{{ $t('dshMissing.includeNonLts') }}</span>
                                <el-switch v-model="nodeIncludeNonLts" :disabled="deployingNode" />
                            </div>
                        </div>

                        <!-- 下载 / 解压进度：同一时刻只保留一个动画，解压时用不确定动画 -->
                        <template v-if="deployingNode">
                            <template v-if="nodeExtracting">
                                <div class="wiz-hint">{{ $t('dshMissing.extractingNode') }}</div>
                                <div class="activity-bar" />
                            </template>
                            <template v-else>
                                <div class="wiz-hint">{{ $t('dshMissing.node.deploying') }}</div>
                                <el-progress
                                    :percentage="deployPercent"
                                    :status="deployPercent >= 100 ? 'success' : undefined"
                                    :stroke-width="8"
                                    class="deploy-progress"
                                />
                                <div class="wiz-hint deploy-info">{{ deployInfo }}</div>
                            </template>
                            <div class="wiz-btn-row">
                                <el-button size="small" :disabled="canceling" @click="cancelCurrentInstall">
                                    {{ canceling ? $t('dshMissing.canceling') : $t('dshMissing.cancel') }}
                                </el-button>
                            </div>
                        </template>

                        <!-- 部署按钮始终可用：已部署过也允许再装其它版本 -->
                        <div class="wiz-btn-row">
                            <el-button type="primary" :icon="DownloadOutlined" :disabled="deployingNode" @click="deployNode">
                                {{ $t('dshMissing.node.deploy') }}
                            </el-button>
                            <el-button v-if="envProbe?.local.present" size="small" :disabled="deployingNode" @click="deployNode">
                                {{ $t('dshMissing.node.redeploy') }}
                            </el-button>
                            <el-button :icon="ReloadOutlined" :loading="probingEnv" @click="probeEnv">
                                {{ $t('dshMissing.node.rescan') }}
                            </el-button>
                        </div>
                    </div>

                    <p v-else-if="nodeRuntimeChoice === 'system'" class="wiz-note">
                        {{ $t('dshMissing.node.systemNote', { ver: envProbe?.node.version || '' }) }}
                    </p>
                </div>

                <div v-else-if="step === 3" class="wiz-pane">
                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.npmSource') }}</label>
                        <el-radio-group v-model="installNpm" class="npm-opts">
                            <el-radio :value="'system'" :disabled="!envProbe?.npm">
                                {{ $t('dshMissing.npmSystem') }}
                                <span v-if="!envProbe?.npm" class="muted">（{{ $t('dshMissing.unavailable') }}）</span>
                            </el-radio>
                            <el-radio :value="'bundled'">{{ $t('dshMissing.npmBundled') }}</el-radio>
                            <el-radio v-if="envProbe?.local.present" :value="'localnode'">{{ $t('dshMissing.npmLocalNode') }}</el-radio>
                        </el-radio-group>
                        <div class="wiz-hint">{{ $t('dshMissing.npmHint') }}</div>
                    </div>

                    <!-- 「程序内置」npm：未缓存 / 选版本时下一步会先下载 -->
                    <div v-if="installNpm === 'bundled'" class="wiz-field">
                        <template v-if="installingNpm">
                            <template v-if="npmExtracting">
                                <div class="wiz-hint">{{ $t('dshMissing.extractingNpm') }}</div>
                                <div class="activity-bar" />
                            </template>
                            <template v-else>
                                <div class="wiz-hint">{{ $t('dshMissing.npmPreparing') }}</div>
                                <el-progress
                                    :percentage="npmPercent"
                                    :status="npmPercent >= 100 ? 'success' : undefined"
                                    :stroke-width="8"
                                    class="deploy-progress"
                                />
                                <div class="wiz-hint deploy-info">{{ npmInfo }}</div>
                            </template>
                            <div class="wiz-btn-row">
                                <el-button size="small" :disabled="canceling" @click="cancelCurrentInstall">
                                    {{ canceling ? $t('dshMissing.canceling') : $t('dshMissing.cancel') }}
                                </el-button>
                            </div>
                        </template>
                        <template v-else>
                            <div class="wiz-field">
                                <label class="wiz-label">{{ $t('dshMissing.pickNpmVersion') }}</label>
                                <div class="missing-vrow">
                                    <el-select
                                        v-model="npmVersion"
                                        filterable
                                        clearable
                                        :loading="npmVersionsLoading"
                                        :placeholder="$t('dshMissing.npmVersionDefault')"
                                        class="missing-reg"
                                    >
                                        <el-option v-for="v in npmVersions" :key="v" :value="v" :label="v" />
                                    </el-select>
                                    <el-button :icon="ReloadOutlined" circle :loading="npmVersionsLoading" @click="loadNpmVersions" />
                                </div>
                                <div class="missing-opt">
                                    <span>{{ $t('sv.env.includePrerelease') }}</span>
                                    <el-switch v-model="npmIncludePre" />
                                </div>
                            </div>
                            <!-- 未选版本且已缓存才算现成，否则下一步会先下载 -->
                            <div class="wiz-hint">
                                {{
                                    !npmVersion && npmBundledPresent
                                        ? $t('dshMissing.npmBundledReady')
                                        : $t('dshMissing.npmBundledWillDownload')
                                }}
                            </div>
                        </template>
                    </div>
                </div>

                <div v-else class="wiz-pane">
                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.source') }}</label>
                        <el-radio-group v-model="installSource">
                            <el-radio :value="'local'">{{ $t('dshMissing.local') }}</el-radio>
                            <el-radio :value="'global'">{{ $t('dshMissing.global') }}</el-radio>
                        </el-radio-group>
                    </div>
                    <div class="wiz-field">
                        <div class="missing-opt">
                            <span>{{ $t('dshMissing.preLabel') }}</span>
                            <el-switch v-model="installPrerelease" />
                        </div>
                    </div>
                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.version') }}</label>
                        <div class="missing-vrow">
                            <el-select
                                v-model="installVersion"
                                filterable
                                :loading="versionsLoading"
                                class="missing-reg"
                                :placeholder="$t('dshMissing.versionPlaceholder')"
                            >
                                <el-option v-for="v in installVersions" :key="v" :value="v" :label="v" />
                            </el-select>
                            <el-button :icon="ReloadOutlined" circle :loading="versionsLoading" @click="loadInstallVersions" />
                        </div>
                        <div class="wiz-hint">{{ $t('dshMissing.versionHint') }}</div>
                    </div>

                    <p v-if="installError" class="missing-err">{{ installError }}</p>
                </div>
            </div>

            <!-- 简易安装：全程自动，这里说明正在跑以及最终会装哪个版本 -->
            <div v-if="simpleRunning || (simpleVersion && step === 4)" class="simple-note">
                <span class="simple-note__label">{{ simpleRunning ? $t('dshMissing.simpleRunning') : '' }}</span>
                <span v-if="simplePlan" class="simple-note__plan">{{ simplePlan }}</span>
            </div>

            <!-- 执行进度：仅在无专用进度条（Node / npm 下载）时显示，避免重复的加载动画 -->
            <div
                v-if="installingDsh && !deployingNode && !installingNpm && !nodeExtracting && !npmExtracting"
                class="install-progress"
            >
                <div class="activity">
                    <span class="activity__label">{{ installLabel }}</span>
                    <div class="activity-bar" />
                </div>
            </div>

            <div class="wiz-nav">
                <el-button text :disabled="busy" @click="quitShell">{{ $t('dshMissing.quit') }}</el-button>
                <div class="wiz-nav__right">
                    <el-button v-if="step > 0" :disabled="busy" @click="back">{{ $t('dshMissing.prev') }}</el-button>
                    <el-button type="primary" :disabled="busy || primaryDisabled" :loading="simpleRunning" @click="runCurrentStep">
                        {{ primaryLabel }}
                    </el-button>
                </div>
            </div>

            <!-- 全屏代理设置：与「设置 → 网络 → 代理」同一批字段（共用 ProxyFields） -->
            <transition name="fade">
                <div v-if="proxyFull" class="net-full">
                    <div class="net-full__head">
                        <span class="net-full__title">{{ $t('dshMissing.proxySettings') }}</span>
                        <el-button :icon="CloseOutlined" text @click="closeProxySettings">{{ $t('dshMissing.closeLog') }}</el-button>
                    </div>
                    <div class="net-full__body">
                        <el-form label-position="top">
                            <ProxyFields
                                v-model:enabled="proxyEnabled"
                                v-model:protocol="proxyProtocol"
                                v-model:host="proxyHost"
                                v-model:port="proxyPort"
                                v-model:scope="proxyScope"
                            />
                        </el-form>
                        <div class="wiz-hint">{{ $t('dshMissing.netHint') }}</div>
                    </div>
                </div>
            </transition>

            <transition name="fade">
                <div v-if="logFullscreen" class="log-full">
                    <div class="log-full__head">
                        <span class="log-full__title">{{ $t('dshMissing.installLog') }}</span>
                        <div class="log-full__acts">
                            <div v-if="installingDsh" class="log-full__mini">
                                <div class="activity-bar" />
                            </div>
                            <el-button :icon="CloseOutlined" text @click="logFullscreen = false">{{ $t('dshMissing.closeLog') }}</el-button>
                        </div>
                    </div>
                    <pre class="log-full__body">{{ installLog.length ? installLog.join('\n') : $t('dshMissing.logWaiting') }}</pre>
                </div>
            </transition>
        </div>
    </div>
</template>

<style scoped>
.missing-mask {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    /* safe center：卡片比窗口高时不再把顶部裁掉（加了网络设置后第 0 步明显变长）；
        高度够用时表现与 center 完全一致。 */
    align-items: safe center;
    justify-content: center;
    overflow: auto;
    /* 顶部让出专属导航栏的高度，否则卡片会被导航栏压住 */
    padding: var(--titlebar-h, 52px) 0 24px;
    background: var(--el-bg-color);
}
.missing-card {
    width: 560px;
    max-width: calc(100% - 48px);
    text-align: center;
}
.missing-icon {
    width: 84px;
    height: 84px;
    margin: 0 auto 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 22px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.missing-logo {
    width: 64px;
    height: 64px;
    object-fit: contain;
    -webkit-user-drag: none;
}
.missing-title {
    margin: 0 0 10px;
    font-size: 18px;
}
.missing-desc {
    margin: 0 0 18px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--el-text-color-secondary);
}
.missing-reg {
    width: 100%;
    margin-bottom: 8px;
}
.missing-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--el-text-color-regular);
}
.missing-vrow {
    display: flex;
    align-items: center;
    gap: 8px;
}
.missing-vrow .missing-reg {
    flex: 1 1 auto;
    margin-bottom: 0;
}
.missing-err {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--el-color-danger);
    word-break: break-all;
}
/* ---- 首次安装引导 ---- */
/*
 * 专属导航栏：高度与下边框都对齐应用标题栏（同一 --titlebar-h 变量），
 * 这样「向导盖住标题栏」时视觉上是同一条栏，不会跳一下。
 * 整条可拖动窗口；内部的按钮与步骤条各自关闭拖动。
 */
.wiz-navbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2001;
    height: var(--titlebar-h, 52px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    /* 右侧不留内边距：窗口按钮像系统标题栏那样贴住窗口右边缘 */
    padding: 0 10px 0 14px;
    /* 下边框用 inset 阴影画，不占布局高度（与 TitleBar 一致） */
    box-shadow: inset 0 -1px 0 var(--el-border-color-light);
    background: var(--el-bg-color);
    -webkit-app-region: drag;
    user-select: none;
}
/* 步骤条自带宽度与收缩策略（见 WizardSteps.vue），这里只保证它靠左不挤右侧按钮 */
.wiz-navbar__acts {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
}
/* 导航栏里的按钮可点不可拖 */
.wiz-navbar__acts :deep(.el-button) {
    -webkit-app-region: no-drag;
}
.wiz-body {
    text-align: left;
    min-height: 170px;
}
.wiz-pane {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
/* 探测/初始化失败提示：与字段同宽，左对齐，重试按钮跟在文字后面 */
.wiz-err {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--el-color-danger-light-5);
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
    font-size: 12px;
    line-height: 1.6;
}
.wiz-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
/* ---- 第 0 步：安装方式二选一 ---- */
.mode-opts {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.mode-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 12px 14px;
    text-align: left;
    border: 1px solid var(--el-border-color);
    border-radius: 10px;
    background: var(--el-bg-color);
    cursor: pointer;
    transition:
        border-color 0.18s ease,
        background 0.18s ease;
}
.mode-card:hover {
    border-color: var(--el-color-primary-light-5);
    background: var(--el-fill-color-lighter);
}
/* 选中态：整张卡片高亮，而不是只给个小圆点 —— 后面四步的策略全靠这一次选择 */
.mode-card.on {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
.mode-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}
.mode-card__name {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}
.mode-card.on .mode-card__name {
    color: var(--el-color-primary);
}
.mode-card__badge {
    font-size: 11px;
    color: var(--el-color-primary);
}
.mode-card__desc {
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
/* ---- 镜像源测速结果 ---- */
.speed-box {
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-light);
}
.speed-box__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
}
.speed-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.speed-list__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
/* 选中的源加粗高亮，用户能一眼看出「为什么装这个源」 */
.speed-list__row.on {
    color: var(--el-color-primary);
    font-weight: 600;
}
.speed-list__ms {
    font-family: var(--el-font-family-mono);
}
/* ---- 简易安装进度说明 ---- */
.simple-note {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--el-color-primary-light-9);
    font-size: 12px;
    color: var(--el-color-primary);
}
.simple-note__label {
    flex: 0 0 auto;
    font-weight: 600;
}
.simple-note__plan {
    flex: 1 1 auto;
    text-align: right;
    color: var(--el-text-color-regular);
}
.wiz-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-regular);
}
.wiz-hint {
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
}
.wiz-note {
    margin: 10px 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
    text-align: left;
}
.wiz-active {
    display: flex;
    align-items: center;
    gap: 6px;
}
.npm-opts {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
}
.nr-opts {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
}
.nr-opts .el-radio {
    height: auto;
    white-space: normal;
    margin-right: 0;
}
.nr-local {
    margin-top: 2px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: var(--el-border-radius-base);
    background: var(--el-fill-color-light);
}
.deploy-progress {
    width: 100%;
}
.muted {
    color: var(--el-text-color-disabled);
    font-size: 12px;
}
.wiz-btn-row {
    display: flex;
    gap: 10px;
}
.wiz-nav {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--el-border-color-lighter);
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.wiz-nav__right {
    display: flex;
    gap: 10px;
}
.cfg-row {
    display: flex;
    gap: 8px;
}
.cfg-row .el-input {
    flex: 1 1 auto;
}
.node-ver {
    font-family: var(--el-font-family-mono);
    font-size: 13px;
    background: var(--el-fill-color-light);
    padding: 2px 6px;
    border-radius: 4px;
}
/* ---- 安装进度条（npm / DSH 活动条） ---- */
.install-progress {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
}
.activity {
    display: flex;
    align-items: center;
    gap: 10px;
}
.activity__label {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-regular);
    white-space: nowrap;
}
.activity-bar {
    position: relative;
    flex: 1 1 auto;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--el-fill-color);
}
.activity-bar::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 40%;
    border-radius: 4px;
    background: var(--el-color-primary);
    animation: bar-slide 1.1s ease-in-out infinite;
}
@keyframes bar-slide {
    0% {
    left: -40%;
    }
    100% {
    left: 100%;
    }
}
/* ---- 全屏面板 ---- */
/* 全屏面板（代理设置）：与全屏日志同构，只是内容是表单而不是等宽文本 */
.net-full {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    flex-direction: column;
    background: var(--el-bg-color);
}
.net-full__head {
    flex: 0 0 auto;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid var(--el-border-color-light);
}
.net-full__title {
    font-weight: 600;
    font-size: 15px;
}
/* 表单在宽屏下限宽居中，避免输入框被拉成一整行 */
.net-full__body {
    flex: 1 1 auto;
    overflow: auto;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 20px 24px 28px;
}
.net-full__body :deep(.el-form-item) {
    margin-bottom: 14px;
}
.net-full__body :deep(.el-form-item__label) {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-regular);
}
/* ---- 全屏安装日志 ---- */
.log-full {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    flex-direction: column;
    background: var(--el-bg-color);
}
.log-full__head {
    flex: 0 0 auto;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid var(--el-border-color-light);
}
.log-full__title {
    font-weight: 600;
    font-size: 15px;
}
.log-full__acts {
    display: flex;
    align-items: center;
    gap: 16px;
}
.log-full__mini {
    width: 180px;
}
.log-full__body {
    flex: 1 1 auto;
    margin: 0;
    overflow: auto;
    padding: 12px 16px;
    font-family: var(--el-font-family-mono);
    font-size: 12.5px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--el-text-color-regular);
}
/* ---- 过渡 ---- */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
