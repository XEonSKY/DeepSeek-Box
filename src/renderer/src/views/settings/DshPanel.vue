<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { ClusterOutlined, FolderOutlined, SendOutlined, ReloadOutlined, SafetyCertificateFilled } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { InstalledVersions, ModelBalanceInfo, ModelsInfo } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { withV } from '@shared/version'
import { dshCheck } from '../../lib/update'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import { SETUP_PATH } from '../../shell/viewnav'
import TagLabel from '../../components/TagLabel.vue'
import { useSettingsStore } from './useSettingsStore'
import { useInstallCancel } from './useInstallCancel'

/**
 * 「DeepSeek」页 —— DeepSeek Harness 的来源、启停、更新，以及令牌与余额。
 *
 * ## 为什么令牌列表并到这里（原「模型」页）
 *
 * 令牌（供应商密钥）与余额是 **DeepSeek 的配置**，不是程序自身的设置 ——
 * 它们描述的是"我连的是哪个 DeepSeek、还剩多少额度"。原先把它们单独放一页，
 * 结果是改完 dsh 来源还得跳到另一页看供应商，两页之间的往返比内容本身更占注意力。
 * 合并后一页里从上到下是：**当前版本 → 来源与启停 → 更新 → 令牌与余额 → 卸载**，
 * 正好是「先确认连的是哪个、再看它能不能用、最后看余额」的使用顺序。
 *
 * ## 页头的品牌名
 *
 * 页头写的是 **DeepSeek Box**（本程序），不是菜单名「DeepSeek」（本页主题）——
 * 这一页本质上是在讲"本程序托管的那个 DeepSeek Harness"，所以顶部先亮出程序身份与版本。
 */
const { state, actions } = useSettingsStore()
const { t } = useI18n({ useScope: 'global' })
const router = useRouter()

/** 折叠面板展开项。用 `:active-key` + `@change` 而非 `v-model:active-key`：后者的更新事件未在组件类型里声明。 */
const open = ref<string[]>(['dsh-startup', 'dsh-update', 'dsh-models'])

function onOpenChange(keys: string[]): void {
    open.value = keys
}

/**
 * 「来源」下拉的选项。a-select 用 `:options`（项目约定，见 DshWizard.vue）；
 * 选项短标签含结尾括号，经 #optionRender / #labelRender 交给 TagLabel 渲染成「主文案 + 标签」。
 */
const sourceOptions = computed(() => [
    { value: 'local', label: t('sv.dsh.local') },
    { value: 'global', label: t('sv.dsh.global') }
])

/** 版本下拉项：标签是 actions.versionLabel（拼接「（当前）」后缀），按约定不交给 TagLabel。 */
const versionOptions = computed(() => state.versions.map((v) => ({ value: v, label: actions.versionLabel(v) })))

/** 本地 dsh 实例的已安装 / 生效版本（全局来源下通常为空）。 */
const installed = ref<InstalledVersions>({ installed: [], active: null })
const installedLoading = ref(false)
/** 正在切换的已安装版本（按钮 loading；空串表示没有）。 */
const switchingInstalled = ref('')
const { canceling, cancelInstall } = useInstallCancel()

// ---- 令牌与余额（原「模型」页的逻辑，随该页一并并入） ------------------------

/** 主进程返回的模型列表；未同意或读取失败时为 null。 */
const info = ref<ModelsInfo | null>(null)
const modelsLoading = ref(false)
/** 本次读取的失败说明（展示在主进程错误码之外：IPC 本身失败 / 超时等）。 */
const loadError = ref('')
/** 本次访问点了「暂不」：收起同意卡片，直到用户主动重新授权。 */
const dismissed = ref(false)
/** 读取代次：并发触发时只让最后一次的结果落地，避免旧响应覆盖新结果。 */
let loadSeq = 0

async function loadInstalled(): Promise<void> {
    if (installedLoading.value) return
    installedLoading.value = true
    try {
        installed.value = await window.api.get('/versions/:kind', { params: { kind: 'dsh' } })
    } catch {
        installed.value = { installed: [], active: null }
    } finally {
        installedLoading.value = false
    }
}

/** 读取模型列表（仅在已同意后调用；内含对供应商接口的联网查询）。 */
async function loadModels(): Promise<void> {
    const seq = ++loadSeq
    modelsLoading.value = true
    loadError.value = ''
    try {
        const res = await window.api.get('/models/info')
        if (seq !== loadSeq) return
        // 主进程返回形状异常时也收敛成一句可展示的错误，而不是让页面炸掉。
        info.value = res && Array.isArray(res.entries) ? res : { entries: [], errorCode: 'internal' }
    } catch (err) {
        if (seq !== loadSeq) return
        info.value = null
        loadError.value = errorMessage(err)
    } finally {
        if (seq === loadSeq) modelsLoading.value = false
    }
}

/** dsh 尚未安装（主进程报 dsh-missing）：送去初始化页完成安装。 */
function goSetup(): void {
    void router.push(SETUP_PATH)
}

/** 同意读取：置位持久化开关并立刻读取。 */
function grant(): void {
    dismissed.value = false
    state.modelsCredConsent = true
    void loadModels()
}

/** 主进程错误码 → 一句说明（未知码不展示，避免泄漏内部细节）。 */
const errorText = computed(() => {
    if (!info.value) return ''
    switch (info.value.errorCode) {
        case 'no-consent':
            return tt('sv.models.errNoConsent')
        case 'dsh-missing':
            return tt('sv.models.errDshMissing')
        case 'settings-missing':
            return tt('sv.models.errSettingsMissing')
        case 'settings-parse':
            return tt('sv.models.errSettingsParse')
        case 'no-provider':
            return tt('sv.models.errNoProvider')
        case 'internal':
            return tt('sv.models.errInternal')
        default:
            return ''
    }
})

/** 无错误但一条模型都没有。 */
const modelsEmpty = computed(() => !!info.value && !info.value.errorCode && info.value.entries.length === 0)

/** 余额文案：金额；查不了的供应商给出原因。 */
function balanceText(b: ModelBalanceInfo): string {
    if (!b) return tt('sv.models.balanceUnknown')
    if (b.state === 'ok') {
        const amount = [b.currency, b.total].filter(Boolean).join(' ')
        return amount || tt('sv.models.balanceUnknown')
    }
    if (b.state === 'unsupported') return tt('sv.models.balanceUnsupported')
    if (b.state === 'no-key') return tt('sv.models.balanceNoKey')
    return tt('sv.models.balanceError', { msg: b.message ?? '-' })
}

/** 悬停补充赠送 / 充值明细（错误状态不解释）。 */
function balanceTitle(b: ModelBalanceInfo): string {
    if (!b || b.state !== 'ok') return ''
    const parts: string[] = []
    if (b.granted) parts.push(tt('sv.models.balanceGranted', { amount: b.granted }))
    if (b.toppedUp) parts.push(tt('sv.models.balanceToppedUp', { amount: b.toppedUp }))
    return parts.join(' · ')
}

/** 更新 dsh，完成后刷新已安装列表。 */
async function updateDsh(): Promise<void> {
    await actions.runUpdateDsh()
    await loadInstalled()
}

/** 安装所选版本（已安装时 actions 内部只切指针），完成后刷新列表。 */
async function switchSelected(): Promise<void> {
    await actions.switchVersion()
    await loadInstalled()
}

/** 行内切换已安装版本：只改生效指针、不重装。 */
async function useInstalled(version: string): Promise<void> {
    if (switchingInstalled.value) return
    switchingInstalled.value = version
    try {
        const r = await window.api.put('/versions/:kind/active', { params: { kind: 'dsh' }, body: { version } })
        if (r.ok) {
            state.version = r.version
            ElMessage.success(tt('sv.env.versionSwitched', { version: withV(r.version) }))
        } else {
            ElMessage.error(r.message || '')
        }
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        switchingInstalled.value = ''
        await loadInstalled()
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
        const r = await window.api.delete('/versions/:kind/:version', { params: { kind: 'dsh', version } })
        if (r.ok) {
            await loadInstalled()
            await actions.loadVersion()
        } else {
            ElMessage.error(r.message || '')
        }
    } catch (err) {
        ElMessage.error(errorMessage(err))
    }
}

onMounted(() => {
    void actions.refreshRunning()
    void loadInstalled()
    if (state.modelsCredConsent) void loadModels()
})
</script>


<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><ClusterOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">DeepSeek Box</div>
                <div class="dsh-brand__ver">
                    {{ $t('sv.dsh.installedVersion') }}&nbsp;<code>{{ state.version ? 'v' + state.version : $t('sv.dsh.versionMissing', { pkg: '@deepseek-ai/dsh' }) }}</code>
                    <a-tag
                        v-if="dshCheck.found"
                        class="ver-tag"
                        :color="dshCheck.prerelease ? 'orange' : 'green'"
                    >
                        {{ dshCheck.prerelease ? $t('sv.dsh.tagPre') : $t('sv.dsh.tagStable') }}&nbsp;{{ dshCheck.latest }}
                    </a-tag>
                </div>
            </div>
        </div>

        <a-collapse :active-key="open" @change="onOpenChange">
            <a-collapse-panel key="dsh-startup">
                <template #header>
                    <div class="sec__title"><ClusterOutlined /> {{ $t('sv.dsh.startup') }}</div>
                </template>
                <a-form layout="vertical">
                    <a-form-item>
                        <template #label><TagLabel :label="$t('sv.dsh.timeout')" /></template>
                        <a-input-number v-model:value="state.timeoutMs" :min="5000" :step="5000" />
                        <div class="hint">{{ $t('sv.dsh.timeoutHint') }}</div>
                    </a-form-item>

                    <a-form-item :label="$t('sv.dsh.source')">
                        <a-select v-model:value="state.dshSource" class="dd" :options="sourceOptions">
                            <template #labelRender="{ label }">
                                <TagLabel :label="String(label ?? '')" />
                            </template>
                            <template #optionRender="{ option }">
                                <TagLabel :label="String(option.label ?? '')" />
                            </template>
                        </a-select>
                        <div class="hint">{{ state.dshSource === 'local' ? $t('sv.dsh.localHint') : $t('sv.dsh.globalHint') }}</div>
                    </a-form-item>

                    <a-form-item v-if="state.dshSource === 'global'">
                        <template #label><TagLabel :label="$t('sv.dsh.launcherPath')" /></template>
                        <div class="row">
                            <a-input v-model:value="state.dshBin" readonly :placeholder="$t('sv.dsh.launcherPlaceholder')" />
                            <a-button :icon="FolderOutlined" @click="actions.browseDshBin()">{{ $t('sv.dsh.browseLauncher') }}</a-button>
                        </div>
                        <div class="hint">{{ $t('sv.dsh.launcherHint') }}</div>
                    </a-form-item>
                </a-form>

                <div class="ctl-row">
                    <a-tag :color="state.dshRunning ? 'green' : 'default'">
                        {{ state.dshRunning ? $t('sv.dsh.running') : $t('sv.dsh.stopped') }}
                    </a-tag>
                    <a-space-compact>
                        <a-button type="primary" :disabled="state.dshRunning" @click="actions.startDsh()">{{ $t('sv.dsh.start') }}</a-button>
                        <a-button :disabled="!state.dshRunning" @click="actions.stopDsh()">{{ $t('sv.dsh.stop') }}</a-button>
                        <a-button @click="actions.restartDsh()">{{ $t('sv.dsh.restart') }}</a-button>
                    </a-space-compact>
                    <a-button type="primary" style="margin-left: auto" :loading="state.applying" @click="actions.apply()">
                        {{ $t('sv.dsh.applyBtn') }}
                    </a-button>
                </div>
            </a-collapse-panel>

            <a-collapse-panel key="dsh-update">
                <template #header>
                    <div class="sec__title"><ReloadOutlined /> {{ $t('sv.dsh.packageUpdate') }}</div>
                </template>
                <div class="kopt">
                    <div class="au">
                        <div class="au__txt">
                            <div class="au__t">{{ $t('sv.dsh.checkOnStart') }}</div>
                            <div class="au__desc">{{ $t('sv.dsh.checkOnStartDesc') }}</div>
                        </div>
                        <a-switch v-model:checked="state.autoCheckUpdate" />
                    </div>

                    <div class="au">
                        <div class="au__txt">
                            <div class="au__t">{{ $t('sv.dsh.checkPrerelease') }}</div>
                            <div class="au__desc">{{ $t('sv.dsh.checkPrereleaseDesc') }}</div>
                        </div>
                        <a-switch v-model:checked="state.autoCheckPrerelease" />
                    </div>
                </div>

                <div class="upd-sep" />
                <div class="dsh-update">
                    <div class="dsh-update__text">
                        <div class="dsh-update__title"><ReloadOutlined /> {{ $t('sv.dsh.checkUpdateTitle') }}</div>
                        <div class="dsh-update__desc">{{ $t('sv.dsh.checkUpdateDesc', { pkg: '@deepseek-ai/dsh' }) }}</div>
                    </div>
                    <div class="dsh-update__actions">
                        <a-button :icon="ReloadOutlined" :loading="state.updating" :disabled="state.updating || state.updatingDsh" @click="actions.runUpdateCheck()">
                            {{ $t('sv.dsh.check') }}
                        </a-button>
                        <a-button type="primary" :icon="SendOutlined" :loading="state.updatingDsh" :disabled="state.updatingDsh || state.updating || !dshCheck.found" @click="updateDsh()">
                            {{ $t('sv.dsh.update') }}
                        </a-button>
                        <a-button v-if="state.updatingDsh" :loading="canceling" @click="cancelInstall()">
                            {{ canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                        </a-button>
                    </div>
                </div>

                <!-- 检查结果回显：发现新版本由标题栏的 tag 表示；「已是最新」不再弹 toast，改在这里说明 -->
                <div v-if="dshCheck.checked && !dshCheck.found" class="au-note">
                    <a-tag color="green">{{ $t('update.okTitle') }}</a-tag>
                    <span v-if="dshCheck.current" class="ver-tag">&nbsp;&nbsp;{{ dshCheck.current }}</span>
                </div>

                <div class="upd-sep" />
                <a-form layout="vertical" class="vm-in">
                    <a-form-item :label="$t('sv.dsh.selectVersion')">
                        <div class="vm-row">
                            <a-select v-model:value="state.selectedVersion" show-search :options="versionOptions" :placeholder="$t('sv.dsh.selectPlaceholder')" class="vm-sel" :disabled="state.versionsLoading || state.switchingDsh" />
                            <a-button :icon="ReloadOutlined" :loading="state.versionsLoading" @click="actions.loadVersions()">{{ $t('sv.dsh.refresh') }}</a-button>
                            <a-button type="primary" :icon="SendOutlined" :loading="state.switchingDsh" :disabled="state.switchingDsh || state.versionsLoading || !state.selectedVersion || state.selectedVersion === state.version" @click="switchSelected()">
                                {{ $t('sv.dsh.installVersion') }}
                            </a-button>
                            <a-button v-if="state.switchingDsh" :loading="canceling" @click="cancelInstall()">
                                {{ canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                            </a-button>
                        </div>
                        <div class="hint">{{ $t('sv.dsh.versionListHint') }}</div>
                    </a-form-item>
                </a-form>

                <div class="upd-sep" />
                <div class="iv">
                    <div class="iv__title">{{ $t('sv.env.installedVersions') }}</div>
                    <div v-if="!installed.installed.length" class="hint">{{ $t('sv.env.installedNone') }}</div>
                    <a-spin v-else :spinning="installedLoading">
                        <div class="iv__list">
                            <div class="iv__thead">
                                <span class="iv__c1">{{ $t('sv.env.colVersion') }}</span>
                                <span class="iv__c2">{{ $t('sv.env.colStatus') }}</span>
                                <span class="iv__c3">{{ $t('sv.env.colActions') }}</span>
                            </div>
                            <div class="iv__tbody">
                                <div v-for="v in installed.installed" :key="v" class="iv__row">
                                    <span class="iv__c1"><code class="iv__ver">{{ withV(v) }}</code></span>
                                    <span class="iv__c2">
                                        <a-tag v-if="v === installed.active" color="green">
                                            {{ $t('sv.env.activeVersion') }}
                                        </a-tag>
                                        <span v-else class="iv__dash">—</span>
                                    </span>
                                    <span class="iv__c3">
                                        <a-button v-if="v !== installed.active" :loading="switchingInstalled === v" @click="useInstalled(v)">
                                            {{ $t('sv.env.switchVersion') }}
                                        </a-button>
                                        <a-button danger @click="removeInstalled(v)">
                                            {{ $t('sv.env.removeVersion') }}
                                        </a-button>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </a-spin>
                </div>

                <div class="vm-un">
                    <div class="vm-un__txt">{{ $t('sv.dsh.uninstallTxt', { pkg: '@deepseek-ai/dsh' }) }}</div>
                    <a-button danger :loading="state.uninstalling" @click="actions.confirmUninstall()">{{ $t('sv.dsh.uninstall') }}</a-button>
                </div>
            </a-collapse-panel>

            <a-collapse-panel key="dsh-models">
                <template #header>
                    <div class="sec__title"><SafetyCertificateFilled /> {{ $t('sv.models.section') }}</div>
                </template>

                <!-- 未授权：首次进入征求同意 -->
                <template v-if="!state.modelsCredConsent">
                    <div v-if="!dismissed" class="mp__consent">
                        <div class="mp__consent-t"><SafetyCertificateFilled /> {{ $t('sv.models.consentTitle') }}</div>
                        <p class="mp__consent-d">{{ $t('sv.models.consentDesc') }}</p>
                        <div class="mp__path"><code>{{ $t('sv.models.consentPathValue') }}</code></div>
                        <div class="mp__actions">
                            <a-button type="primary" @click="grant">{{ $t('sv.models.consentAgree') }}</a-button>
                            <a-button @click="dismissed = true">{{ $t('sv.models.consentDeny') }}</a-button>
                        </div>
                        <div class="hint">{{ $t('sv.models.consentNote') }}</div>
                    </div>
                    <div v-else class="mp__empty">
                        <SafetyCertificateFilled style="font-size: 30px" />
                        <div class="mp__empty-t">{{ $t('sv.models.deniedTitle') }}</div>
                        <div class="hint">{{ $t('sv.models.deniedHint') }}</div>
                        <a-button @click="grant">{{ $t('sv.models.consentAgree') }}</a-button>
                    </div>
                </template>

                <!-- 已授权：令牌列表（供应商 / 余额） -->
                <a-spin v-else :spinning="modelsLoading" class="mp__body">
                    <div class="mp__toolbar">
                        <span class="mp__count">{{ $t('sv.models.modelCount', { n: info?.entries.length ?? 0 }) }}</span>
                        <a-button :icon="ReloadOutlined" :loading="modelsLoading" @click="loadModels">
                            {{ $t('sv.models.refreshAll') }}
                        </a-button>
                    </div>
                    <a-alert v-if="loadError" type="error" :closable="false" show-icon :title="$t('sv.models.loadFail', { err: loadError })" />
                    <a-alert v-else-if="errorText" type="info" :closable="false" show-icon :title="errorText" />
                    <!-- dsh 没装时给出明确去路：错误提示之外还有一步可做 -->
                    <div v-if="info?.errorCode === 'dsh-missing'" class="mp__go">
                        <a-button type="primary" @click="goSetup">{{ $t('sv.models.goInstall') }}</a-button>
                    </div>
                    <div v-else-if="modelsEmpty" class="hint">{{ $t('sv.models.empty') }}</div>
                    <div v-else-if="info" class="mp__list">
                        <div class="mp__head">
                            <span class="mp__c1">{{ $t('sv.models.colProvider') }}</span>
                            <span class="mp__c2">{{ $t('sv.models.colBalance') }}</span>
                        </div>
                        <div class="mp__tbody">
                            <div v-for="e in info.entries" :key="e.provider" class="mp__row">
                                <span class="mp__c1"><span class="mp__ellip" :title="e.providerName">{{ e.providerName }}</span></span>
                                <span class="mp__c2" :class="'is-' + (e.balance ? e.balance.state : 'error')">
                                    <span class="mp__ellip" :title="balanceTitle(e.balance)">{{ balanceText(e.balance) }}</span>
                                </span>
                            </div>
                        </div>
                    </div>
                </a-spin>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>

<style scoped>
/* 来源下拉占满表单项宽度（原 el-select 默认为 100%，antdv 的 a-select 默认按内容宽）。 */
.dd {
    width: 100%;
}
/* dsh 运行状态 + 启停按钮组 + 应用按钮：一行排列，应用按钮靠右。 */
.ctl-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
}

/* ---- 令牌与余额（原「模型」页的样式，随该页一并并入） ---- */
/* 所有规则都用 .mp__ 前缀限定在本页的这一块内，不会外溢到上面的启动 / 更新两组。 */

/* ---- 同意卡片 ---- */
.mp__consent {
    padding: 18px 18px 16px;
    border: 1px solid var(--el-border-color);
    border-radius: 10px;
    background: var(--el-bg-color);
}
.mp__consent-t {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}
.mp__consent-t .anticon {
    color: var(--el-color-primary);
}
.mp__consent-d {
    margin: 10px 0 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
}
.mp__path {
    margin: 10px 0 0;
}
.mp__path code {
    font-family: var(--el-font-family-mono);
    font-size: 12px;
    background: var(--el-fill-color-light);
    color: var(--el-text-color-primary);
    padding: 2px 8px;
    border-radius: 6px;
}
.mp__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 14px;
}
.mp__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 40px 16px;
    border: 1px dashed var(--el-border-color);
    border-radius: 10px;
    color: var(--el-text-color-secondary);
}
.mp__empty-t {
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}
/* 「去完成安装」按钮：只在主进程报 dsh-missing 时出现 */
.mp__go {
    margin-bottom: 10px;
}
/* 工具栏：数量 + 刷新全部 */
.mp__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
}
.mp__count {
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
/* ---- 令牌列表：两列（供应商自适应 / 余额定宽），窄容器不撑横向滚动 ---- */
.mp__list {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 8px;
    overflow: hidden;
}
.mp__head,
.mp__row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
}
.mp__head {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    background: var(--el-fill-color-light);
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.mp__tbody .mp__row + .mp__row {
    border-top: 1px solid var(--el-border-color-lighter);
}
.mp__tbody .mp__row:nth-child(even) {
    background: var(--el-fill-color-lighter);
}
.mp__c1,
.mp__c2 {
    display: flex;
    align-items: center;
    min-width: 0;
}
.mp__c1 {
    flex: 1 1 auto;
}
.mp__c2 {
    flex: 0 0 170px;
    justify-content: flex-end;
    font-variant-numeric: tabular-nums;
}
/* 余额状态配色：正常用正文色，查不了用次要色，失败用警示色 */
.mp__c2.is-ok {
    color: var(--el-text-color-primary);
}
.mp__c2.is-unsupported,
.mp__c2.is-no-key {
    color: var(--el-text-color-secondary);
}
.mp__c2.is-error {
    color: var(--el-color-warning);
}
.mp__ellip {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
