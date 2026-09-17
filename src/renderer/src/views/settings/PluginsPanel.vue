<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { AppstoreOutlined, DeleteOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { DshPluginEntry, DshPluginsInfo, InstalledVersions, PnpmStatus } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { withV } from '@shared/version'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import { formatDownload } from '../../lib/format'
import TagLabel from '../../components/TagLabel.vue'
import { useInstallCancel } from './useInstallCancel'

/**
 * 「插件」页：管理 dsh 各 profile 的插件（组合包），决定启动时加载哪些。
 *
 * 数据与操作都走主进程（`/dsh/plugins`）：启停只改 `dsh.profile.bundles`，
 * 安装 / 卸载转发 `dsh plugin`，其 pnpm 由应用内置管理（本页顶部的 pnpm 卡片）。
 * profile 位于 `$DSH_HOME/profiles/<name>`，与 Box 配置目录无关。
 */

const info = ref<DshPluginsInfo | null>(null)
const profile = ref('web')
const loading = ref(false)
/** 安装 / 卸载 / 启停在途：禁用重复操作。 */
const busy = ref(false)
const installSpec = ref('')
const restarting = ref(false)

const profiles = computed(() => info.value?.profiles ?? [])
const entries = computed(() => info.value?.entries ?? [])
const manifestPath = computed(() => info.value?.manifestPath ?? '')
/** a-select 用 :options（项目约定，见 DshWizard.vue）。 */
const profileOptions = computed(() => profiles.value.map((p) => ({ value: p, label: p })))

/** 探测未完成时统一显示省略号，而不是「未下载」。 */
const pnpmText = computed(() => {
    if (!pnpmProbed.value) return '…'
    const s = pnpm.value?.bundled
    return s?.present ? withV(s.version) : tt('sv.plugins.pnpmNotDownloaded')
})

async function load(): Promise<void> {
    loading.value = true
    try {
        const r = await window.api.get('/dsh/plugins', { query: profile.value ? { profile: profile.value } : {} })
        info.value = r
        profile.value = r.profile
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        loading.value = false
    }
}

/** 切换 profile 后重新读取该 profile 的插件。 */
async function onProfileChange(value: unknown): Promise<void> {
    if (typeof value === 'string' && value) profile.value = value
    await load()
}

/** 供模板使用：把 switch 的新值转给 onToggle（内联箭头参数在模板里会退化成隐式 any）。 */
function toggleHandler(entry: DshPluginEntry): (checked: boolean) => void {
    return (checked) => void onToggle(entry, checked)
}

/** 启停插件：只改配置层，不装不卸。 */
async function onToggle(entry: DshPluginEntry, checked: unknown): Promise<void> {
    if (busy.value || entry.required) return
    busy.value = true
    try {
        info.value = await window.api.put('/dsh/plugins/:profile/enabled', {
            params: { profile: profile.value },
            body: { name: entry.name, enabled: checked === true }
        })
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        busy.value = false
    }
}

/** 安装插件：转发 dsh plugin add（首次会自动下载内置 pnpm）。 */
async function onInstall(): Promise<void> {
    const spec = installSpec.value.trim()
    if (!spec || busy.value) return
    busy.value = true
    try {
        const r = await window.api.post('/dsh/plugins/:profile/install', {
            params: { profile: profile.value },
            body: { spec }
        })
        if (r.canceled) return
        if (r.ok) {
            ElMessage.success(tt('sv.plugins.installOk', { name: spec }))
            installSpec.value = ''
            await load()
        } else {
            ElMessage.error(r.message || tt('sv.plugins.installFail'))
        }
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        busy.value = false
        await loadPnpmStatus()
    }
}

/** 卸载插件：转发 dsh plugin remove（同时删依赖与配置层）。 */
async function onRemove(entry: DshPluginEntry): Promise<void> {
    if (busy.value) return
    const ok = await confirmDialog({
        title: tt('sv.plugins.removeTitle'),
        message: tt('sv.plugins.removeConfirm', { name: entry.name }),
        confirmText: tt('sv.plugins.remove'),
        cancelText: tt('msg.cancelBtn'),
        danger: true
    })
    if (!ok) return
    busy.value = true
    try {
        const r = await window.api.post('/dsh/plugins/:profile/remove', {
            params: { profile: profile.value },
            body: { name: entry.name }
        })
        if (r.canceled) return
        if (r.ok) await load()
        else ElMessage.error(r.message || tt('sv.plugins.removeFail'))
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        busy.value = false
    }
}

/** 配置层改动要重启 dsh（对应 profile）后生效。 */
async function restartDsh(): Promise<void> {
    restarting.value = true
    try {
        await window.api.post('/dsh/restart')
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        restarting.value = false
    }
}

// ---- 内置 pnpm（与「环境」页的 npm 卡片同一套流程）----------------------------

const pnpm = ref<PnpmStatus | null>(null)
const pnpmProbed = ref(false)
const pnpmInstalling = ref(false)
const pnpmPercent = ref(0)
const pnpmDownloaded = ref(0)
const pnpmTotal = ref(0)
const pnpmSpeed = ref(0)
const pnpmPhase = ref<'download' | 'extract'>('download')
const pnpmProgressSeen = ref(false)
const pnpmProgressInfo = computed(() => formatDownload(pnpmTotal.value, pnpmDownloaded.value, pnpmSpeed.value))
const installedPnpm = ref<InstalledVersions>({ installed: [], active: null })
const switchingPnpm = ref('')
const pnpmVersions = ref<string[]>([])
const pnpmVersionOptions = computed(() => pnpmVersions.value.map((v) => ({ value: v, label: v })))
const pnpmVersionsLoading = ref(false)
const pnpmIncludePre = ref(false)
const pnpmSelected = ref('')
const { canceling, cancelInstall } = useInstallCancel()

let offPnpmProgress: (() => void) | null = null

async function loadPnpmStatus(): Promise<void> {
    try {
        pnpm.value = await window.api.get('/pnpm/status')
    } catch {
        pnpm.value = null
    } finally {
        pnpmProbed.value = true
    }
}

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

async function loadInstalledPnpm(): Promise<void> {
    try {
        installedPnpm.value = await window.api.get('/versions/:kind', { params: { kind: 'pnpm' } })
    } catch {
        installedPnpm.value = { installed: [], active: null }
    }
}

async function installPnpm(version?: string): Promise<void> {
    if (pnpmInstalling.value) return
    pnpmInstalling.value = true
    pnpmProgressSeen.value = false
    pnpmPhase.value = 'download'
    pnpmPercent.value = 0
    pnpmDownloaded.value = 0
    pnpmTotal.value = 0
    pnpmSpeed.value = 0
    try {
        const r = await window.api.post('/pnpm/update', { body: version ? { version } : {} })
        if (!r.canceled) {
            if (r.ok) ElMessage.success(tt('sv.plugins.pnpmOk', { version: withV(r.version) }))
            else ElMessage.error(r.message || tt('sv.plugins.pnpmFail'))
        }
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        pnpmInstalling.value = false
        await loadPnpmStatus()
        await loadPnpmVersions()
        await loadInstalledPnpm()
    }
}

async function switchPnpm(version: string): Promise<void> {
    if (switchingPnpm.value) return
    switchingPnpm.value = version
    try {
        const r = await window.api.put('/versions/:kind/active', { params: { kind: 'pnpm' }, body: { version } })
        if (r.ok) {
            ElMessage.success(tt('sv.env.versionSwitched', { version: withV(r.version) }))
            await loadInstalledPnpm()
            await loadPnpmStatus()
        } else ElMessage.error(r.message || '')
    } catch (err) {
        ElMessage.error(errorMessage(err))
    } finally {
        switchingPnpm.value = ''
    }
}

async function removePnpm(version: string): Promise<void> {
    const ok = await confirmDialog({
        title: tt('sv.env.removeVersion'),
        message: tt('sv.env.removeVersionConfirm', { version: withV(version) }),
        confirmText: tt('sv.env.removeVersion'),
        cancelText: tt('msg.cancelBtn'),
        danger: true
    })
    if (!ok) return
    try {
        const r = await window.api.delete('/versions/:kind/:version', { params: { kind: 'pnpm', version } })
        if (r.ok) {
            await loadInstalledPnpm()
            await loadPnpmStatus()
        } else ElMessage.error(r.message || '')
    } catch (err) {
        ElMessage.error(errorMessage(err))
    }
}

onMounted(() => {
    offPnpmProgress = window.api.on('pnmenv:progress', (p) => {
        pnpmProgressSeen.value = true
        pnpmPhase.value = p.phase
        pnpmPercent.value = p.percent
        pnpmDownloaded.value = p.downloaded
        pnpmTotal.value = p.total
        pnpmSpeed.value = p.speed
    })
    void load()
    void loadPnpmStatus()
    void loadPnpmVersions()
    void loadInstalledPnpm()
})

onBeforeUnmount(() => {
    offPnpmProgress?.()
})
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><AppstoreOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.plugins') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.plugins') }}</div>
            </div>
        </div>

        <!-- 内置 pnpm：dsh 插件安装会转发给 pnpm，这里像 npm 一样由应用代管 -->
        <div class="sec__title pl-sec"><DownloadOutlined style="font-size: 15px" /> {{ $t('sv.plugins.pnpmTitle') }}</div>
        <div class="kv">
            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
            <code class="kv__v">{{ pnpmText }}</code>
            <a-tag v-if="pnpmProbed && pnpm?.bundled.outdated" color="orange">{{ $t('sv.env.outdated') }}</a-tag>
            <a-tag v-else-if="pnpmProbed && pnpm?.bundled.present" color="green">{{ $t('sv.env.upToDate') }}</a-tag>
        </div>
        <div class="kv">
            <span class="kv__k">{{ $t('sv.env.latestVersion') }}</span>
            <code class="kv__v">{{ pnpmProbed ? withV(pnpm?.latest) : '…' }}</code>
        </div>
        <div class="hint">{{ pnpmProbed && !pnpm?.latest ? $t('sv.env.latestUnknown') : $t('sv.plugins.pnpmHint') }}</div>

        <div v-if="pnpmInstalling" class="act">
            <a-progress
                v-if="pnpmProgressSeen"
                :percent="pnpmPhase === 'extract' ? 100 : pnpmPercent"
                :status="pnpmPhase === 'extract' ? 'active' : 'normal'"
                :show-info="pnpmPhase !== 'extract'"
                :stroke-width="6"
                class="dep-progress"
            />
            <div v-if="pnpmProgressSeen" class="hint dep-info">
                {{ pnpmPhase === 'extract' ? $t('sv.env.extracting') : pnpmProgressInfo }}
            </div>
            <a-button :loading="canceling" @click="cancelInstall()">
                {{ canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
            </a-button>
        </div>

        <div v-if="pnpmProbed && !pnpmInstalling && (!pnpm?.bundled.present || pnpm?.bundled.outdated)" class="act">
            <a-button type="primary" :icon="DownloadOutlined" :loading="pnpmInstalling" @click="installPnpm()">
                {{ pnpm?.bundled.present ? $t('sv.plugins.pnpmUpdate') : $t('sv.plugins.pnpmDownload') }}
            </a-button>
        </div>

        <div class="upd-sep" />
        <div class="kv">
            <span class="kv__k">{{ $t('sv.env.selectVersion') }}</span>
            <a-select
                v-model:value="pnpmSelected"
                :options="pnpmVersionOptions"
                show-search
                :placeholder="$t('sv.env.selectPlaceholder')"
                class="vm-sel"
                :disabled="pnpmVersionsLoading || pnpmInstalling"
            />
            <a-button :icon="ReloadOutlined" :loading="pnpmVersionsLoading" @click="loadPnpmVersions()">{{ $t('sv.env.refresh') }}</a-button>
            <a-button
                type="primary"
                :icon="DownloadOutlined"
                :loading="pnpmInstalling"
                :disabled="pnpmInstalling || pnpmVersionsLoading || !pnpmSelected || pnpmSelected === pnpm?.bundled.version"
                @click="installPnpm(pnpmSelected)"
            >
                {{ $t('sv.env.installVersion') }}
            </a-button>
        </div>
        <a-checkbox v-model:checked="pnpmIncludePre">{{ $t('sv.env.includePrerelease') }}</a-checkbox>
        <div class="hint">{{ $t('sv.plugins.pnpmListHint') }}</div>

        <div class="iv">
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
                            <a-tag v-if="v === installedPnpm.active" color="green">{{ $t('sv.env.activeVersion') }}</a-tag>
                            <span v-else class="iv__dash">—</span>
                        </span>
                        <span class="iv__c3">
                            <a-button v-if="v !== installedPnpm.active" :loading="switchingPnpm === v" @click="switchPnpm(v)">{{ $t('sv.env.switchVersion') }}</a-button>
                            <a-button danger :disabled="switchingPnpm !== ''" @click="removePnpm(v)">{{ $t('sv.env.removeVersion') }}</a-button>
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 插件列表：profile 选择 + 启停 + 安装 / 卸载 -->
        <div class="sec__title pl-sec"><AppstoreOutlined style="font-size: 15px" /> <TagLabel :label="$t('sv.plugins.listTitle')" /></div>
        <div class="kv">
            <span class="kv__k">{{ $t('sv.plugins.profile') }}</span>
            <a-select v-model:value="profile" :options="profileOptions" class="pl-sel" @change="onProfileChange" />
            <a-button :icon="ReloadOutlined" :loading="loading" @click="load()">{{ $t('sv.env.refresh') }}</a-button>
        </div>
        <div class="hint">{{ $t('sv.plugins.listHint') }}<br /><code class="pl-path">{{ manifestPath }}</code></div>

        <div v-if="loading && !entries.length" class="hint">{{ $t('sv.plugins.loading') }}</div>
        <div v-else-if="!entries.length" class="hint">{{ $t('sv.plugins.empty') }}</div>
        <div v-else class="pl-list">
            <div v-for="e in entries" :key="e.name" class="pl-row">
                <div class="pl-row__name">
                    <code class="pl-code">{{ e.name }}</code>
                    <a-tag v-if="e.required" color="blue">{{ $t('sv.plugins.required') }}</a-tag>
                    <a-tag v-else-if="!e.installed" color="orange">{{ $t('sv.plugins.notInstalled') }}</a-tag>
                </div>
                <div class="pl-row__act">
                    <a-switch :checked="e.enabled" :disabled="e.required || busy" @change="toggleHandler(e)" />
                    <a-button v-if="!e.required && e.installed" danger :icon="DeleteOutlined" :disabled="busy" @click="onRemove(e)" />
                </div>
            </div>
        </div>

        <div class="upd-sep" />
        <div class="kv">
            <a-input v-model:value="installSpec" class="pl-input" :placeholder="$t('sv.plugins.installPlaceholder')" @press-enter="onInstall" />
            <a-button type="primary" :icon="PlusOutlined" :loading="busy" :disabled="!installSpec.trim()" @click="onInstall">
                {{ $t('sv.plugins.install') }}
            </a-button>
        </div>
        <div class="hint">{{ $t('sv.plugins.installHint') }}</div>
        <div class="hint">{{ $t('sv.plugins.restartHint') }}</div>
        <div class="act">
            <a-button :icon="ReloadOutlined" :loading="restarting" @click="restartDsh">{{ $t('sv.plugins.restart') }}</a-button>
        </div>
    </div>
</template>

<style scoped>
/* 只留本组件专用规则；通用样式（.kv/.act/.dep-info/.iv/.hint/...）在 styles/settings.css。 */
.pl-sec {
    margin-top: 22px;
    padding-top: 18px;
    border-top: 1px solid var(--el-border-color-lighter);
}
.pl-sel {
    flex: 0 0 auto;
    width: 220px;
}
.pl-input {
    flex: 1 1 auto;
    min-width: 0;
}
.pl-path {
    font-family: var(--el-font-family-mono);
    font-size: 12px;
    word-break: break-all;
}
.pl-list {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
}
.pl-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 2px;
    border-bottom: 1px solid var(--el-border-color-lighter);
}
.pl-row__name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.pl-code {
    font-family: var(--el-font-family-mono);
    font-size: 13px;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pl-row__act {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
}
</style>
