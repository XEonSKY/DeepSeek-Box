<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderOutlined, ReloadOutlined, PoweroffOutlined, SettingOutlined, DesktopOutlined, PlusOutlined, DeleteOutlined } from '@antdv-next/icons'
import type { ConfigDirInfo } from '@shared/types'
import { useSettingsStore } from './useSettingsStore'
import { SEARCH_ENGINE_IDS, ENGINE_LABEL_KEY } from '../../lib/engines'

const { state, actions } = useSettingsStore()
const { t } = useI18n({ useScope: 'global' })

// el-collapse：默认全部展开
const open = ref(['general-run', 'general-configdir', 'general-close', 'general-newtab', 'general-reset'])

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
    try {
        await ElMessageBox.confirm(t('sv.general.configDirConfirm', { to: next.pending.to }), t('sv.general.configDirConfirmTitle'), {
            confirmButtonText: t('sv.general.configDirOk'),
            cancelButtonText: t('sv.general.configDirCancel'),
            type: 'warning'
        })
        // 保留更改：真正的迁移等到下次重启的引导阶段执行
        ElMessage.info(t('sv.general.configDirWillMigrate', { to: next.pending.to }))
    } catch {
        cfg.value = await window.api.post('/config-dir/revert')
        ElMessage.info(t('sv.general.configDirReverted'))
    }
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
            <div class="dsh-brand__icon"><el-icon :size="34"><SettingOutlined /></el-icon></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.general') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.general') }}</div>
            </div>
        </div>
        <el-collapse v-model="open">
            <el-collapse-item name="general-run" :title="$t('sv.general.run')">
                <template #title>
                    <div class="sec__title"><el-icon><SettingOutlined /></el-icon> {{ $t('sv.general.run') }}</div>
                </template>
                <el-form label-position="top">
                    <el-form-item :label="$t('sv.general.workspace')">
                        <div class="row">
                            <el-input v-model="state.workspace" :readonly="true" :placeholder="$t('sv.general.workspacePlaceholder')" />
                            <el-button type="primary" :icon="FolderOutlined" @click="actions.browseWorkspace()">{{ $t('sv.general.browse') }}</el-button>
                        </div>
                        <div class="hint">{{ $t('sv.general.workspaceHint') }}</div>
                    </el-form-item>

                    <el-form-item :label="$t('sv.general.port')">
                        <div class="row">
                            <el-radio-group v-model="state.portMode">
                                <el-radio-button :value="'auto'">{{ $t('sv.general.portAuto') }}</el-radio-button>
                                <el-radio-button :value="'manual'">{{ $t('sv.general.portManual') }}</el-radio-button>
                            </el-radio-group>
                            <el-input-number v-if="state.portMode === 'manual'" v-model="state.manualPort" :min="1" :max="65535" class="num" />
                        </div>
                        <div class="hint">{{ $t('sv.general.portHint') }}</div>
                    </el-form-item>
                </el-form>
            </el-collapse-item>

            <el-collapse-item name="general-configdir">
                <template #title>
                    <div class="sec__title"><el-icon><FolderOutlined /></el-icon> {{ $t('sv.general.configDirSection') }}</div>
                </template>
                <el-form label-position="top">
                    <el-form-item :label="$t('sv.general.configDir')">
                        <div class="row">
                            <el-input :model-value="cfg?.current ?? ''" readonly />
                            <el-button type="primary" :icon="FolderOutlined" @click="changeConfigDir">{{ $t('sv.general.configDirChange') }}</el-button>
                            <el-button v-if="cfg?.override" @click="resetConfigDir">{{ $t('sv.general.configDirReset') }}</el-button>
                        </div>
                        <div class="hint">{{ $t('sv.general.configDirHint') }}</div>
                        <div v-if="cfg?.pending" class="cfg-pending">
                            <span>{{ $t('sv.general.configDirPending', { to: cfgPendingTo }) }}</span>
                            <el-button link type="primary" @click="restartNow">{{ $t('sv.general.configDirRestart') }}</el-button>
                            <el-button link type="danger" @click="cancelPendingMigration">{{ $t('sv.general.configDirCancel') }}</el-button>
                        </div>
                    </el-form-item>
                </el-form>
            </el-collapse-item>

            <el-collapse-item name="general-close">
                <template #title>
                    <div class="sec__title"><el-icon><PoweroffOutlined /></el-icon> {{ $t('sv.general.closeSection') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.general.closeKeepRunning') }}</div>
                        <div class="au__desc">{{ $t('sv.general.closeKeepRunningHint') }}</div>
                    </div>
                    <el-switch v-model="state.closeKeepRunning" />
                </div>
            </el-collapse-item>

            <el-collapse-item name="general-newtab">
                <template #title>
                    <div class="sec__title"><el-icon><DesktopOutlined /></el-icon> {{ $t('sv.general.newTabTitle') }} &amp; {{ $t('sv.general.engineLabel') }}</div>
                </template>
                <el-form label-position="top">
                    <el-form-item :label="$t('sv.general.engineLabel')">
                        <el-select v-model="state.searchEngine" style="width: 100%">
                            <el-option v-for="id in SEARCH_ENGINE_IDS" :key="id" :value="id" :label="$t(ENGINE_LABEL_KEY[id])" />
                        </el-select>
                    </el-form-item>

                    <el-form-item :label="$t('sv.general.newTabTitle')">
                        <el-radio-group v-model="state.newTabMode">
                            <el-radio :value="'builtin'">{{ $t('sv.general.newTabModeBuiltin') }}</el-radio>
                            <el-radio :value="'url'">{{ $t('sv.general.newTabModeUrl') }}</el-radio>
                        </el-radio-group>
                        <el-input
                            v-if="state.newTabMode === 'url'"
                            v-model="state.newTabUrl"
                            :placeholder="$t('sv.general.newTabUrlPlaceholder')"
                            style="margin-top: 8px"
                        />
                    </el-form-item>

                    <el-form-item :label="$t('sv.general.shortcuts')">
                        <div class="sh-list">
                            <div v-for="(sc, i) in state.shortcuts" :key="i" class="sh-row">
                                <el-input v-model="sc.title" :placeholder="$t('sv.general.shortcutTitle')" size="small" />
                                <el-input v-model="sc.url" :placeholder="$t('sv.general.shortcutUrl')" size="small" />
                                <el-button :icon="DeleteOutlined" text size="small" @click="removeShortcut(i)" />
                            </div>
                        </div>
                        <el-button :icon="PlusOutlined" size="small" plain @click="addShortcut">{{ $t('sv.general.shortcutAdd') }}</el-button>
                        <div class="hint">{{ $t('sv.general.shortcutHint') }}</div>
                    </el-form-item>
                </el-form>
            </el-collapse-item>

            <el-collapse-item name="general-reset">
                <template #title>
                    <div class="sec__title"><el-icon><ReloadOutlined /></el-icon> {{ $t('sv.general.reset') }}</div>
                </template>
                <div class="reset-row">
                    <div class="reset__txt">{{ $t('sv.general.resetTxt') }}</div>
                    <el-button plain type="danger" @click="actions.resetAll()">{{ $t('sv.general.resetBtn') }}</el-button>
                </div>
            </el-collapse-item>
        </el-collapse>
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
.sh-row .el-input {
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
