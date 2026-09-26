<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { AppstoreOutlined, ReloadOutlined, FolderOpenOutlined, SyncOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import type { ExtInfo, ExtensionsInfo } from '@shared/extensions'
import { extApi, extErrorMessage, extT } from '../renderer-api'

/**
 * 「扩展」页：列出全部已发现扩展，支持即时停用 / 启用、重载与清除崩溃记录，
 * 并在安全模式时给出显式退出入口；下方是扩展包（zips）区块。
 *
 * 这一页由内置扩展 `xeonsky.extm` 贡献 —— 管理页本身也走扩展控制点，外壳不为它写特例。
 * 但**基础管理端点**（列表 / 启停 / 重载 / 安全模式）属于内核模块
 * （`main/modules/extensions.ts`），因为即便所有扩展被安全模式停掉，用户也要能
 * 操作它们，自助路径不能依赖扩展加载成功。
 *
 * 列出的是主进程裁决的**全部**条目（含失败 / 跳过 / 停用），
 * 因为排查时最需要知道的是"为什么它没跑起来"。
 *
 * 本文件是内置扩展 `xeonsky.extm` 的渲染层实现，与它的主进程入口（同目录 `main.ts`）
 * 和清单（同目录 `manifest.ts`）放在一起 —— 三者构成这个扩展的完整定义，改它不必去别处找。
 * 挂载入口见 `renderer/src/extensions/panels.ts` 的 `LOCAL_VIEWS`。
 *
 * 对外依赖刻意收在 `../renderer-api`（渲染层扩展 API 面）里，不 import 外壳内部模块 ——
 * 与主进程侧「扩展不直接 import 内核」是同一条原则。
 */

const info = ref<ExtensionsInfo | null>(null)
const loading = ref(false)
let offChanged: (() => void) | null = null

// ---- 扩展包（zip / xeonsky-ext 形态的外部扩展） -----------------------------

/** 一个扩展包（经本扩展主进程的包管理 IPC 返回）。 */
interface PkgEntry {
    file: string
    stem: string
    format: string
}
/** 本扩展主进程侧 IPC 的通道前缀。 */
const PKG_CHANNEL = 'ext:xeonsky.extm'
/** 包管理功能是否就绪（端点不可用时为 false，页面降级少一个区块）。 */
const pkgReady = ref(false)
/** 7-Zip 是否可用（不可用 = 压缩包扩展加载被禁用）。 */
const zipAvailable = ref(true)
/** 已放置的包文件列表。 */
const packages = ref<PkgEntry[]>([])

/** 拉取包管理状态与包列表（失败一律降级为「不可用」，不让包区块拖垮整页）。 */
async function reloadPackages(): Promise<void> {
    try {
        const st = await extApi.ext.invoke(`${PKG_CHANNEL}:pkgStatus`) as { available: boolean; zipAvailable: boolean }
        pkgReady.value = st.available
        zipAvailable.value = st.zipAvailable
        if (!st.available || !info.value?.externalDir) {
            packages.value = []
            return
        }
        const r = await extApi.ext.invoke(`${PKG_CHANNEL}:listPackages`, { dir: info.value.externalDir }) as { packages: PkgEntry[] }
        packages.value = r.packages ?? []
    } catch {
        pkgReady.value = false
        packages.value = []
    }
}

/** 拉取扩展列表。 */
async function reload(): Promise<void> {
    loading.value = true
    try {
        info.value = await extApi.get('/extensions')
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        loading.value = false
    }
}

/**
 * 停用 / 启用某扩展，并**立即重载**它（卸载 → 按当前磁盘状态重新激活）。
 *
 * 为什么是「保存后再重载」而不是直接调重载：加载器的停用标记写在磁盘状态里
 * （`state.disk.disabled`），重载时才会读取它来决定是否激活；所以顺序必须是
 * 「写标记 → 重载」。这样用户点一下开关就能看到结果，不必重启应用。
 *
 * 系统扩展没有开关（`removable === false`），故这里不处理 kind === 'system' 的情况。
 */
async function toggle(ext: ExtInfo, next: boolean): Promise<void> {
    loading.value = true
    try {
        await extApi.put('/extensions/:id/enabled', { params: { id: ext.id }, body: { enabled: next } })
        // 立刻重载，让启停生效。
        info.value = await extApi.post('/extensions/:id/reload', { params: { id: ext.id } })
        const now = info.value.entries.find((e) => e.id === ext.id)
        if (now?.status === 'failed') {
            ElMessage.error(extT('ext.xeonskyExtm.page.toggleFailed', { name: ext.name }))
        } else {
            ElMessage.success(extT(next ? 'ext.xeonskyExtm.page.toggledOn' : 'ext.xeonskyExtm.page.toggledOff', { name: ext.name }))
        }
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
        await reload()
    } finally {
        loading.value = false
    }
}

/** 清除某扩展的崩溃记录并解除停用（「我已知道并要试一次」），随后立即重载。 */
async function forgive(ext: ExtInfo): Promise<void> {
    loading.value = true
    try {
        await extApi.post('/extensions/:id/forgive', { params: { id: ext.id } })
        info.value = await extApi.post('/extensions/:id/reload', { params: { id: ext.id } })
        ElMessage.success(extT('ext.xeonskyExtm.page.forgiven'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        loading.value = false
    }
}

/** 重载单个扩展（卸载 → 按当前磁盘状态重新激活；改完代码立刻生效）。 */
async function reloadExt(ext: ExtInfo): Promise<void> {
    loading.value = true
    try {
        info.value = await extApi.post('/extensions/:id/reload', { params: { id: ext.id } })
        ElMessage.success(extT('ext.xeonskyExtm.page.reloaded', { name: ext.name }))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        loading.value = false
    }
}

/** 重载全部扩展（等价于重启加载器，不重启应用）。 */
async function reloadAll(): Promise<void> {
    loading.value = true
    try {
        info.value = await extApi.post('/extensions/reload-all')
        ElMessage.success(extT('ext.xeonskyExtm.page.reloadedAll'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        loading.value = false
    }
}

/** 退出安全模式并清空崩溃计数，随后重载全部。 */
async function exitSafeMode(): Promise<void> {
    loading.value = true
    try {
        await extApi.post('/extensions/exit-safe-mode')
        info.value = await extApi.post('/extensions/reload-all')
        ElMessage.success(extT('ext.xeonskyExtm.page.safeExited'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        loading.value = false
    }
}

/** 在文件管理器里打开外部扩展目录。 */
async function openDir(): Promise<void> {
    try {
        await extApi.post('/extensions/open-dir')
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    }
}

/** 状态标签的颜色。 */
function statusColor(status: ExtInfo['status']): string {
    if (status === 'active') return 'green'
    if (status === 'failed') return 'red'
    if (status === 'disabled') return 'default'
    return 'orange'
}

/** 状态标签的文案键（外层统一加 `ext.xeonskyExtm.page.` 前缀）。 */
const STATUS_KEY: Record<ExtInfo['status'], string> = {
    active: 'stActive',
    disabled: 'stDisabled',
    failed: 'stFailed',
    skipped: 'stSkipped'
}

/** 来源（三级）的文案键。 */
const KIND_KEY: Record<ExtInfo['kind'], string> = {
    system: 'kindSystem',
    builtin: 'kindBuiltin',
    external: 'kindExternal'
}

onMounted(() => {
    void reload()
    void reloadPackages()
    offChanged = extApi.on('extensions:changed', () => {
        void reload()
        void reloadPackages()
    })
})
onBeforeUnmount(() => offChanged?.())
</script>

<template>
    <div class="panel" v-loading="loading">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><AppstoreOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('ext.xeonskyExtm.nav') }}</div>
                <div class="dsh-brand__desc">{{ $t('ext.xeonskyExtm.intro') }}</div>
            </div>
        </div>

        <a-alert v-if="info?.safeMode" type="error" show-icon :message="$t('ext.xeonskyExtm.page.safeMode')">
            <template #description>{{ $t('ext.xeonskyExtm.page.safeModeDesc') }}</template>
        </a-alert>

        <!-- 标题与操作同一行：标题左、按钮右；按钮用标准大小的按钮组，组内只留图标与必要文字。 -->
        <div class="extpage__bar">
            <div class="extpage__head">{{ $t('ext.xeonskyExtm.page.listTitle') }}</div>
            <a-space :size="8">
                <a-button @click="reload">
                    <template #icon><ReloadOutlined /></template>
                    {{ $t('ext.xeonskyExtm.page.refresh') }}
                </a-button>
                <!-- 全部重载：等价于重启加载器（不重启应用），改完扩展代码后一键生效。 -->
                <a-button @click="reloadAll">
                    <template #icon><SyncOutlined /></template>
                    {{ $t('ext.xeonskyExtm.page.reloadAll') }}
                </a-button>
                <!-- 打开扩展目录：图标 + 目录路径；路径过长时省略，完整值放 title。 -->
                <a-button @click="openDir">
                    <template #icon><FolderOpenOutlined /></template>
                    <span class="extpage__dir" :title="info?.externalDir">{{ info?.externalDir }}</span>
                </a-button>
                <a-button v-if="info?.safeMode" danger @click="exitSafeMode">
                    {{ $t('ext.xeonskyExtm.page.exitSafe') }}
                </a-button>
            </a-space>
        </div>

        <!--
            扩展包区块：zip / xeonsky-ext 形态的外部扩展。包管理未就绪时整块降级为一条提示；
            7-Zip 不可用时明确告知「压缩包加载已禁用」。
        -->
        <template v-if="pkgReady">
            <div class="extpage__bar extpage__bar--pkg">
                <div class="extpage__head">{{ $t('ext.xeonskyExtm.page.pkgTitle') }}</div>
            </div>
            <a-alert v-if="!zipAvailable" type="warning" show-icon :message="$t('ext.xeonskyExtm.page.pkgDisabled')" class="extpage__pkg-alert" />
            <div v-else class="iv extpage__pkgs">
                <div v-if="!packages.length" class="hint">{{ $t('ext.xeonskyExtm.page.pkgEmpty') }}</div>
                <div v-else class="iv__list extpage__pkgs-list">
                    <div class="iv__thead">
                        <span class="iv__c-name">{{ $t('ext.xeonskyExtm.page.pkgColName') }}</span>
                        <span class="iv__c-kind">{{ $t('ext.xeonskyExtm.page.pkgColFormat') }}</span>
                    </div>
                    <div class="iv__tbody">
                        <div v-for="p in packages" :key="p.file" class="iv__row">
                            <span class="iv__c-name"><code class="extpage__id" :title="p.file">{{ p.file }}</code></span>
                            <span class="iv__c-kind"><a-tag>{{ p.format }}</a-tag></span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="hint extpage__pkg-hint">{{ $t('ext.xeonskyExtm.page.pkgHint') }}</div>
        </template>
        <a-alert v-else type="info" show-icon :message="$t('ext.xeonskyExtm.page.pkgUnavailable')" class="extpage__pkg-alert" />

        <div class="iv extpage__list">
            <div v-if="info && !info.entries.length" class="hint">{{ $t('ext.xeonskyExtm.page.empty') }}</div>
            <div v-else class="iv__list">
                <div class="iv__thead">
                    <span class="iv__c-name">{{ $t('ext.xeonskyExtm.page.colName') }}</span>
                    <span class="iv__c-kind">{{ $t('ext.xeonskyExtm.page.colKind') }}</span>
                    <span class="iv__c-status">{{ $t('ext.xeonskyExtm.page.colStatus') }}</span>
                    <span class="iv__c-enabled">{{ $t('ext.xeonskyExtm.page.colEnabled') }}</span>
                    <span class="iv__c4">{{ $t('sv.env.colActions') }}</span>
                </div>
                <div class="iv__tbody">
                    <div v-for="item in info?.entries ?? []" :key="item.id" class="iv__row">
                        <span class="iv__c-name">
                            <span class="extpage__name">{{ item.name }}</span>
                            <code class="extpage__id">{{ item.id }}<template v-if="item.version"> · {{ item.version }}</template></code>
                            <span v-if="item.message" class="extpage__msg" :title="item.message">{{ item.message }}</span>
                        </span>
                        <span class="iv__c-kind">
                            <a-tag>{{ $t('ext.xeonskyExtm.page.' + KIND_KEY[item.kind]) }}</a-tag>
                        </span>
                        <span class="iv__c-status">
                            <a-tag :color="statusColor(item.status)">{{ $t('ext.xeonskyExtm.page.' + STATUS_KEY[item.status]) }}</a-tag>
                        </span>
                        <span class="iv__c-enabled">
                            <!--
                                启用开关：仅可停用的扩展（内置 / 外部）有；系统扩展显示占位符，
                                保持列对齐。拨动后立即写标记并重载该扩展，无需重启。
                            -->
                            <a-switch
                                v-if="item.removable"
                                :checked="item.status !== 'disabled'"
                                size="small"
                                @change="(v: boolean) => toggle(item, v)"
                            />
                            <span v-else class="extpage__dash">—</span>
                        </span>
                        <span class="iv__c4">
                            <!-- 重载：内置 / 外部扩展可用（含失败的 —— 正好用来「改完再试一次」）；系统扩展不显示。 -->
                            <a-button v-if="item.kind !== 'system'" @click="reloadExt(item)">
                                {{ $t('ext.xeonskyExtm.page.reload') }}
                            </a-button>
                            <a-button
                                v-if="item.removable && item.status !== 'disabled' && item.status !== 'active'"
                                @click="forgive(item)"
                            >
                                {{ $t('ext.xeonskyExtm.page.forgive') }}
                            </a-button>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * 标题与操作同一行。标题左对齐、按钮组右对齐，整行用 align-items:center 对齐基线；
 * 按钮换用标准尺寸（不再 size="small"），所以这里不再压缩行高。
 */
.extpage__bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 2px 0 14px;
    flex: 0 0 auto;
}
.extpage__head {
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    flex: 0 0 auto;
}
/* 目录路径作为「打开扩展目录」按钮内的文字：过长时省略，完整值由 title 提供。 */
.extpage__dir {
    display: inline-block;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
    font-family: var(--el-font-family-mono);
    font-size: 12px;
}

/*
 * 扩展包区块：固定高度（不参与 flex:1 争抢），包列表超长时自己内部滚动，
 * 不影响下方「全部扩展」列表占满剩余高度的布局链。
 */
.extpage__bar--pkg {
    margin-top: 6px;
}
.extpage__pkg-alert {
    flex: 0 0 auto;
    margin-bottom: 10px;
}
.extpage__pkgs {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
}
.extpage__pkgs-list {
    max-height: 168px;
    overflow: auto;
}
.extpage__pkg-hint {
    flex: 0 0 auto;
    margin-top: 8px;
}

/*
 * 列表占满剩余高度：本页不用折叠卡片（内容就是一整张表），所以整页做成一条纵向 flex 链 ——
 * `.el-scrollbar__view` → `.cols` → `.panel` 都撑满，只有 `.iv__list` 滚动，
 * 页面本身不出现第二条滚动条。父级链的 flex 定义见 styles/settings.css。
 */
.panel {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
}
.extpage__list {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
}
.extpage__list .iv__list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
}

/* 列表是五列（名称 / 来源 / 状态 / 启用 / 操作），故单独定列宽。 */
.iv__c-name {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
}
.iv__c-kind {
    flex: 0 0 72px;
    display: flex;
    align-items: center;
}
.iv__c-status {
    flex: 0 0 88px;
    display: flex;
    align-items: center;
}
.iv__c-enabled {
    flex: 0 0 56px;
    display: flex;
    align-items: center;
}
.iv__c4 {
    flex: 0 0 200px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
}

/* 系统扩展没有开关，用占位符保持列对齐。 */
.extpage__dash {
    color: var(--el-text-color-placeholder);
}

.extpage__name {
    font-weight: 600;
    flex: 0 0 auto;
}
.extpage__id {
    font-family: var(--el-font-family-mono);
    font-size: 12px;
    color: var(--el-text-color-secondary);
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.extpage__msg {
    font-size: 12px;
    color: var(--el-color-danger);
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
