import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { EnvProbe } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { formatDownload } from '../../lib/format'
import { refreshOperations, useOperation } from '../../shell/progressStore'

/**
 * 向导 · Node 环境（第 2 步）。
 *
 * 负责：本地 Node 的可下载版本 / 已装版本 / 生效版本、部署与「已装则只切换」的判定、
 * 以及部署进度（来自共享 store）。
 *
 * 从 DshWizard.vue 抽出。`envProbe` 由调用方传入并与环境探测共享 ——
 * 生效版本优先取探测结果（它更权威），其次才是已装列表里的指针。
 */
export function useWizardNode(envProbe: Ref<EnvProbe | null>, t: (key: string) => string) {
    // ---- 版本选择（第 2 步）------------------------------------------------
    // 合并前的三处信息（可下载版本 / 已装版本 / 当前生效版本）现在都进同一个选择器：
    // 每个选项自带「已安装」「当前使用」标记，用户不必再对照另一块表单看状态。
    const versions = ref<string[]>([])
    const versionsLoading = ref(false)
    const includeNonLts = ref(false)
    const version = ref('')
    /** 已下载到配置目录的本地 Node 版本（来自 /versions/node）。 */
    const installed = ref<string[]>([])
    /** 当前生效的本地 Node 版本。 */
    const activeVersion = ref<string | null>(null)
    /** 当前生效的本地 Node 版本：优先环境探测，其次已安装版本列表。 */
    const localActive = computed(() => envProbe.value?.local.version ?? activeVersion.value)

    /** 选中项是否已经装在本地（决定下一步是「部署」还是「切换生效版本」）。 */
    const selectedInstalled = computed(() => !!version.value && installed.value.includes(version.value))
    /** 选中项是否就是当前生效的版本。 */
    const selectedIsActive = computed(() => !!version.value && version.value === localActive.value)

    /**
     * 选择器的选项：可下载版本 ∪ 已安装版本，按 semver 降序，逐个打标记。
     *
     * 必须**并集**而不是只用远端列表：用户可能处于离线状态、或某个已装版本的发布条目
     * 已经不在远端列表里 —— 只列远端会让「已安装且正在用」的版本在选择器里找不到，
     * 一打开这一步看起来就像什么都没装。
     */
    const versionOptions = computed(() => {
        const tagsOf = (v: string): { label: string; color: string }[] => {
            const tags: { label: string; color: string }[] = []
            if (v === localActive.value) tags.push({ label: t('dshMissing.node.tagActive'), color: 'green' })
            else if (installed.value.includes(v)) tags.push({ label: t('dshMissing.node.tagInstalled'), color: 'blue' })
            return tags
        }
        // 已装的版本可能不在远端列表里（离线、或发布条目已撤），这些也要排进去。
        // 远端列表本身已是 semver 降序，这里只做稳定合并：远端在前，补上它没覆盖到的已装版本。
        const ordered = [...versions.value, ...installed.value.filter((v) => !versions.value.includes(v)).sort().reverse()]
        return ordered.map((v) => ({ value: v, label: v, tags: tagsOf(v) }))
    })

    /** 拉取已安装 / 生效的本地 Node 版本。 */
    async function loadInstalled(): Promise<void> {
        try {
            const r = await window.api.get('/versions/:kind', { params: { kind: 'node' } })
            installed.value = r.installed
            activeVersion.value = r.active
        } catch {
            installed.value = []
            activeVersion.value = null
        }
    }

    /**
     * 拉取可部署的 Node 版本（新 → 旧）；默认只 LTS，勾选后含 Current，默认选中最新一项。
     *
     * 这里用共享 promise 去重：watch(step) 与调用方可能几乎同时请求，早退会让
     * 「简易安装」拿到还没填好的版本列表。并发调用共享同一次请求、都能等到结果。
     */
    let versionsPromise: Promise<void> | null = null
    async function loadVersions(): Promise<void> {
        if (versionsPromise) return versionsPromise
        const p = (async () => {
            versionsLoading.value = true
            try {
                const list = await window.api.get('/node/versions', { query: { includeNonLts: includeNonLts.value } })
                versions.value = list
                if (!list.includes(version.value)) version.value = list[0] ?? ''
            } catch {
                versions.value = []
            } finally {
                versionsLoading.value = false
            }
        })().finally(() => {
            if (versionsPromise === p) versionsPromise = null
        })
        versionsPromise = p
        return p
    }

    /**
     * 检查版本：把主进程的版本列表、已装版本、当前生效版本一次全刷一遍。
     *
     * 合并了原来分开的两个动作 —— 「重新检测」（只刷环境探测）与版本下拉旁的刷新按钮
     * （只刷远端列表）。两者用户根本分不清，且总是想同时要最新结果。
     */
    async function recheck(probe: () => Promise<void>): Promise<void> {
        await Promise.all([loadVersions(), loadInstalled(), probe()])
    }

    // ---- 部署 ----------------------------------------------------------------

    /** 本向导自己发起的 Node 部署在途标记（按钮 / 文案用）。 */
    const deploying = ref(false)

    /**
     * 进度来自**共享 store**（shell/progressStore）：向导切走（例如用户跑去设置页看日志）再回来时，
     * 主进程里的下载还在跑，靠 store 的快照就能立刻把进度条接着画出来。
     */
    const { op } = useOperation('node')
    const extracting = computed(() => op.value?.phase === 'extract')
    const percent = computed(() => op.value?.percent ?? 0)
    /** 进度条下方的「已下载 / 总大小 · 速度」。 */
    const info = computed(() => formatDownload(op.value?.total ?? 0, op.value?.downloaded ?? 0, op.value?.speed ?? 0))

    /** 部署指定版本（默认最新 LTS）；进度经共享 store 广播。 */
    async function deployOnce(v?: string, canceledText = ''): Promise<boolean> {
        if (deploying.value) return false
        deploying.value = true
        try {
            const r = await window.api.post('/node/deploy', { body: v ? { version: v } : {} })
            if (r.canceled) {
                // 用户主动取消：不算失败，也不弹错误提示。
                ElMessage.info(r.message || canceledText)
                return false
            }
            if (r.ok) {
                // 装完把选择器定到刚装好的版本：否则列表刷新后它可能停在别处，
                // 「已安装 / 当前使用」标记看起来就像打错了地方。
                if (v) version.value = v
                ElMessage.success(r.message)
                return true
            }
            ElMessage.error(r.message)
            return false
        } catch (err) {
            ElMessage.error(errorMessage(err))
            return false
        } finally {
            deploying.value = false
            // 操作已结束：刷新快照把进度收起（事件流不含结束信号）。
            await refreshOperations()
        }
    }

    /**
     * 把已安装的本地 Node 版本切成「当前生效」。
     * 已装过的版本不该再走一遍下载 —— 那既慢又没必要，用户想要的只是切过去。
     */
    async function activate(v: string): Promise<boolean> {
        try {
            const r = await window.api.put('/versions/:kind/active', { params: { kind: 'node' }, body: { version: v } })
            if (!r.ok) {
                ElMessage.error(r.message)
                return false
            }
            ElMessage.success(r.message)
            await loadInstalled()
            return true
        } catch (err) {
            ElMessage.error(errorMessage(err))
            return false
        }
    }

    return {
        versions,
        versionsLoading,
        includeNonLts,
        version,
        installed,
        activeVersion,
        selectedInstalled,
        selectedIsActive,
        versionOptions,
        deploying,
        extracting,
        percent,
        info,
        loadInstalled,
        loadVersions,
        recheck,
        deployOnce,
        activate
    }
}
