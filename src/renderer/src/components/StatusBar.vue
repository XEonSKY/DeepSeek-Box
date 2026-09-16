<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { CheckCircleOutlined, DownloadOutlined, LoadingOutlined, WalletOutlined } from '@antdv-next/icons'
import type { CurrentBalanceInfo } from '@shared/types'
import { providerIcon } from '../lib/providerIcon'
import type { VersionLine } from '../lib/update'
import { checkAllUpdates, hasUpdate, refreshVersions, versionStatus } from '../lib/update'
import type { StatusIndicatorState } from '../lib/versionIndicator'
import { indicatorState } from '../lib/versionIndicator'
import { tt } from '../lib/locales'

/**
 * 底部状态栏（类似 VS Code）。
 *
 * 右对齐一组只读信息：
 *  - **当前供应商余额**：未授权显示「点击授权」，已授权点击刷新；仅前台每 5 分钟自动刷新；
 *  - **更新状态**：只说结论（已是最新 / 检测到新版本 / 正在安装 / 等待重启），
 *    不显示版本号 —— 号在浮层与「关于」页里看；点击就地弹出小浮层并检测更新，
 *    检测到新版本只在徽标上静默提示。
 *
 * 余额查询在主进程完成（`models:balance`），渲染层拿不到任何密钥。
 */
const router = useRouter()

/** 前台自动刷新间隔。 */
const AUTO_REFRESH_MS = 5 * 60 * 1000
/** 回到前台时补刷的最小间隔：避免反复切窗造成请求风暴。 */
const MIN_REFRESH_GAP_MS = 60 * 1000

const info = ref<CurrentBalanceInfo | null>(null)
/** 是否已授权读取（settings.modelsCredConsent）。 */
const consented = ref(false)
const loading = ref(false)

/** 读取代次：并发触发只让最后一次结果落地。 */
let seq = 0
let timer: ReturnType<typeof setInterval> | null = null
let lastFetchAt = 0
let offSettings: (() => void) | null = null

/** 版本浮层里是否有检查在进行。 */
const checking = computed(() => versionStatus.app.state === 'checking' || versionStatus.dsh.state === 'checking')
/** 有可用更新 → 状态栏徽标。 */
const badge = computed(() => hasUpdate())

/** 「前台」= 页面可见且有焦点；后台不计时也不请求。 */
function isForeground(): boolean {
    return document.visibilityState === 'visible' && document.hasFocus()
}

/** 取当前供应商余额；任何失败都当作「暂无内容」，不影响手动刷新重试。 */
async function load(): Promise<void> {
    if (!consented.value) return
    const cur = ++seq
    loading.value = true
    try {
        const res = await window.api.get('/models/balance')
        if (cur === seq) info.value = res && res.balance ? res : null
    } catch {
        if (cur === seq) info.value = null
    } finally {
        if (cur === seq) {
            loading.value = false
            lastFetchAt = Date.now()
        }
    }
}

/** 已授权且在前台时才启动定时器；重复调用安全。 */
function startTimer(): void {
    if (timer !== null || !consented.value || !isForeground()) return
    timer = setInterval(() => {
        // 计时期间切到后台就地停表，不再发请求（下次回前台再重启）。
        if (!consented.value || !isForeground()) {
            stopTimer()
            return
        }
        void load()
    }, AUTO_REFRESH_MS)
}

function stopTimer(): void {
    if (timer === null) return
    clearInterval(timer)
    timer = null
}

/** 前台状态变化：后台立即停表；回到前台按需补刷并重新计时。 */
function onForegroundChange(): void {
    if (!isForeground()) {
        stopTimer()
        return
    }
    if (consented.value && Date.now() - lastFetchAt > MIN_REFRESH_GAP_MS) void load()
    startTimer()
}

/** 授权状态翻转：授权后立即取一次；撤销后清空并停表。 */
function applyConsent(next: boolean): void {
    if (next === consented.value) return
    consented.value = next
    if (next) {
        lastFetchAt = 0
        void load()
        startTimer()
        return
    }
    seq++
    info.value = null
    loading.value = false
    stopTimer()
}

/** 点击余额项：未授权去授权页，已授权手动刷新。 */
function onBalanceClick(): void {
    if (!consented.value) {
        void router.push('/settings/models')
        return
    }
    void load()
}

/** 打开版本浮层即检测一次更新（并发时跳过）。 */
async function runCheck(): Promise<void> {
    if (checking.value) return
    await checkAllUpdates()
}

function openAbout(): void {
    void router.push('/settings/about')
}

/** 重启并安装已下载的程序更新（主进程负责重启）。 */
function restartAndInstall(): void {
    void window.api.post('/app/update/restart')
}

/**
 * 一行版本只在**三种有意义的结局**下出声，其余一律留白：
 *
 *  - `available` —— 有更新（用户需要知道并决定要不要装）；
 *  - `latest`    —— 已是最新版本（用户点开检查后要一个「查过了，没问题」的答复）；
 *  - `downloaded`—— 已下载，等待安装（用户需要知道「现在可以重启装上」）。
 *
 * `idle` / `checking` / `error` 返回空串：
 *  - idle 是初始态，说「尚未检查」只是噪音；
 *  - checking 由按钮上的 loading 表达，再写一遍「检测中」是重复；
 *  - error 的失败原因只放 title（见下方 template），行内不再堆一句同样是灰字的
 *    「检测失败」——它既没告诉用户原因，也把这一行撑得比别的长。
 */
function stateText(line: VersionLine): string {
    switch (line.state) {
        case 'available':
            return tt('sv.version.available')
        case 'latest':
            return tt('sv.version.upToDate')
        case 'downloaded':
            return tt('sv.version.downloaded')
        default:
            return ''
    }
}

/**
 * 该行是否要显示状态图标。图标与文案同步：只有那三个结局才出声，
 * 于是「一行里只有一个图标 + 一句话」，不会出现空图标占位。
 */
function stateIcon(line: VersionLine) {
    if (line.state === 'available' || line.state === 'downloaded') return DownloadOutlined
    if (line.state === 'latest') return CheckCircleOutlined
    return null
}

/** 浮层里的两行（程序 / dsh），用 v-for 渲染以消掉两份几乎相同的模板。 */
const versionLines = computed(() => [
    { name: tt('sv.version.app'), data: versionStatus.app },
    { name: tt('sv.version.dsh'), data: versionStatus.dsh }
])

/** 状态文案的强调程度：等待安装要显眼（可操作），已是最新最弱（纯告知）。 */
function stateClass(line: VersionLine): string {
    if (line.state === 'available' || line.state === 'downloaded') return 'is-available'
    if (line.state === 'latest') return 'is-latest'
    return ''
}

onMounted(async () => {
    try {
        consented.value = (await window.api.get('/settings')).modelsCredConsent === true
    } catch {
        consented.value = false
    }
    if (consented.value) {
        void load()
        startTimer()
    }
    void refreshVersions()
    offSettings = window.api.on('settings:changed', (s) => applyConsent(s.modelsCredConsent === true))
})

// useEventListener 绑定当前组件作用域：组件卸载时自动解绑，不再需要成对的手写 remove。
useEventListener(document, 'visibilitychange', onForegroundChange)
useEventListener(window, 'focus', onForegroundChange)
useEventListener(window, 'blur', onForegroundChange)

onBeforeUnmount(() => {
    offSettings?.()
    offSettings = null
    stopTimer()
})

/** 余额文案：金额，或查不了的原因。 */
const balanceText = computed(() => {
    const b = info.value?.balance
    if (!b) return ''
    if (b.state === 'ok') return [b.currency, b.total].filter(Boolean).join(' ') || tt('sv.models.balanceUnknown')
    if (b.state === 'unsupported') return tt('sv.models.balanceUnsupported')
    if (b.state === 'no-key') return tt('sv.models.balanceNoKey')
    return tt('sv.models.balanceError', { msg: b.message ?? '-' })
})

/** 悬停补充供应商与赠送 / 充值明细。 */
const balanceTitle = computed(() => {
    const i = info.value
    if (!i) return tt('sv.models.clickRefresh')
    const parts = [i.providerName]
    const b = i.balance
    if (b.state === 'ok') {
        if (b.granted) parts.push(tt('sv.models.balanceGranted', { amount: b.granted }))
        if (b.toppedUp) parts.push(tt('sv.models.balanceToppedUp', { amount: b.toppedUp }))
        parts.push(tt('sv.models.clickRefresh'))
    } else {
        parts.push(balanceText.value)
    }
    return parts.join(' · ')
})

/**
 * 状态栏版本项的那一句话：只给结论，不给版本号。
 *
 * 版本号（程序 / dsh）在浮层和「关于」页里都能看到，状态栏这一格要保持短，
 * 而且不能随版本号长度抖动。还没查过（idle）时留白。
 */
const versionIndicator = computed(() => indicatorState(versionStatus.app, versionStatus.dsh))

/** 结论 → 文案 key。四种结局 + 两个瞬态；无结论时留空（模板用占位文案）。 */
const INDICATOR_KEYS: Record<StatusIndicatorState, string> = {
    latest: 'sv.version.latest',
    available: 'sv.version.available',
    installing: 'sv.version.installing',
    downloaded: 'sv.version.downloaded',
    checking: 'sv.version.checking',
    error: 'sv.version.error'
}
const versionLabel = computed(() => {
    const s = versionIndicator.value
    return s ? tt(INDICATOR_KEYS[s]) : ''
})

/** 版本项悬停：有更新时说明有新版本，否则提示点击检查。 */
const versionTitle = computed(() => (badge.value ? tt('sv.version.badge') : tt('sv.version.check')))

/**
 * 当前供应商的品牌图标；认不出时回落通用的钱包图标。
 * 认不出就用通用图标 —— 拿别的牌子顶替会误导用户以为在用那家服务。
 */
const BalanceIcon = computed(() => providerIcon(info.value?.provider, info.value?.providerName) ?? WalletOutlined)
</script>

<template>
    <footer class="statusbar">
        <div class="statusbar__right">
            <!-- 未授权：点击去「设置 → 模型」完成授权 -->
            <button
                v-if="!consented"
                type="button"
                class="statusbar__item statusbar__link"
                :title="$t('sv.models.notAuthorizedHint')"
                @click="onBalanceClick"
            >
                <el-icon :size="13"><WalletOutlined /></el-icon>
                <span>{{ $t('sv.models.notAuthorized') }}</span>
            </button>

            <!-- 已授权：显示当前供应商余额，点击手动刷新 -->
            <button
                v-else
                type="button"
                class="statusbar__item statusbar__balance"
                :class="info ? 'is-' + info.balance.state : ''"
                :title="balanceTitle"
                @click="onBalanceClick"
            >
                <el-icon :size="13" :class="{ 'is-spin': loading }"><component :is="BalanceIcon" /></el-icon>
                <span v-if="info" class="statusbar__amount">{{ balanceText }}</span>
                <span v-else class="statusbar__amount">{{ loading ? '…' : $t('sv.models.balanceUnknown') }}</span>
            </button>

            <!-- 更新状态指示：点击就地检测更新；有新版本时显示徽标（静默） -->
            <el-popover placement="top-end" :width="320" trigger="click" @show="runCheck">
                <template #reference>
                    <button
                        type="button"
                        class="statusbar__item statusbar__version"
                        :class="versionIndicator ? 'is-' + versionIndicator : ''"
                        :title="versionTitle"
                    >
                        <span v-if="versionLabel">{{ versionLabel }}</span>
                        <span v-else class="statusbar__placeholder">{{ $t('sv.version.check') }}</span>
                        <span v-if="badge" class="statusbar__dot" aria-hidden="true" />
                        <el-icon v-if="versionIndicator === 'checking'" :size="12" class="is-spin">
                            <LoadingOutlined />
                        </el-icon>
                    </button>
                </template>

                <div class="uv">
                    <div v-for="line in versionLines" :key="line.name" class="uv__row">
                        <span class="uv__name">{{ line.name }}</span>
                        <code class="uv__ver">{{ line.data.current ?? '—' }}</code>
                        <!-- 只在三种有意义的结局下出声；error 的原因放 title，行内不重复 -->
                        <span
                            v-if="stateText(line.data)"
                            class="uv__state"
                            :class="stateClass(line.data)"
                            :title="line.data.message ?? ''"
                        >
                            <el-icon v-if="stateIcon(line.data)" :size="12"><component :is="stateIcon(line.data)!" /></el-icon>
                            {{ stateText(line.data) }}
                        </span>
                        <!-- 检查中：这里给一个占位，否则行内会因为文案为空而跳一下 -->
                        <span v-else-if="line.data.state === 'checking'" class="uv__state is-checking">
                            <el-icon :size="12" class="is-spin"><LoadingOutlined /></el-icon>
                            {{ $t('sv.version.checking') }}
                        </span>
                    </div>
                    <div class="uv__actions">
                        <el-button size="small" :loading="checking" @click="runCheck">{{ $t('sv.version.check') }}</el-button>
                        <el-button
                            v-if="versionStatus.app.state === 'downloaded'"
                            size="small"
                            type="primary"
                            @click="restartAndInstall()"
                        >
                            {{ $t('sv.version.restart') }}
                        </el-button>
                        <el-button size="small" text @click="openAbout">{{ $t('sv.version.about') }}</el-button>
                    </div>
                </div>
            </el-popover>
        </div>
    </footer>
</template>

<style scoped>
.statusbar {
    flex: 0 0 auto;
    height: var(--statusbar-h, 24px);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    border-top: 1px solid var(--el-border-color-light);
    background: var(--el-bg-color);
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1;
    user-select: none;
}
/* 右侧信息组：整体靠右，内部保持固定间距 */
.statusbar__right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}
/* 状态栏项：整体可点击 */
.statusbar__item {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 2px 6px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
}
.statusbar__item:hover,
.statusbar__item:focus-visible {
    background: var(--el-fill-color);
    color: var(--el-text-color-primary);
}
.statusbar__link {
    color: var(--el-text-color-secondary);
}
.statusbar__amount {
    color: var(--el-text-color-primary);
}
/* 版本项：位置相对，便于放右上角徽标 */
.statusbar__version {
    position: relative;
}
/* 无结论时给一句「检查更新」占位：空按钮没有可点性暗示 */
.statusbar__placeholder {
    color: var(--el-text-color-placeholder);
}
/* 结论的强调程度：等待重启 / 有更新可操作，已是最新纯告知，失败警示 */
.statusbar__version.is-available,
.statusbar__version.is-downloaded,
.statusbar__version.is-installing {
    color: var(--el-color-primary);
}
.statusbar__version.is-error {
    color: var(--el-color-warning);
}
/* 更新徽标：VS Code 式小红点（静默提示，不弹通知） */
.statusbar__dot {
    position: absolute;
    top: 0;
    right: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--el-color-danger);
    box-shadow: 0 0 0 2px var(--el-bg-color);
}
/* 刷新中：钱包图标转动，给出「正在查询」的反馈 */
.statusbar__item .is-spin {
    animation: statusbar-spin 0.9s linear infinite;
}
@keyframes statusbar-spin {
    to {
    transform: rotate(360deg);
    }
}
/* 查不了用次要色，失败用警示色 */
.statusbar__balance.is-unsupported .statusbar__amount,
.statusbar__balance.is-no-key .statusbar__amount {
    color: var(--el-text-color-secondary);
}
.statusbar__balance.is-error .statusbar__amount {
    color: var(--el-color-warning);
}
/* ---- 版本浮层 ---- */
.uv {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.uv__state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
/* 有更新 / 等待安装：可操作，用主色强调 */
.uv__state.is-available {
    color: var(--el-color-primary);
}
/* 已是最新：纯告知，弱化 */
.uv__state.is-latest {
    color: var(--el-color-success);
}
.uv__state.is-checking {
    color: var(--el-text-color-secondary);
}
.uv__row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.uv__name {
    flex: 0 0 44px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
}
.uv__ver {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--el-font-family-mono);
    font-size: 12px;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.uv__state {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);
}
.uv__state.is-available,
.uv__state.is-downloaded {
    color: var(--el-color-primary);
}
.uv__state.is-error {
    color: var(--el-color-warning);
}
.uv__actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 2px;
}
</style>
