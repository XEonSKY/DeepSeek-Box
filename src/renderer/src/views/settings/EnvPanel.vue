<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AppstoreOutlined, CodeFilled, DeploymentUnitOutlined, DownloadOutlined, LinkOutlined, ReloadOutlined } from '@antdv-next/icons'
import { MIN_NODE_MAJOR, withV } from '@shared/version'
import TagLabel from '../../components/TagLabel.vue'
import { useSettingsStore } from './useSettingsStore'
import { refreshOperations } from '../../shell/progressStore'
import { useNodeEnv } from './useNodeEnv'
import { useNpmEnv } from './useNpmEnv'
import { usePnpmEnv } from './usePnpmEnv'

/**
 * 「环境」页：Node 运行时（系统自带 / 本地部署）、npm 与 pnpm 来源。
 *
 * 结构：三个折叠面板（与其它设置页一致的折叠卡片），每个面板内是「标签即选项」的一组标签页。
 * 三档的主题状态与动作各自成模块（useNodeEnv / useNpmEnv / usePnpmEnv）——它们互不相关，
 * 拆开后本文件只剩拼装模板与一次加载编排。
 *
 * 数据来自主进程的 `/node/status`、`/npm/status`、`/pnpm/status`（会联网取最新版本，
 * 主进程侧有缓存），所以只在进入本页时调一次。
 */

const { state, actions } = useSettingsStore()

const node = useNodeEnv(state, actions)
const npm = useNpmEnv(state)
const pnpm = usePnpmEnv(state)

const open = ref<string[]>(['env-node', 'env-npm', 'env-pnpm'])

/** 折叠面板：antdv 的 activeKey 不通过 v-model 更新，用 @change 同步（见 SystemPanel）。 */
function onOpenChange(keys: string[]): void {
    open.value = keys
}

onMounted(() => {
    // 先补一次快照：离开本页期间由别处（初始化向导）发起的操作也应当出现在这里。
    void refreshOperations()
    void node.loadStatus()
    void node.loadVersions()
    void node.loadInstalled()
    void npm.loadStatus()
    void npm.loadVersions()
    void npm.loadInstalled()
    void pnpm.loadStatus()
    void pnpm.loadVersions()
    void pnpm.loadInstalled()
})
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><DeploymentUnitOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.env') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.env') }}</div>
            </div>
        </div>

        <a-collapse :active-key="open" @change="onOpenChange">
            <a-collapse-panel key="env-node">
                <template #header>
                    <div class="sec__title"><DeploymentUnitOutlined /> {{ $t('sv.env.nodeRuntime') }}</div>
                </template>

                <a-tabs v-model:active-key="node.tab">
                    <!-- 系统自带：只比较版本，升级动作交给用户 -->
                    <a-tab-pane :tab="$t('sv.env.nodeSystem')" key="system">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ node.systemVersionText }}</code>
                            <a-tag v-if="node.probed && node.status?.system.outdated" color="orange">
                                {{ $t('sv.env.outdated') }}
                            </a-tag>
                            <a-tag v-else-if="node.probed && node.status?.system.present" color="green">
                                {{ $t('sv.env.upToDate') }}
                            </a-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestLts') }}</span>
                            <code class="kv__v">{{ node.latestText }}</code>
                        </div>

                        <div class="hint">
                            {{ node.latestUnknown ? $t('sv.env.latestUnknown') : $t('sv.env.systemUpdateHint') }}
                        </div>

                        <div v-if="node.probed && node.status?.system.outdated" class="act">
                            <a-button :icon="LinkOutlined" @click="node.openNodeDownload">
                                {{ $t('sv.env.systemUpdate') }}
                            </a-button>
                        </div>
                    </a-tab-pane>

                    <!-- 本地部署：由应用代管，可直接下载 / 更新 -->
                    <a-tab-pane :tab="$t('sv.env.nodeLocal')" key="local">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ node.localVersionText }}</code>
                            <a-tag v-if="node.probed && node.status?.local.outdated" color="orange">
                                {{ $t('sv.env.outdated') }}
                            </a-tag>
                            <a-tag v-else-if="node.probed && node.status?.local.present" color="green">
                                {{ $t('sv.env.upToDate') }}
                            </a-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestLts') }}</span>
                            <code class="kv__v">{{ node.latestText }}</code>
                        </div>

                        <div class="hint">
                            {{ node.latestUnknown ? $t('sv.env.latestUnknown') : $t('sv.env.localHint') }}
                        </div>

                        <a-progress
                            v-if="node.nodeBusy"
                            :percent="node.deployPhase === 'extract' ? 100 : node.percent"
                            :status="node.deployPhase === 'extract' ? 'active' : 'normal'"
                            :show-info="node.deployPhase !== 'extract'"
                            :stroke-width="6"
                            class="dep-progress"
                        />
                        <div v-if="node.nodeBusy" class="hint dep-info">
                            {{ node.deployPhase === 'extract' ? $t('sv.env.extracting') : node.progressInfo }}
                        </div>

                        <div v-if="node.nodeBusy" class="act">
                            <a-button :loading="node.canceling" @click="node.cancelInstall()">
                                {{ node.canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                            </a-button>
                        </div>

                        <div v-if="node.localNeedsAction" class="act">
                            <a-button type="primary" :icon="DownloadOutlined" :loading="node.nodeBusy" @click="node.installNode()">
                                {{
                                    node.nodeBusy
                                        ? $t('sv.env.deploying')
                                        : node.deployKind === 'update'
                                            ? $t('sv.env.localUpdate', { version: node.latestText })
                                            : $t('sv.env.localDeploy')
                                }}
                            </a-button>
                        </div>

                        <!-- 下载 / 切换任意版本：与 dsh 页的「版本管理」同一套交互与样式 -->
                        <div class="upd-sep" />
                        <a-form layout="vertical" class="vm-in">
                            <a-form-item :label="$t('sv.env.selectVersion')">
                                <div class="vm-row">
                                    <a-select
                                        v-model:value="node.selectedVersion"
                                        :options="node.nodeVersionOptions"
                                        show-search
                                        :placeholder="$t('sv.env.selectPlaceholder')"
                                        class="vm-sel"
                                        :disabled="node.versionsLoading || node.nodeBusy"
                                    />
                                    <a-button :icon="ReloadOutlined" :loading="node.versionsLoading" @click="node.loadVersions()">
                                        {{ $t('sv.env.refresh') }}
                                    </a-button>
                                    <a-button
                                        type="primary"
                                        :icon="DownloadOutlined"
                                        :loading="node.nodeBusy"
                                        :disabled="node.nodeBusy || node.versionsLoading || !node.selectedVersion || node.sameVersion(node.selectedVersion, node.status?.local.version)"
                                        @click="node.installNode(node.selectedVersion)"
                                    >
                                        {{ $t('sv.env.installVersion') }}
                                    </a-button>
                                </div>
                                <a-checkbox v-model:checked="node.includeNonLts"><TagLabel :label="$t('sv.env.includeNonLts')" /></a-checkbox>
                                <div v-if="node.selectedTooOld" class="warn">
                                    {{ $t('sv.env.tooOld', { major: MIN_NODE_MAJOR }) }}
                                </div>
                                <div class="hint">{{ $t('sv.env.versionListHint') }}</div>
                            </a-form-item>
                        </a-form>

                        <div class="upd-sep" />
                        <div class="iv">
                            <div class="iv__title">{{ $t('sv.env.installedVersions') }}</div>
                            <div v-if="!node.installed.installed.length" class="hint">{{ $t('sv.env.installedNone') }}</div>
                            <div v-else class="iv__list">
                                <div class="iv__thead">
                                    <span class="iv__c1">{{ $t('sv.env.colVersion') }}</span>
                                    <span class="iv__c2">{{ $t('sv.env.colStatus') }}</span>
                                    <span class="iv__c3">{{ $t('sv.env.colActions') }}</span>
                                </div>
                                <div class="iv__tbody">
                                    <div v-for="v in node.installed.installed" :key="v" class="iv__row">
                                        <span class="iv__c1"><code class="iv__ver">{{ withV(v) }}</code></span>
                                        <span class="iv__c2">
                                            <a-tag v-if="v === node.installed.active" color="green">
                                                {{ $t('sv.env.activeVersion') }}
                                            </a-tag>
                                            <span v-else class="iv__dash">—</span>
                                        </span>
                                        <span class="iv__c3">
                                            <a-button v-if="v !== node.installed.active" :loading="node.switching === v" @click="node.switchInstalled(v)">
                                                {{ $t('sv.env.switchVersion') }}
                                            </a-button>
                                            <a-button danger @click="node.removeInstalled(v)">
                                                {{ $t('sv.env.removeVersion') }}
                                            </a-button>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </a-tab-pane>
                </a-tabs>

                <div class="hint">{{ $t('sv.env.nodeRuntimeHint') }}</div>

                <div class="apply-sec">
                    <div class="apply-row">
                        <div class="apply__txt">
                            {{ $t('sv.env.applyTxt') }}
                            <div v-if="!node.runtimeUsable" class="warn">
                                {{ $t('sv.env.runtimeUnusable', { major: MIN_NODE_MAJOR }) }}
                            </div>
                        </div>
                        <a-button type="primary" :loading="state.applying" :disabled="!node.runtimeUsable" @click="actions.apply()">
                            {{ $t('sv.env.applyBtn') }}
                        </a-button>
                    </div>
                </div>
            </a-collapse-panel>

            <!-- npm 来源：与 node 同构（折叠卡片 → 三个标签 = 三个来源） -->
            <a-collapse-panel key="env-npm">
                <template #header>
                    <div class="sec__title"><AppstoreOutlined /> {{ $t('sv.env.npmSource') }}</div>
                </template>

                <div v-if="state.dshSource === 'global'" class="hint">{{ $t('sv.env.npmGlobalNote') }}</div>

                <a-tabs v-model:active-key="npm.tab">
                    <a-tab-pane v-for="t in npm.TABS" :key="t.key" :tab="$t(t.labelKey)">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ npm.versionText(t.key) }}</code>
                            <a-tag v-if="npm.probed && npm.status?.[t.key]?.outdated" color="orange">
                                {{ $t('sv.env.outdated') }}
                            </a-tag>
                            <a-tag v-else-if="npm.probed && npm.status?.[t.key]?.present" color="green">
                                {{ $t('sv.env.upToDate') }}
                            </a-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestVersion') }}</span>
                            <code class="kv__v">{{ npm.latestText }}</code>
                        </div>

                        <div class="hint">{{ npm.latestUnknown ? $t('sv.env.latestUnknown') : $t(t.hintKey) }}</div>

                        <div v-if="npm.needsAction(t.key)" class="act">
                            <a-button
                                type="primary"
                                :icon="DownloadOutlined"
                                :loading="npm.busy"
                                @click="npm.install()"
                            >
                                {{ npm.actionLabel(t.key) }}
                            </a-button>
                        </div>

                        <div v-if="t.key === 'bundled'" class="iv">
                            <div class="iv__title">{{ $t('sv.env.installedVersions') }}</div>
                            <div v-if="!npm.installed.installed.length" class="hint">{{ $t('sv.env.installedNone') }}</div>
                            <div v-else class="iv__list">
                                <div class="iv__thead">
                                    <span class="iv__c1">{{ $t('sv.env.colVersion') }}</span>
                                    <span class="iv__c2">{{ $t('sv.env.colStatus') }}</span>
                                    <span class="iv__c3">{{ $t('sv.env.colActions') }}</span>
                                </div>
                                <div class="iv__tbody">
                                    <div v-for="v in npm.installed.installed" :key="v" class="iv__row">
                                        <span class="iv__c1"><code class="iv__ver">{{ withV(v) }}</code></span>
                                        <span class="iv__c2">
                                            <a-tag v-if="v === npm.installed.active" color="green">
                                                {{ $t('sv.env.activeVersion') }}
                                            </a-tag>
                                            <span v-else class="iv__dash">—</span>
                                        </span>
                                        <span class="iv__c3">
                                            <a-button v-if="v !== npm.installed.active" :loading="npm.switching === v" @click="npm.switchInstalled(v)">
                                                {{ $t('sv.env.switchVersion') }}
                                            </a-button>
                                            <a-button danger @click="npm.removeInstalled(v)">
                                                {{ $t('sv.env.removeVersion') }}
                                            </a-button>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </a-tab-pane>
                </a-tabs>

                <div v-if="npm.busy" class="act">
                    <a-progress
                        v-if="npm.progressSeen"
                        :percent="npm.progressPhase === 'extract' ? 100 : npm.progressPercent"
                        :status="npm.progressPhase === 'extract' ? 'active' : 'normal'"
                        :show-info="npm.progressPhase !== 'extract'"
                        :stroke-width="6"
                        class="dep-progress"
                    />
                    <div v-if="npm.progressSeen" class="hint dep-info">
                        {{ npm.progressPhase === 'extract' ? $t('sv.env.extracting') : npm.progressInfo }}
                    </div>
                    <a-button :loading="npm.canceling" @click="npm.cancelInstall()">
                        {{ npm.canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                    </a-button>
                </div>

                <!-- 版本选择器放在标签之外共用：三个来源都能装任意版本，抄三遍纯属重复 -->
                <div class="upd-sep" />
                <a-form layout="vertical" class="vm-in">
                    <a-form-item :label="$t('sv.env.selectVersion')">
                        <div class="vm-row">
                            <a-select
                                v-model:value="npm.selected"
                                :options="npm.versionOptions"
                                show-search
                                :placeholder="$t('sv.env.selectPlaceholder')"
                                class="vm-sel"
                                :disabled="npm.versionsLoading || npm.busy"
                            />
                            <a-button :icon="ReloadOutlined" :loading="npm.versionsLoading" @click="npm.loadVersions()">
                                {{ $t('sv.env.refresh') }}
                            </a-button>
                            <a-button
                                type="primary"
                                :icon="DownloadOutlined"
                                :loading="npm.busy"
                                :disabled="npm.busy || npm.versionsLoading || !npm.selected || npm.sameVersion(npm.selected, npm.cur?.version)"
                                @click="npm.install(npm.selected)"
                            >
                                {{ $t('sv.env.installVersion') }}
                            </a-button>
                        </div>
                        <a-checkbox v-model:checked="npm.includePre">{{ $t('sv.env.includePrerelease') }}</a-checkbox>
                        <div class="hint">{{ $t('sv.env.npmListHint') }}</div>
                    </a-form-item>
                </a-form>
                <div class="hint">{{ $t('sv.env.npmNoRestart') }}</div>
            </a-collapse-panel>

            <!-- pnpm 来源：与 npm 同构（折叠卡片 → 两个标签 = 两个来源；pnpm 没有「本地 Node 自带」档） -->
            <a-collapse-panel key="env-pnpm">
                <template #header>
                    <div class="sec__title"><CodeFilled /> {{ $t('sv.env.pnpmSource') }}</div>
                </template>

                <a-tabs v-model:active-key="pnpm.tab">
                    <a-tab-pane v-for="t in pnpm.TABS" :key="t.key" :tab="$t(t.labelKey)">
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.currentVersion') }}</span>
                            <code class="kv__v">{{ pnpm.versionText(t.key) }}</code>
                            <a-tag v-if="pnpm.probed && pnpm.status?.[t.key]?.outdated" color="orange">
                                {{ $t('sv.env.outdated') }}
                            </a-tag>
                            <a-tag v-else-if="pnpm.probed && pnpm.status?.[t.key]?.present" color="green">
                                {{ $t('sv.env.upToDate') }}
                            </a-tag>
                        </div>
                        <div class="kv">
                            <span class="kv__k">{{ $t('sv.env.latestVersion') }}</span>
                            <code class="kv__v">{{ pnpm.latestText }}</code>
                        </div>

                        <div class="hint">{{ pnpm.latestUnknown ? $t('sv.env.latestUnknown') : $t(t.hintKey) }}</div>

                        <div v-if="pnpm.needsAction(t.key)" class="act">
                            <a-button type="primary" :icon="DownloadOutlined" :loading="pnpm.busy" @click="pnpm.install()">
                                {{ pnpm.actionLabel(t.key) }}
                            </a-button>
                        </div>

                        <!-- 只有内置来源是「版本化目录」，才有已安装列表可切换 / 删除 -->
                        <div v-if="t.key === 'bundled'" class="iv">
                            <div class="iv__title">{{ $t('sv.env.installedVersions') }}</div>
                            <div v-if="!pnpm.installed.installed.length" class="hint">{{ $t('sv.env.installedNone') }}</div>
                            <div v-else class="iv__list">
                                <div class="iv__thead">
                                    <span class="iv__c1">{{ $t('sv.env.colVersion') }}</span>
                                    <span class="iv__c2">{{ $t('sv.env.colStatus') }}</span>
                                    <span class="iv__c3">{{ $t('sv.env.colActions') }}</span>
                                </div>
                                <div class="iv__tbody">
                                    <div v-for="v in pnpm.installed.installed" :key="v" class="iv__row">
                                        <span class="iv__c1"><code class="iv__ver">{{ withV(v) }}</code></span>
                                        <span class="iv__c2">
                                            <a-tag v-if="v === pnpm.installed.active" color="green">
                                                {{ $t('sv.env.activeVersion') }}
                                            </a-tag>
                                            <span v-else class="iv__dash">—</span>
                                        </span>
                                        <span class="iv__c3">
                                            <a-button v-if="v !== pnpm.installed.active" :loading="pnpm.switching === v" @click="pnpm.switchInstalled(v)">
                                                {{ $t('sv.env.switchVersion') }}
                                            </a-button>
                                            <a-button danger @click="pnpm.removeInstalled(v)">
                                                {{ $t('sv.env.removeVersion') }}
                                            </a-button>
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </a-tab-pane>
                </a-tabs>

                <div v-if="pnpm.busy" class="act">
                    <a-progress
                        v-if="pnpm.progress"
                        :percent="pnpm.progress.phase === 'extract' ? 100 : pnpm.progress.percent"
                        :status="pnpm.progress.phase === 'extract' ? 'active' : 'normal'"
                        :show-info="pnpm.progress.phase !== 'extract'"
                        :stroke-width="6"
                        class="dep-progress"
                    />
                    <div v-if="pnpm.progress" class="hint dep-info">
                        {{ pnpm.progress.phase === 'extract' ? $t('sv.env.extracting') : pnpm.progressInfo }}
                    </div>
                    <a-button :loading="pnpm.canceling" @click="pnpm.cancelInstall()">
                        {{ pnpm.canceling ? $t('sv.env.canceling') : $t('sv.env.cancelInstall') }}
                    </a-button>
                </div>

                <!-- 版本选择器放在标签之外共用：两个来源都能装任意版本 -->
                <div class="upd-sep" />
                <a-form layout="vertical" class="vm-in">
                    <a-form-item :label="$t('sv.env.selectVersion')">
                        <div class="vm-row">
                            <a-select
                                v-model:value="pnpm.selected"
                                :options="pnpm.versionOptions"
                                show-search
                                :placeholder="$t('sv.env.selectPlaceholder')"
                                class="vm-sel"
                                :disabled="pnpm.versionsLoading || pnpm.busy"
                            />
                            <a-button :icon="ReloadOutlined" :loading="pnpm.versionsLoading" @click="pnpm.loadVersions()">
                                {{ $t('sv.env.refresh') }}
                            </a-button>
                            <a-button
                                type="primary"
                                :icon="DownloadOutlined"
                                :loading="pnpm.busy"
                                :disabled="pnpm.busy || pnpm.versionsLoading || !pnpm.selected || pnpm.sameVersion(pnpm.selected, pnpm.cur?.version)"
                                @click="pnpm.install(pnpm.selected)"
                            >
                                {{ $t('sv.env.installVersion') }}
                            </a-button>
                        </div>
                        <a-checkbox v-model:checked="pnpm.includePre">{{ $t('sv.env.includePrerelease') }}</a-checkbox>
                        <div class="hint">{{ $t('sv.env.pnpmListHint') }}</div>
                    </a-form-item>
                </a-form>
                <div class="hint">{{ $t('sv.env.pnpmPluginNote') }}</div>
            </a-collapse-panel>
        </a-collapse>
    </div>
</template>
