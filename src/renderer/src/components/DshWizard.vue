<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeftOutlined, CloseOutlined, DownloadOutlined, ReloadOutlined, ThunderboltOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { EnvProbe, NodeRuntimeKind, NpmSource, RegistrySpeedResult } from '@shared/types'
import { MIN_NODE_MAJOR, isPrerelease, nodeMajor } from '@shared/version'
import { errorMessage } from '@shared/errors'
import { useAppIcon } from '../lib/appIcon'
import { formatDownload } from '../lib/format'
import { refreshOperations, useOperation } from '../shell/progressStore'
import WizardSteps from './WizardSteps.vue'

/**
 * @deepseek-ai/dsh 包缺失时的安装向导（初始化页的主体）。
 *
 * **顶部不再自带导航栏**：初始化页已是 App 里的独立路由（`/setup`，见 views/SetupView.vue），
 * 与设置页同级叠在 web 宿主之上，顶部与底部就是全局 TitleBar 与 StatusBar。原先那条专属导航栏
 * 只把**步骤条**下移到底部（`.wiz-footbar`），窗口按钮交还标题栏。
 *
 * **「安装设置」与「安装日志」两个入口已取消**：镜像源 / 配置目录 / 代理本就是设置页里的同一批
 * 设置，dsh 的输出流也一直显示在设置页的「终端」里 —— 统一从标题栏进设置页看与改，向导不再
 * 重复实现一份（也正因为标题栏不再被遮挡，安装前要配代理时直接去设置页即可）。
 *
 * 它自带完整状态（五步流程 / 环境探测 / 版本选择 / 安装进度），与外壳其余部分只通过「装完了」一点
 * 耦合。每次挂载都会重新探测环境并把步骤归零：安装途中切去设置页再回来，界面会从头显示 —— 安装
 * 本身跑在主进程，不受影响。
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
// ---- 首次安装引导 ---------------------------------------------------
// 0 安装方式 · 1 镜像源 · 2 Node 环境 · 3 NPM 环境 · 4 DSH 环境
// 第 0 步决定后面是「简易安装」自动跑完 1–4，还是「自定义安装」由用户逐步选择。
const step = ref(0)

/** 安装方式：简易（自动）/ 自定义（逐步）；null = 尚未选择。 */
type InstallMode = 'simple' | 'custom'
const mode = ref<InstallMode | null>(null)

/**
 * 步骤定义（下标即 `step` 的取值，0–4）：
 *   0 安装方式 · 1 安装设置 · 2 Node 环境 · 3 NPM 环境 · 4 DSH 环境
 *
 * 第 1 步的 key 仍叫 `source`：它最初只放镜像源，现在镜像源与配置目录都收进了
 * 「安装设置」面板，这一步只展示测速结果与当前设置摘要。改名会牵动 i18n 键、
 * watch 与各 v-if，收益只是个更贴切的名字，故保持不变。
 */
const STEP_KEYS = ['mode', 'source', 'node', 'npm', 'dsh'] as const

/**
 * 各下拉框的选项。
 * antdv-next 的 `a-select` 用 `:options` 而不是子组件 `<a-option>`：
 * 选项少且是纯数据时，一个数组比一层嵌套模板好读，也省掉每个选项一行 `$t`。
 */
const npmVersionOptions = computed(() => npmVersions.value.map((v) => ({ value: v, label: v })))
const dshVersionOptions = computed(() => installVersions.value.map((v) => ({ value: v, label: v })))
/** 步骤条的分段：文字取自 i18n，与 STEP_KEYS 一一对应。 */
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
        : npmPreparing.value
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

// 所选 Node 运行时（安装时随设置持久化）。默认本地部署（初始化时自动选最新 LTS）。
const nodeRuntimeChoice = ref<NodeRuntimeKind>('local')
/** 本向导自己发起的 Node 部署在途标记（按钮 / 文案用）。 */
const deployingNode = ref(false)
/**
 * 进度来自**共享 store**（shell/progressStore）：向导切走（例如用户跑去设置页看日志）再回来时，
 * 主进程里的下载还在跑，靠 store 的快照就能立刻把进度条接着画出来。
 */
const { op: nodeWizardOp } = useOperation('node')
const nodeExtracting = computed(() => nodeWizardOp.value?.phase === 'extract')
const deployPercent = computed(() => nodeWizardOp.value?.percent ?? 0)
/** 进度条下方的「已下载 / 总大小 · 速度」。 */
const deployInfo = computed(() =>
    formatDownload(nodeWizardOp.value?.total ?? 0, nodeWizardOp.value?.downloaded ?? 0, nodeWizardOp.value?.speed ?? 0)
)

// 「程序内置」npm：第 2 步选中且尚未缓存时，点下一步先下载再继续（进度由主进程广播）。
const npmBundledPresent = ref(false)
const { op: npmWizardOp } = useOperation('npm')
/** 本向导自己发起的 npm 准备在途标记。 */
const npmPreparing = ref(false)
const npmExtracting = computed(() => npmWizardOp.value?.phase === 'extract')
const npmPercent = computed(() => npmWizardOp.value?.percent ?? 0)
const npmInfo = computed(() =>
    formatDownload(npmWizardOp.value?.total ?? 0, npmWizardOp.value?.downloaded ?? 0, npmWizardOp.value?.speed ?? 0)
)

// ---- Node 版本选择（第 2 步）------------------------------------------------
// 合并前的三处信息（可下载版本 / 已装版本 / 当前生效版本）现在都进同一个选择器：
// 每个选项自带「已安装」「当前使用」标记，用户不必再对照另一块表单看状态。
const nodeVersions = ref<string[]>([])
const nodeVersionsLoading = ref(false)
const nodeIncludeNonLts = ref(false)
const nodeVersion = ref('')
/** 已下载到配置目录的本地 Node 版本（来自 /versions/node）。 */
const nodeInstalled = ref<string[]>([])
/** 当前生效的本地 Node 版本。 */
const nodeActiveVersion = ref<string | null>(null)
/** 当前生效的本地 Node 版本：优先环境探测，其次已安装版本列表。 */
const localNodeActive = computed(() => envProbe.value?.local.version ?? nodeActiveVersion.value)

/** 选中项是否已经装在本地（决定下一步是「部署」还是「切换生效版本」）。 */
const selectedNodeInstalled = computed(() => !!nodeVersion.value && nodeInstalled.value.includes(nodeVersion.value))
/** 选中项是否就是当前生效的版本。 */
const selectedNodeIsActive = computed(() => !!nodeVersion.value && nodeVersion.value === localNodeActive.value)

/**
 * 选择器的选项：可下载版本 ∪ 已安装版本，按 semver 降序，逐个打标记。
 *
 * 必须**并集**而不是只用远端列表：用户可能处于离线状态、或某个已装版本的发布条目
 * 已经不在远端列表里 —— 只列远端会让「已安装且正在用」的版本在选择器里找不到，
 * 一打开这一步看起来就像什么都没装。
 */
const nodeVersionOptions = computed(() => {
    const tagsOf = (v: string): { label: string; color: string }[] => {
        const tags: { label: string; color: string }[] = []
        if (v === localNodeActive.value) tags.push({ label: t('dshMissing.node.tagActive'), color: 'green' })
        else if (nodeInstalled.value.includes(v)) tags.push({ label: t('dshMissing.node.tagInstalled'), color: 'blue' })
        return tags
    }
    // 已装的版本可能不在远端列表里（离线、或发布条目已撤），这些也要排进去。
    // 远端列表本身已是 semver 降序，这里只做稳定合并：远端在前，补上它没覆盖到的已装版本。
    const ordered = [
        ...nodeVersions.value,
        ...nodeInstalled.value.filter((v) => !nodeVersions.value.includes(v)).sort().reverse()
    ]
    return ordered.map((v) => ({ value: v, label: v, tags: tagsOf(v) }))
})

/**
 * 检查版本：把主进程的版本列表、已装版本、当前生效版本一次全刷一遍。
 *
 * 合并了原来分开的两个动作 —— 「重新检测」（只刷环境探测）与版本下拉旁的刷新按钮
 * （只刷远端列表）。两者用户根本分不清，且总是想同时要最新结果。
 */
async function recheckNode(): Promise<void> {
    await Promise.all([loadNodeVersions(), loadInstalledNode(), probeEnv()])
}

/** 拉取已安装 / 生效的本地 Node 版本。 */
async function loadInstalledNode(): Promise<void> {
    try {
        const r = await window.api.get('/versions/:kind', { params: { kind: 'node' } })
        nodeInstalled.value = r.installed
        nodeActiveVersion.value = r.active
    } catch {
        nodeInstalled.value = []
        nodeActiveVersion.value = null
    }
}

// ---- npm 版本选择（第 2 步「程序内置」）----
const npmVersions = ref<string[]>([])
const npmVersionsLoading = ref(false)
const npmIncludePre = ref(false)
const npmVersion = ref('')

// 解压阶段改用不确定动画（不显示百分比）；取消进行中禁用「取消」按钮。
// 注意：nodeExtracting / npmExtracting 已在上方由共享 store 派生，不要在这里再定义。
const canceling = ref(false)

/** 没有专用进度条（Node / npm 下载）时，通用执行条的文案。 */
const installLabel = computed(() => (step.value === 4 ? t('dshMissing.progressDsh') : t('dshMissing.executing')))

/** 安装 / 测速期间：禁用一切会改变流程的按钮。 */
const busy = computed(() => installingDsh.value || simpleRunning.value || speedTesting.value)

/** 第 0 步还没选装法时，主按钮不可点（否则点了也没反应，像是坏了）。 */
const primaryDisabled = computed(() => step.value === 0 && mode.value === null)

/**
 * 主按钮文案：只留最短的动词 —— 「开始 / 下一步 / 安装」。
 *
 * 原先第 0 步在简易模式下显示「开始简易安装」（5 字）、其余步显示「执行并下一步」（5 字）。
 * 这两个说法都在描述**按钮会怎么工作**，而用户只想知道「按下去会怎样」：
 * 要么前进、要么开始、要么装上。图标再补一层语义（闪电=自动开始，下载=安装）。
 */
const primaryLabel = computed(() => {
    if (step.value === 0) return t('dshMissing.start')
    return step.value < 4 ? t('dshMissing.next') : t('dshMissing.install')
})

/** 主按钮图标：开始=闪电（自动跑完），安装=下载，其余=无（「下一步」语义已足够清楚）。 */
const primaryIcon = computed(() => {
    if (step.value === 0) return ThunderboltOutlined
    return step.value >= 4 ? DownloadOutlined : null
})

/** 简易安装期间显示的说明：最终会装哪个版本（含「没有正式版」的提示）。 */
const simplePlan = computed(() => {
    if (!simpleVersion.value) return ''
    return simplePrerelease.value
        ? t('dshMissing.simplePlanPrerelease', { version: simpleVersion.value })
        : t('dshMissing.simplePlanStable', { version: simpleVersion.value })
})

const runtimeHint = computed(() => {
    return nodeRuntimeChoice.value === 'system'
        ? t('dshMissing.node.hintSystem')
        : t('dshMissing.node.hintLocal')
})

async function deployOnce(version?: string): Promise<boolean> {
    if (deployingNode.value) return false
    deployingNode.value = true
    canceling.value = false
    try {
        const r = await window.api.post('/node/deploy', { body: version ? { version } : {} })
        if (r.canceled) {
            // 用户主动取消：不算失败，也不弹错误提示。
            ElMessage.info(r.message || t('dshMissing.cancel'))
            return false
        }
        if (r.ok) {
            // 装完把选择器定到刚装好的版本：否则列表刷新后它可能停在别处，
            // 「已安装 / 当前使用」标记看起来就像打错了地方。
            if (version) nodeVersion.value = version
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
        canceling.value = false
        // 操作已结束：刷新快照把进度收起（事件流不含结束信号）。
        await refreshOperations()
        // 部署完要同时刷新「环境探测」与「已装 / 生效列表」—— 选择器上的标记依赖后者。
        await Promise.all([probeEnv(), loadInstalledNode()])
    }
}
/**
 * 把已安装的本地 Node 版本切成「当前生效」。
 * 已装过的版本不该再走一遍下载 —— 那既慢又没必要，用户想要的只是切过去。
 */
async function activateNode(version: string): Promise<boolean> {
    try {
        const r = await window.api.put('/versions/:kind/active', { params: { kind: 'node' }, body: { version } })
        if (!r.ok) {
            ElMessage.error(r.message)
            return false
        }
        ElMessage.success(r.message)
        await Promise.all([loadInstalledNode(), probeEnv()])
        return true
    } catch (err) {
        ElMessage.error(errorMessage(err))
        return false
    }
}

/**
 * 确保「本地 Node」就绪：选中的版本已安装就切为生效版本（不重下），
 * 否则按选中版本部署；未选版本时由主进程默认部署最新 LTS。
 */
async function ensureLocalNode(): Promise<boolean> {
    if (nodeVersion.value && selectedNodeInstalled.value) {
        return selectedNodeIsActive.value || activateNode(nodeVersion.value)
    }
    return deployOnce(nodeVersion.value || undefined)
}

/** 确保「程序内置」npm 就绪：已缓存直接通过，未缓存 / 指定版本则先下载（带进度）再进入下一步。 */
async function ensureNpmOnce(version?: string): Promise<boolean> {
    canceling.value = false
    npmPreparing.value = true
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
        npmPreparing.value = false
        canceling.value = false
        await refreshOperations()
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

/**
 * 拉取可部署的 Node 版本（新 → 旧）；默认只 LTS，勾选后含 Current，默认选中最新一项。
 *
 * 这里用共享 promise 去重：watch(step) 与调用方可能几乎同时请求，早退会让
 * 「简易安装」拿到还没填好的版本列表。并发调用共享同一次请求、都能等到结果。
 */
let nodeVersionsPromise: Promise<void> | null = null
async function loadNodeVersions(): Promise<void> {
    if (nodeVersionsPromise) return nodeVersionsPromise
    const p = (async () => {
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
    })().finally(() => {
        if (nodeVersionsPromise === p) nodeVersionsPromise = null
    })
    nodeVersionsPromise = p
    return p
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
        // 选了系统 Node 但实际不可用（<20 / 缺失）时回退到默认的本地部署。
        if (envProbe.value && nodeRuntimeChoice.value === 'system' && !systemNodeOk.value) {
            nodeRuntimeChoice.value = 'local'
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
/** 配置目录只读展示：摘要要显示当前值与默认值，改则在设置页里改。 */
// ---- 安装设置 ----
// 镜像源 / 配置目录 / 代理**不在向导里提供编辑入口**：它们就是设置页里的同一批设置
// （网络 / 环境等面板），统一从标题栏进设置页改 —— 标题栏现在不再被向导遮挡。
// 向导只负责：读现值用于本次安装、把测速选出的镜像源写回去（见 persistWizard）。


const back = (): void => {
    if (step.value > 0) step.value = step.value - 1
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
                npmSource: installSource.value === 'local' ? installNpm.value : cur.npmSource
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
            // 本地 Node：这一步的提交就是「把它安排好」——
            // 选中的版本已装过就只切成生效版本（不重新下载），没装过才真的去部署。
            // 合并前用户得先按「下载并部署」再按「下一步」，同一件事分两步做。
            if (ok && nodeRuntimeChoice.value === 'local') {
                ok = await ensureLocalNode()
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
 *  2. Node：本地部署最新 LTS（已装则只切换生效版本）；
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

        // 2) Node：部署最新 LTS（LTS 列表首项即最新；已装则只切换生效版本）
        step.value = 2
        nodeRuntimeChoice.value = 'local'
        // dsh 装进配置目录（应用默认），全程不碰用户的全局 npm。
        installSource.value = 'local'
        await loadNodeVersions()
        await loadInstalledNode()
        if (!(await persistWizard())) return
        if (!(await ensureLocalNode())) return

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

onMounted(() => {
    // 进度订阅已上移到外壳启动处（shell/progressStore）—— 这里只补一次快照，
    // 把「向导挂载前就已经在跑」的操作接上（例如用户从设置页环境面板发起部署后又回到向导）。
    void refreshOperations()
    void (async () => {
        try {
            const s = await window.api.get('/settings')
            installReg.value = s.npmRegistry
            installPrerelease.value = s.checkPrerelease === true
            installSource.value = s.dshSource ?? 'local'
            installNpm.value = s.npmSource ?? 'system'
            nodeRuntimeChoice.value = s.nodeRuntime ?? 'local'
            await loadConfigDir()
            await loadInstalledNode()
            await probeEnv()
        } catch (err) {
            // 初始化失败必须让用户看见原因，否则只剩一个「选项全都不可用」的死界面
            envError.value = errorMessage(err)
        }
    })()
})
</script>

<template>
    <!--
        初始化页的舞台：顶部与底部是全局 TitleBar / StatusBar（本页不再自带导航栏与窗口控制），
        因此只需铺满中间的内容区（.web-overlay）；步骤条在底部那条 .wiz-footbar 里。
    -->
    <div class="missing-mask">
        <div class="missing-card">
            <div class="missing-icon"><img :src="appIcon" alt="DeepSeek Box" draggable="false" class="missing-logo" /></div>
            <h2 class="missing-title">{{ $t('dshMissing.title') }}</h2>
            <p class="missing-desc">{{ $t('dshMissing.wizIntro', { pkg: '@deepseek-ai/dsh' }) }}</p>

            <div class="wiz-body">
                <!-- 探测/初始化失败：明确告知原因并提供重试，避免「选项全都不可用」的无解释界面 -->
                <div v-if="envError" class="wiz-err">
                    <span>{{ $t('dshMissing.probeFailed', { err: envError }) }}</span>
                    <a-button size="small" :loading="probingEnv" @click="probeEnv">{{ $t('dshMissing.retry') }}</a-button>
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

                <!--
                    第 1 步：安装设置。
                    镜像源与配置目录已移入「安装设置」面板（导航栏图标进入），这一步只负责
                    把**自动测速的结果**摆出来 —— 它是简易安装选源的依据，用户有权看到为什么选它。
                    需要手动改源或配置目录时，点导航栏的设置图标。
                -->
                <div v-else-if="step === 1" class="wiz-pane">
                    <div class="speed-box">
                        <div class="speed-box__head">
                            <span class="wiz-label">{{ speedTesting ? $t('dshMissing.speedTitle') : speedFailed ? $t('dshMissing.speedFailed') : $t('dshMissing.speedPicked') }}</span>
                            <a-button v-if="!speedTesting && !simpleRunning" size="small" :loading="speedTesting" @click="pickFastestRegistry">
                                <template #icon><ReloadOutlined /></template>
                                {{ $t('dshMissing.speedRetest') }}
                            </a-button>
                        </div>
                        <div v-if="speedTesting || !speedResult || speedResult.samples.length === 0" class="wiz-hint">
                            {{ $t('dshMissing.speedDesc') }}
                        </div>
                        <!-- 多轮测速的规则要说出来，否则「3 轮」这种数字看着像噪声 -->
                        <div v-else class="wiz-hint">{{ $t('dshMissing.speedRoundsHint') }}</div>
                        <ul v-if="speedResult" class="speed-list">
                            <li v-for="s in speedResult.samples" :key="s.registry" class="speed-list__row" :class="{ on: s.registry === speedResult.fastest }">
                                <span class="speed-list__name">{{ s.registry === 'npmjs' ? $t('dshMissing.registryNpmjs') : $t('dshMissing.registryNpmmirror') }}</span>
                                <span class="speed-list__right">
                                    <!-- 轮次明细：多轮测速的意义就在于此，把「最快那一轮」与失败轮都摆出来 -->
                                    <span v-if="s.rounds.length > 1" class="speed-list__rounds">
                                        {{
                                            $t('dshMissing.speedRounds', {
                                                ok: s.okRounds,
                                                total: s.totalRounds,
                                                list: s.rounds.map((r) => (r === null ? '—' : r)).join(' / ')
                                            })
                                        }}
                                    </span>
                                    <span class="speed-list__ms">{{ s.ms === null ? $t('dshMissing.speedUnavailable') : $t('dshMissing.speedMs', { ms: s.ms }) }}</span>
                                </span>
                            </li>
                        </ul>
                    </div>

                    <!-- 当前生效的设置摘要：不必开面板也看得到这次会用什么源、装到哪 -->
                    <div class="cfg-summary">
                        <div class="cfg-summary__row">
                            <span class="cfg-summary__k">{{ $t('dshMissing.registry') }}</span>
                            <span class="cfg-summary__v">{{ installReg === 'npmjs' ? $t('dshMissing.registryNpmjs') : $t('dshMissing.registryNpmmirror') }}</span>
                        </div>
                        <div class="cfg-summary__row">
                            <span class="cfg-summary__k">{{ $t('dshMissing.configDir') }}</span>
                            <span class="cfg-summary__v" :title="cfgDir">{{ cfgDir || cfgDefaultDir }}</span>
                        </div>
                        <!-- 改这些设置请从标题栏进设置页：向导不再自带一份入口 -->
                        <div class="wiz-hint cfg-summary__note">{{ $t('dshMissing.settingsGlobalHint') }}</div>
                    </div>
                </div>

                <!--
                    第 2 步：Node 环境。
                    两种运行时（系统自带 / 本地部署，默认后者）统一成一组单选：
                    版本选择、已装标记、生效标记都收进同一个选择器，按钮只剩「检查版本」。
                -->
                <div v-else-if="step === 2" class="wiz-pane">
                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.node.pick') }}</label>
                        <a-radio-group v-model:value="nodeRuntimeChoice" class="nr-opts">
                            <a-radio value="system" :disabled="!systemNodeOk">
                                {{ $t('dshMissing.node.runtimeSystem') }}
                                <span v-if="!envProbe || !envProbe.node.present" class="muted">（{{ $t('dshMissing.node.notFound') }}）</span>
                                <span v-else-if="!systemNodeOk" class="muted">（{{ $t('dshMissing.node.need20') }}）</span>
                            </a-radio>
                            <a-radio value="local">
                                {{ $t('dshMissing.node.runtimeLocal') }}
                                <a-tag class="rt-tag" color="blue">{{ $t('dshMissing.node.rtDefault') }}</a-tag>
                            </a-radio>
                        </a-radio-group>
                        <div class="wiz-hint">{{ runtimeHint }}</div>
                    </div>

                    <!-- 系统 Node 的版本：只在选中系统运行时时展示，避免和本地版本选择器重复 -->
                    <p v-if="nodeRuntimeChoice === 'system'" class="wiz-note">
                        {{ $t('dshMissing.node.systemNote', { ver: envProbe?.node.version || '' }) }}
                    </p>

                    <!-- 本地 Node：版本列表 + 「已安装 / 当前使用」标记 + 检查版本，全部收在一处 -->
                    <div v-else-if="nodeRuntimeChoice === 'local'" class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.pickNodeVersion') }}</label>
                        <div class="missing-vrow">
                            <a-select
                                v-model:value="nodeVersion"
                                :options="nodeVersionOptions"
                                :loading="nodeVersionsLoading"
                                :disabled="deployingNode"
                                :placeholder="$t('dshMissing.nodeVersionDefault')"
                                class="missing-reg"
                                show-search
                                allow-clear
                            >
                                <!--
                                    自定义选项渲染：版本号 + 「已安装 / 当前使用」标签。
                                    ⚠️ 必须是 #optionRender（入参 { option, info }），不是 #option ——
                                    antdv-next 的 SelectSlots 里没有 option 这个槽，写错了不报错、只是静默不生效。
                                -->
                                <template #optionRender="{ option }">
                                    <span class="node-opt">
                                        <span class="node-opt__ver">{{ option.label }}</span>
                                        <a-tag v-for="tg in option.tags" :key="tg.label" :color="tg.color" class="node-opt__tag">
                                            {{ tg.label }}
                                        </a-tag>
                                    </span>
                                </template>
                            </a-select>
                            <a-button :loading="nodeVersionsLoading" @click="recheckNode">
                                <template #icon><ReloadOutlined /></template>
                                {{ $t('dshMissing.node.checkVersion') }}
                            </a-button>
                        </div>
                        <div class="missing-opt">
                            <span>{{ $t('dshMissing.includeNonLts') }}</span>
                            <a-switch v-model:checked="nodeIncludeNonLts" :disabled="deployingNode" />
                        </div>
                        <!-- 已装数量：把「这台机器上有什么」说清楚，避免用户以为要重新下载 -->
                        <div v-if="nodeInstalled.length" class="wiz-hint">
                            {{ $t('dshMissing.node.installedCount', { n: nodeInstalled.length }) }}
                        </div>
                        <!-- 选中项是「已安装但非当前生效」时，说明下一步会把它切成生效版本 -->
                        <div v-if="selectedNodeInstalled && !selectedNodeIsActive" class="wiz-hint">
                            {{ $t('dshMissing.node.willSwitch') }}
                        </div>
                    </div>

                    <!-- 下载 / 解压进度：同一时刻只保留一个，解压阶段没有百分比 -->
                    <template v-if="deployingNode">
                        <template v-if="nodeExtracting">
                            <div class="wiz-hint">{{ $t('dshMissing.extractingNode') }}</div>
                            <div class="activity-bar" />
                        </template>
                        <template v-else>
                            <div class="wiz-hint">{{ $t('dshMissing.node.deploying') }}</div>
                            <a-progress
                                :percent="deployPercent"
                                :status="deployPercent >= 100 ? 'success' : 'active'"
                                :stroke-width="8"
                                class="deploy-progress"
                            />
                            <div class="wiz-hint deploy-info">{{ deployInfo }}</div>
                        </template>
                        <div class="wiz-btn-row">
                            <a-button size="small" :disabled="canceling" @click="cancelCurrentInstall">
                                {{ canceling ? $t('dshMissing.canceling') : $t('dshMissing.cancel') }}
                            </a-button>
                        </div>
                    </template>
                </div>

                <div v-else-if="step === 3" class="wiz-pane">
                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.npmSource') }}</label>
                        <a-radio-group v-model="installNpm" class="npm-opts">
                            <a-radio :value="'system'" :disabled="!envProbe?.npm">
                                {{ $t('dshMissing.npmSystem') }}
                                <span v-if="!envProbe?.npm" class="muted">（{{ $t('dshMissing.unavailable') }}）</span>
                            </a-radio>
                            <a-radio :value="'bundled'">{{ $t('dshMissing.npmBundled') }}</a-radio>
                            <a-radio v-if="envProbe?.local.present" :value="'localnode'">{{ $t('dshMissing.npmLocalNode') }}</a-radio>
                        </a-radio-group>
                        <div class="wiz-hint">{{ $t('dshMissing.npmHint') }}</div>
                    </div>

                    <!-- 「程序内置」npm：未缓存 / 选版本时下一步会先下载 -->
                    <div v-if="installNpm === 'bundled'" class="wiz-field">
                        <template v-if="npmPreparing">
                            <template v-if="npmExtracting">
                                <div class="wiz-hint">{{ $t('dshMissing.extractingNpm') }}</div>
                                <div class="activity-bar" />
                            </template>
                            <template v-else>
                                <div class="wiz-hint">{{ $t('dshMissing.npmPreparing') }}</div>
                                <a-progress
                                    :percentage="npmPercent"
                                    :status="npmPercent >= 100 ? 'success' : undefined"
                                    :stroke-width="8"
                                    class="deploy-progress"
                                />
                                <div class="wiz-hint deploy-info">{{ npmInfo }}</div>
                            </template>
                            <div class="wiz-btn-row">
                                <a-button size="small" :disabled="canceling" @click="cancelCurrentInstall">
                                    {{ canceling ? $t('dshMissing.canceling') : $t('dshMissing.cancel') }}
                                </a-button>
                            </div>
                        </template>
                        <template v-else>
                            <div class="wiz-field">
                                <label class="wiz-label">{{ $t('dshMissing.pickNpmVersion') }}</label>
                                <div class="missing-vrow">
                                    <a-select
                                        v-model:value="npmVersion"
                                        :options="npmVersionOptions"
                                        :loading="npmVersionsLoading"
                                        :placeholder="$t('dshMissing.npmVersionDefault')"
                                        class="missing-reg"
                                        show-search
                                        allow-clear
                                    />
                                    <a-button :icon="ReloadOutlined" circle :loading="npmVersionsLoading" @click="loadNpmVersions" />
                                </div>
                                <div class="missing-opt">
                                    <span>{{ $t('sv.env.includePrerelease') }}</span>
                                    <a-switch v-model:checked="npmIncludePre" />
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
                        <a-radio-group v-model="installSource">
                            <a-radio :value="'local'">{{ $t('dshMissing.local') }}</a-radio>
                            <a-radio :value="'global'">{{ $t('dshMissing.global') }}</a-radio>
                        </a-radio-group>
                    </div>
                    <div class="wiz-field">
                        <div class="missing-opt">
                            <span>{{ $t('dshMissing.preLabel') }}</span>
                            <a-switch v-model:checked="installPrerelease" />
                        </div>
                    </div>
                    <div class="wiz-field">
                        <label class="wiz-label">{{ $t('dshMissing.version') }}</label>
                        <div class="missing-vrow">
                            <a-select
                                v-model:value="installVersion"
                                :options="dshVersionOptions"
                                :loading="versionsLoading"
                                class="missing-reg"
                                :placeholder="$t('dshMissing.versionPlaceholder')"
                                show-search
                            />
                            <a-button :icon="ReloadOutlined" circle :loading="versionsLoading" @click="loadInstallVersions" />
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
                v-if="installingDsh && !deployingNode && !npmPreparing && !nodeExtracting && !npmExtracting"
                class="install-progress"
            >
                <div class="activity">
                    <span class="activity__label">{{ installLabel }}</span>
                    <div class="activity-bar" />
                </div>
            </div>

            <!-- 图标 + 极简文字：底部这三个按钮的功能由位置与图标就能说明，不必再用整句文案 -->
            <div class="wiz-nav">
                <a-tooltip :title="$t('dshMissing.quitHint')" placement="top">
                    <a-button :disabled="busy" :aria-label="$t('dshMissing.quitHint')" @click="quitShell">
                        <template #icon><CloseOutlined /></template>
                    </a-button>
                </a-tooltip>
                <div class="wiz-nav__right">
                    <a-tooltip v-if="step > 0" :title="$t('dshMissing.prevHint')" placement="top">
                        <a-button :disabled="busy" :aria-label="$t('dshMissing.prevHint')" @click="back">
                            <template #icon><ArrowLeftOutlined /></template>
                        </a-button>
                    </a-tooltip>
                    <a-button type="primary" :disabled="busy || primaryDisabled" :loading="simpleRunning" @click="runCurrentStep">
                        <template #icon>
                            <component :is="primaryIcon" />
                        </template>
                        {{ primaryLabel }}
                    </a-button>
                </div>
            </div>
        </div>

        <!--
            底部步骤栏：原先是窗口顶部那条专属导航栏（步骤条 + 安装设置/日志入口 + 窗口按钮），
            现在只把**步骤条**搬到此地 —— 其余三样都由全局承接（窗口按钮在标题栏，设置与日志在
            设置页），不再重复一份。整条即进度条（见 WizardSteps.vue）。
        -->
        <footer class="wiz-footbar">
            <WizardSteps :steps="wizardSteps" :active="step" :percent="overallProgress" />
        </footer>
    </div>
</template>

<style scoped>
/*
 * 初始化页的舞台：**只占 web 宿主区**（`.web-overlay` 内），顶部与底部留给全局 TitleBar / StatusBar。
 * 原先是 fixed inset:0 + z-index 2000 的全屏遮罩（连标题栏一起盖住），所以必须自带一条导航栏；
 * 标题栏交还全局后，它只剩底部那条步骤栏（.wiz-footbar），高度记在 --wiz-foot-h 里供内边距复用。
 */
.missing-mask {
    --wiz-foot-h: 40px;
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    /* safe center：卡片比舞台高时不再把顶部裁掉；高度够用时表现与 center 完全一致。 */
    align-items: safe center;
    justify-content: center;
    overflow: auto;
    /* 底部让出步骤栏的高度，滚到底时卡片不会被它压住 */
    padding: 24px 0 calc(24px + var(--wiz-foot-h));
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
 * 底部步骤栏：贴在舞台底部的一条栏，高度与进度填充都由 WizardSteps 撑满
 * （它把整个容器高度当作进度条的填充区，见 WizardSteps.vue）。
 * 做成 absolute 而不是参与 flex 布局：舞台（.missing-mask）要滚动，步骤栏必须始终可见。
 */
.wiz-footbar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--wiz-foot-h);
    display: flex;
    align-items: stretch;
    /* 上边框用 inset 阴影画，不占布局高度（与 TitleBar 一致） */
    box-shadow: inset 0 1px 0 var(--el-border-color-light);
    background: var(--el-bg-color);
    user-select: none;
    overflow: hidden;
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
.speed-list__right {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
}
/* 轮次明细比代表值弱一档：它是依据，不是结论 */
.speed-list__rounds {
    font-family: var(--el-font-family-mono);
    font-size: 11px;
    color: var(--el-text-color-placeholder);
}
.speed-list__ms {
    font-family: var(--el-font-family-mono);
}
/* ---- 第 1 步：当前设置摘要 ---- */
.cfg-summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    background: var(--el-fill-color-light);
}
.cfg-summary__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
}
.cfg-summary__k {
    flex: 0 0 auto;
    color: var(--el-text-color-secondary);
}
.cfg-summary__v {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: right;
    color: var(--el-text-color-regular);
}
/* 指引文案：跟在摘要末行之下，说明这些设置去哪里改 */
.cfg-summary__note {
    margin-top: 2px;
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
/* ---- Node 版本选项（版本号 + 已安装 / 当前使用标签） ---- */
.node-opt {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
/* 版本号等宽：数位对齐后一列版本读起来更快 */
.node-opt__ver {
    font-family: var(--el-font-family-mono);
    font-size: 12.5px;
}
/* 标签不参与换行，也不把选项行撑高 */
.node-opt__tag {
    margin: 0;
    font-size: 11px;
    line-height: 16px;
    flex: 0 0 auto;
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
/* 「默认」标签跟在「程序内置」文字后面，与文字基线对齐，不要撑高整行 */
.rt-tag {
    margin-left: 6px;
    font-size: 11px;
    line-height: 18px;
}
.nr-opts :deep(.ant-radio-wrapper) {
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
.cfg-row :deep(.ant-input) {
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
</style>
