<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { FolderOutlined, ReloadOutlined, SettingOutlined, RocketOutlined, ThunderboltOutlined, ApiOutlined } from '@antdv-next/icons'
import type { ConfigDirInfo } from '@shared/types'
import TagLabel from '../../components/TagLabel.vue'
import ProxyFields from '../../components/ProxyFields.vue'
import { useSettingsStore } from './useSettingsStore'
import { useSystemSettings } from './useSystemSettings'
import { confirmDialog } from '../../lib/confirm'

/**
 * 「常规」页 —— 程序的基础行为，由原先的「常规」「系统与性能」「网络」三页合并而来。
 *
 * ## 为什么合成一页
 *
 * 那三页的内容同属一件事：**这个程序本身怎么运行**（工作目录、端口、开机自启、
 * 图形加速、镜像源、代理）。拆成三页时用户要改一个"程序行为"得先猜它在哪一页，
 * 而每一页实际上都只有两三组开关 —— 分成三个菜单项带来的导航成本高于内容本身。
 * 合并后一页里按「运行 / 启动 / 性能 / 网络 / 配置目录 / 恢复默认」分组，
 * 折叠面板让长页面依然可扫读。下载并发固定自动（内核按核心数自适应），
 * 下载任务与下载模块自身的配置在「下载」页。
 *
 * ## 折叠面板的分组（顺序即使用频率）
 *
 *  1. **运行** —— 工作目录与端口（最常改）；
 *  2. **启动** —— 开机自启、用系统浏览器打开 DSH、关闭后是否驻留后台；
 *  3. **性能** —— 图形加速（改动需重启，故紧邻启动）；
 *  4. **网络** —— npm 镜像源与代理；
 *  5. **配置文件夹** —— 数据落在哪；
 *  6. **恢复默认设置** —— 兜底。
 */
const { state, actions } = useSettingsStore()
const { t } = useI18n({ useScope: 'global' })
const { onGpuAccelChange } = useSystemSettings()

// a-collapse：默认全部展开。用 :active-key + @change（Antdv 未声明 update:activeKey 事件）。
const open = ref<string[]>([
    'general-run',
    'general-startup',
    'general-performance',
    'general-network',
    'general-configdir',
    'general-reset'
])

/** a-collapse 展开项变化。 */
function onOpenChange(keys: string[]): void {
    open.value = keys
}

/** 镜像源下拉：a-select 用 :options（项目约定，见 DshWizard.vue）；用 computed 跟随语言切换。 */
const registryOptions = computed(() => [
    { value: 'npmjs', label: t('sv.dsh.registryNpmjs') },
    { value: 'npmmirror', label: t('sv.dsh.registryNpmmirror') }
])

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

            <a-collapse-panel key="general-startup">
                <template #header>
                    <div class="sec__title"><RocketOutlined /> {{ $t('sv.system.startup') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t"><TagLabel :label="$t('sv.system.autoLaunch')" /></div>
                        <div class="au__desc">{{ $t('sv.system.autoLaunchHint') }}</div>
                    </div>
                    <a-switch v-model:checked="state.autoLaunch" />
                </div>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.system.openInBrowser') }}</div>
                        <div class="au__desc">{{ $t('sv.system.openInBrowserHint') }}</div>
                    </div>
                    <a-switch v-model:checked="state.openDshInBrowser" />
                </div>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.general.closeKeepRunning') }}</div>
                        <div class="au__desc">{{ $t('sv.general.closeKeepRunningHint') }}</div>
                    </div>
                    <a-switch v-model:checked="state.closeKeepRunning" />
                </div>
            </a-collapse-panel>

            <a-collapse-panel key="general-performance">
                <template #header>
                    <div class="sec__title"><ThunderboltOutlined /> {{ $t('sv.system.performance') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.system.gpuAccel') }}</div>
                        <div class="au__desc">{{ $t('sv.system.gpuAccelHint') }}</div>
                    </div>
                    <a-switch :checked="state.hardwareAcceleration" @change="onGpuAccelChange" />
                </div>
            </a-collapse-panel>

            <a-collapse-panel key="general-network">
                <template #header>
                    <div class="sec__title"><ApiOutlined /> {{ $t('sv.network.registry') }}</div>
                </template>
                <a-form layout="vertical">
                    <a-form-item :label="$t('sv.network.registry')">
                        <a-select v-model:value="state.npmRegistry" :options="registryOptions" class="reg" />
                        <div class="hint">{{ $t('sv.network.registryHint') }}</div>
                    </a-form-item>
                    <!-- 代理字段与首次安装向导共用同一组件（见 components/ProxyFields.vue） -->
                    <ProxyFields
                        v-model:enabled="state.proxyEnabled"
                        v-model:protocol="state.proxyProtocol"
                        v-model:host="state.proxyHost"
                        v-model:port="state.proxyPort"
                        v-model:scope="state.proxyScope"
                    />
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
.cfg-pending {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--el-color-warning);
    word-break: break-all;
}
/* 镜像源下拉占满表单项宽度（a-select 默认按内容宽）。 */
.reg {
    width: 100%;
}
</style>
