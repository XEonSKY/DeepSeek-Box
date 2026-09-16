<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ReloadOutlined, RobotFilled, SafetyCertificateFilled } from '@antdv-next/icons'
import type { ModelBalanceInfo, ModelsInfo } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { tt } from '../../lib/locales'
import { useSettingsStore } from './useSettingsStore'

/**
 * 「模型」页：只读展示**令牌列表** —— **每个令牌一行**，带所属供应商名称与余额。
 *
 * 规则与隐私：
 *  - 同一密钥的多个路由由主进程合并成一个供应商，只展示一次（见 main/app/models.ts）；
 *  - 一行里没有模型名：列表按令牌展开，不按模型展开；
 *  - 页面**不展示任何密钥**，密钥只在主进程内用于向供应商接口查询余额；
 *  - 读取发生在用户同意之后：首次进入征求一次，结果持久化在 `settings.modelsCredConsent`。
 */
const { state } = useSettingsStore()

/** 主进程返回的模型列表；未同意或读取失败时为 null。 */
const info = ref<ModelsInfo | null>(null)
const loading = ref(false)
/** 本次读取的失败说明（展示在主进程错误码之外：IPC 本身失败 / 超时等）。 */
const loadError = ref('')
/** 本次访问点了「暂不」：收起同意卡片，直到用户主动重新授权。 */
const dismissed = ref(false)
/** 读取代次：并发触发时只让最后一次的结果落地，避免旧响应覆盖新结果。 */
let loadSeq = 0

onMounted(() => {
    if (state.modelsCredConsent) void load()
})

/** 读取模型列表（仅在已同意后调用；内含对供应商接口的联网查询）。 */
async function load(): Promise<void> {
    const seq = ++loadSeq
    loading.value = true
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
        if (seq === loadSeq) loading.value = false
    }
}

/** 同意读取：置位持久化开关并立刻读取。 */
function grant(): void {
    dismissed.value = false
    state.modelsCredConsent = true
    void load()
}

/** 主进程错误码 → 一句说明（未知码不展示，避免泄漏内部细节）。 */
const errorText = computed(() => {
    if (!info.value) return ''
    switch (info.value.errorCode) {
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
const isEmpty = computed(() => !!info.value && !info.value.errorCode && info.value.entries.length === 0)

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
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><el-icon :size="34"><RobotFilled /></el-icon></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.models') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.models') }}</div>
            </div>
        </div>

        <!-- 未授权：首次进入征求同意 -->
        <template v-if="!state.modelsCredConsent">
            <div v-if="!dismissed" class="mp__consent">
                <div class="mp__consent-t"><el-icon><SafetyCertificateFilled /></el-icon> {{ $t('sv.models.consentTitle') }}</div>
                <p class="mp__consent-d">{{ $t('sv.models.consentDesc') }}</p>
                <div class="mp__path"><code>{{ $t('sv.models.consentPathValue') }}</code></div>
                <div class="mp__actions">
                    <el-button type="primary" @click="grant">{{ $t('sv.models.consentAgree') }}</el-button>
                    <el-button @click="dismissed = true">{{ $t('sv.models.consentDeny') }}</el-button>
                </div>
                <div class="hint">{{ $t('sv.models.consentNote') }}</div>
            </div>
            <div v-else class="mp__empty">
                <el-icon :size="30"><SafetyCertificateFilled /></el-icon>
                <div class="mp__empty-t">{{ $t('sv.models.deniedTitle') }}</div>
                <div class="hint">{{ $t('sv.models.deniedHint') }}</div>
                <el-button @click="grant">{{ $t('sv.models.consentAgree') }}</el-button>
            </div>
        </template>

        <!-- 已授权：令牌列表（供应商 / 余额） -->
        <div v-else v-loading="loading" class="mp__body">
            <div class="mp__toolbar">
                <span class="mp__count">{{ $t('sv.models.modelCount', { n: info?.entries.length ?? 0 }) }}</span>
                <el-button size="small" :icon="ReloadOutlined" :loading="loading" @click="load">
                    {{ $t('sv.models.refreshAll') }}
                </el-button>
            </div>
            <el-alert v-if="loadError" type="error" :closable="false" show-icon :title="$t('sv.models.loadFail', { err: loadError })" />
            <el-alert v-else-if="errorText" type="info" :closable="false" show-icon :title="errorText" />
            <div v-else-if="isEmpty" class="hint">{{ $t('sv.models.empty') }}</div>
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
        </div>
    </div>
</template>

<style scoped>
/* 只留本组件专用规则；跨组件通用样式一律进 styles/*.css（见 AGENT.md §3 样式约定）。 */
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
.mp__consent-t .el-icon {
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
