<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppstoreOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { DshPluginEntry, DshPluginsInfo } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { tt } from '../../lib/locales'
import { confirmDialog } from '../../lib/confirm'
import { refreshOperations, useOperation } from '../../shell/progressStore'
import TagLabel from '../../components/TagLabel.vue'

/**
 * 「插件」页：管理 dsh 各 profile 的插件（组合包），决定启动时加载哪些。
 *
 * 数据与操作都走主进程（`/dsh/plugins`）：启停只改 `dsh.profile.bundles`，
 * 安装 / 卸载转发 `dsh plugin`。
 *
 * **pnpm 不在这里管**：用哪个 pnpm（系统自带 / 内置）、下没下载、要不要升级，统一在
 * 「设置 → 环境 → pnpm 来源」里配置（本页只在首次准备内置 pnpm 时给一行提示）。
 * profile 位于 `$DSH_HOME/profiles/<name>`，与 Box 配置目录无关。
 */

const info = ref<DshPluginsInfo | null>(null)
const profile = ref('web')
const loading = ref(false)
/** 安装 / 卸载 / 启停在途：禁用重复操作。 */
const busy = ref(false)
/**
 * 插件安装会先把内置 pnpm 准备好（首次要下载）—— 那一步的进度现在从共享 store 读。
 *
 * 同一个 kind 既能是「插件安装本身」（dsh-plugin）也可能是它内部触发的「pnpm 下载」，
 * 二者都该让这一行提示亮起来。
 */
const { op: pluginOp } = useOperation('dsh-plugin')
const { op: pnpmOp } = useOperation('pnpm')
const pnpmPreparing = computed(() => pluginOp.value !== null || pnpmOp.value !== null)
const installSpec = ref('')
const restarting = ref(false)

/** 折叠面板展开项，默认全部展开（与其它设置页一致）。用 `:active-key` + `@change`：
 *  Antdv 未声明 `update:activeKey` 事件，写 v-model 不生效。 */
const open = ref<string[]>(['plugins-pnpm', 'plugins-list'])

/** a-collapse 展开项变化。 */
function onOpenChange(keys: string[]): void {
    open.value = keys
}

const profiles = computed(() => info.value?.profiles ?? [])
const entries = computed(() => info.value?.entries ?? [])
const manifestPath = computed(() => info.value?.manifestPath ?? '')
/** a-select 用 :options（项目约定，见 DshWizard.vue）。 */
const profileOptions = computed(() => profiles.value.map((p) => ({ value: p, label: p })))

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
        // 安装链路可能顺带下载了 pnpm：取一次快照把已结束的进度收起（事件流不含结束信号）。
        await refreshOperations()
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

onMounted(() => {
    // 取一次快照：进入本页时若已有插件安装 / pnpm 下载在跑（例如刚从初始化页跳过来），提示要立刻可见。
    void refreshOperations()
    void load()
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

        <!-- 分节与其它设置页一致：a-collapse 折叠卡片，节标题放 #header 里的 .sec__title -->
        <a-collapse :active-key="open" @change="onOpenChange">
            <a-collapse-panel key="plugins-list">
                <template #header>
                    <div class="sec__title"><AppstoreOutlined /> <TagLabel :label="$t('sv.plugins.listTitle')" /></div>
                </template>
                <!-- 插件列表：profile 选择 + 启停 + 安装 / 卸载 -->
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
                <div v-if="pnpmPreparing" class="hint">{{ $t('sv.plugins.pnpmPreparing') }}</div>
                <div class="hint">{{ $t('sv.plugins.installHint') }}</div>
                <div class="hint">{{ $t('sv.plugins.pnpmWhere') }}</div>
                <div class="hint">{{ $t('sv.plugins.restartHint') }}</div>
                <div class="act">
                    <a-button :icon="ReloadOutlined" :loading="restarting" @click="restartDsh">{{ $t('sv.plugins.restart') }}</a-button>
                </div>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>

<style scoped>
/* 只留本组件专用规则；通用样式（.kv/.act/.dep-info/.iv/.hint/...）在 styles/settings.css。 */
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
