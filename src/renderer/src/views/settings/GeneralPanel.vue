<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { FolderOutlined, ReloadOutlined, PoweroffOutlined, SettingOutlined, DesktopOutlined, PlusOutlined, DeleteOutlined } from '@antdv-next/icons'
import type { ConfigDirInfo } from '@shared/types'
import TagLabel from '../../components/TagLabel.vue'
import { useSettingsStore } from './useSettingsStore'
import { SEARCH_ENGINE_IDS, ENGINE_LABEL_KEY } from '../../lib/engines'
import { confirmDialog } from '../../lib/confirm'

const { state, actions } = useSettingsStore()
const { t } = useI18n({ useScope: 'global' })

// a-collapse：默认全部展开。用 :active-key + @change（Antdv 未声明 update:activeKey 事件）。
const open = ref<string[]>(['general-run', 'general-configdir', 'general-close', 'general-newtab', 'general-reset'])

/** a-collapse 展开项变化。 */
function onOpenChange(keys: string[]): void {
    open.value = keys
}

/** 搜索引擎下拉项：项目约定 a-select 用 :options（见 DshWizard.vue）。 */
const engineOptions = computed(() => SEARCH_ENGINE_IDS.map((id) => ({ value: id, label: t(ENGINE_LABEL_KEY[id]) })))

function addShortcut(): void {
    state.shortcuts.push({ title: '', url: '' })
}
function removeShortcut(i: number): void {
    state.shortcuts.splice(i, 1)
}

// ---- 配置文件夹：默认 ~/.dsbox/{release,dev}，更改后在下次重启自动迁移 ----
const cfg = ref<ConfigDirInfo | null>(null)
const cfgPendingTo = computed(() => cfg.value?.pending?.to ?? '')

async function refreshConfigDir(): Promise<void> {
    try {
        cfg.value = await window.api.get('/config-dir')
    } catch {
        /* 读不到就留空 */
    }
}
onMounted(() => void refreshConfigDir())

/** 应用新的配置目录选择：旧目录有内容时提示「重启后迁移」，取消则撤销本次更改。 */
async function applyConfigDir(next: ConfigDirInfo, wanted: string): Promise<void> {
    cfg.value = next
    // 主进程拒绝互为父子的目录（返回的仍是原目录）——据此提示用户换一个位置。
    const accepted = next.pending ? next.pending.to === wanted : next.current === wanted
    if (!accepted) {
        ElMessage.warning(t('sv.general.configDirInvalid'))
        return
    }
    if (!next.pending) return
    const ok = await confirmDialog({
        title: t('sv.general.configDirConfirmTitle'),
        message: t('sv.general.configDirConfirm', { to: next.pending.to }),
        confirmText: t('sv.general.configDirOk'),
        cancelText: t('sv.general.configDirCancel')
    })
    if (!ok) {
        cfg.value = await window.api.post('/config-dir/revert')
        ElMessage.info(t('sv.general.configDirReverted'))
        return
    }
    // 保留更改：真正的迁移等到下次重启的引导阶段执行
    ElMessage.info(t('sv.general.configDirWillMigrate', { to: next.pending.to }))
}

async function changeConfigDir(): Promise<void> {
    const picked = await window.api.post('/dialog/directory')
    if (!picked) return
    await applyConfigDir(await window.api.put('/config-dir', { body: { dir: picked } }), picked)
}

async function resetConfigDir(): Promise<void> {
    const next = await window.api.put('/config-dir', { body: { dir: null } })
    await applyConfigDir(next, next.default)
}

/** 立即重启，触发已登记的迁移。 */
function restartNow(): void {
    void window.api.post('/app/relaunch')
}

/** 撤销尚未执行的迁移（继续停留在原目录）。 */
async function cancelPendingMigration(): Promise<void> {
    cfg.value = await window.api.post('/config-dir/revert')
    ElMessage.info(t('sv.general.configDirReverted'))
}
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><SettingOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.general') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.general') }}</div>
            </div>
        </div>
        <a-collapse :active-key="open" @change="onOpenChange">
            <a-collapse-panel key="general-run">
                <template #header>
                    <div class="sec__title"><SettingOutlined /> {{ $t('sv.general.run') }}</div>
                </template>
                <a-form layout="vertical">
                    <a-form-item :label="$t('sv.general.workspace')">
                        <div class="row">
                            <a-input v-model:value="state.workspace" readonly :placeholder="$t('sv.general.workspacePlaceholder')" />
                            <a-button type="primary" :icon="FolderOutlined" @click="actions.browseWorkspace()">{{ $t('sv.general.browse') }}</a-button>
                        </div>
                        <div class="hint">{{ $t('sv.general.workspaceHint') }}</div>
                    </a-form-item>

                    <a-form-item :label="$t('sv.general.port')">
                        <div class="row">
                            <a-radio-group v-model:value="state.portMode">
                                <a-radio-button :value="'auto'"><TagLabel :label="$t('sv.general.portAuto')" /></a-radio-button>
                                <a-radio-button :value="'manual'">{{ $t('sv.general.portManual') }}</a-radio-button>
                            </a-radio-group>
                            <a-input-number v-if="state.portMode === 'manual'" v-model:value="state.manualPort" :min="1" :max="65535" class="num" />
                        </div>
                        <div class="hint">{{ $t('sv.general.portHint') }}</div>
                    </a-form-item>
                </a-form>
            </a-collapse-panel>

            <a-collapse-panel key="general-configdir">
                <template #header>
                    <div class="sec__title"><FolderOutlined /> {{ $t('sv.general.configDirSection') }}</div>
                </template>
                <a-form layout="vertical">
                    <a-form-item :label="$t('sv.general.configDir')">
                        <div class="row">
                            <a-input :value="cfg?.current ?? ''" readonly />
                            <a-button type="primary" :icon="FolderOutlined" @click="changeConfigDir">{{ $t('sv.general.configDirChange') }}</a-button>
                            <a-button v-if="cfg?.override" @click="resetConfigDir">{{ $t('sv.general.configDirReset') }}</a-button>
                        </div>
                        <div class="hint">{{ $t('sv.general.configDirHint') }}</div>
                        <div v-if="cfg?.pending" class="cfg-pending">
                            <span>{{ $t('sv.general.configDirPending', { to: cfgPendingTo }) }}</span>
                            <a-button type="link" @click="restartNow">{{ $t('sv.general.configDirRestart') }}</a-button>
                            <a-button type="link" danger @click="cancelPendingMigration">{{ $t('sv.general.configDirCancel') }}</a-button>
                        </div>
                    </a-form-item>
                </a-form>
            </a-collapse-panel>

            <a-collapse-panel key="general-close">
                <template #header>
                    <div class="sec__title"><PoweroffOutlined /> {{ $t('sv.general.closeSection') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.general.closeKeepRunning') }}</div>
                        <div class="au__desc">{{ $t('sv.general.closeKeepRunningHint') }}</div>
                    </div>
                    <a-switch v-model:checked="state.closeKeepRunning" />
                </div>
            </a-collapse-panel>

            <a-collapse-panel key="general-newtab">
                <template #header>
                    <div class="sec__title"><DesktopOutlined /> {{ $t('sv.general.newTabTitle') }} &amp; {{ $t('sv.general.engineLabel') }}</div>
                </template>
                <a-form layout="vertical">
                    <a-form-item :label="$t('sv.general.engineLabel')">
                        <a-select v-model:value="state.searchEngine" :options="engineOptions" style="width: 100%" />
                    </a-form-item>

                    <a-form-item :label="$t('sv.general.newTabTitle')">
                        <a-radio-group v-model:value="state.newTabMode">
                            <a-radio :value="'builtin'">{{ $t('sv.general.newTabModeBuiltin') }}</a-radio>
                            <a-radio :value="'url'">{{ $t('sv.general.newTabModeUrl') }}</a-radio>
                        </a-radio-group>
                        <a-input
                            v-if="state.newTabMode === 'url'"
                            v-model:value="state.newTabUrl"
                            :placeholder="$t('sv.general.newTabUrlPlaceholder')"
                            style="margin-top: 8px"
                        />
                    </a-form-item>

                    <a-form-item :label="$t('sv.general.shortcuts')">
                        <div class="sh-list">
                            <div v-for="(sc, i) in state.shortcuts" :key="i" class="sh-row">
                                <a-input v-model:value="sc.title" class="sh-in" :placeholder="$t('sv.general.shortcutTitle')" />
                                <a-input v-model:value="sc.url" class="sh-in" :placeholder="$t('sv.general.shortcutUrl')" />
                                <a-button :icon="DeleteOutlined" type="text" @click="removeShortcut(i)" />
                            </div>
                        </div>
                        <a-button :icon="PlusOutlined" @click="addShortcut">{{ $t('sv.general.shortcutAdd') }}</a-button>
                        <div class="hint">{{ $t('sv.general.shortcutHint') }}</div>
                    </a-form-item>
                </a-form>
            </a-collapse-panel>

            <a-collapse-panel key="general-reset">
                <template #header>
                    <div class="sec__title"><ReloadOutlined /> {{ $t('sv.general.reset') }}</div>
                </template>
                <div class="reset-row">
                    <div class="reset__txt">{{ $t('sv.general.resetTxt') }}</div>
                    <a-button danger @click="actions.resetAll()">{{ $t('sv.general.resetBtn') }}</a-button>
                </div>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>

<style scoped>
.sh-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
}
.sh-row {
    display: flex;
    gap: 6px;
    width: 100%;
}
/* 快捷方式的两个输入框等宽撑满，行尾的删除按钮不参与伸缩 */
.sh-in {
    flex: 1 1 auto;
}
.cfg-pending {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--el-color-warning);
    word-break: break-all;
}
</style>
