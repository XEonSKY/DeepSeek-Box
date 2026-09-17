<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClusterOutlined, FolderOutlined, SendOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { InstalledVersions } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { withV } from '@shared/version'
import { dshCheck } from '../../lib/update'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import TagLabel from '../../components/TagLabel.vue'
import { useSettingsStore } from './useSettingsStore'
import { useInstallCancel } from './useInstallCancel'

const { state, actions } = useSettingsStore()
const { t } = useI18n({ useScope: 'global' })

/** 折叠面板展开项。用 `:active-key` + `@change` 而非 `v-model:active-key`：后者的更新事件未在组件类型里声明。 */
const open = ref<string[]>(['dsh-startup', 'dsh-update'])

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
</style>
