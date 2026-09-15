<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined, LoadingOutlined } from '@antdv-next/icons'
import { webTabs, activeTab, openTarget, setHomeUrl } from '../shell/tabs'
import NewTab from './NewTab.vue'
import { buildSearchUrl } from '../lib/engines'
import type { SearchEngineId } from '@shared/types'
import { shellMeta } from '../shell/shellmeta'
import { useWebviews } from './useWebviews'
import type { WebviewEl } from './useWebviews'
import { useLoadProgress } from './useLoadProgress'

/**
 * 「/」路由宿主：标签页模式的 web 内容区。
 * - 每个标签页一个 pane；激活页可见，其余隐藏但保留在 DOM——已访问 webview 保活。
 * - webview 的创建/保活/裁剪规则见 `useWebviews`（本组件只负责显示与地址栏）。
 * - home（dsh UI）订阅主进程 dsh URL 广播 + 轮询兜底。
 * - 任一 webview 的 target=_blank / window.open (ui:new-tab) → openTab 动态新标签页。
 * - 顶部是浏览器式导航栏（后退/前进/刷新 + 地址栏），驱动当前激活 webview。
 * - 标题栏刷新(ui:reload-dsh) → 重载当前激活 webview。
 */
let defaultEngine: SearchEngineId = 'bing'
let pollTimer: number | null = null
/** 轮询上限用尽仍未拿到 dsh URL：必须给出可见的失败态，不能留一个永远转圈的占位。 */
const waitTimedOut = ref(false)

let offUrl: (() => void) | null = null
let offNewTab: (() => void) | null = null
let offReload: (() => void) | null = null
let offSettings: (() => void) | null = null

// 当前激活 webview 的导航状态（显示在地址栏）。
const nav = reactive({ url: '', canBack: false, canForward: false, loading: false })
/** 地址栏可编辑文本。 */
const urlInput = ref('')
const addrEditing = ref(false)

/** 顶部加载进度条（真实百分比不可得，走模拟进度，见 useLoadProgress）。 */
const {
    active: loadBarActive,
    percent: loadBarPercent,
    start: startLoadBar,
    done: finishLoadBar
} = useLoadProgress()

/** 统一收口「加载中」状态：既更新地址栏的转圈/停止图标，也驱动顶部进度条。 */
function applyLoading(loading: boolean): void {
    nav.loading = loading
    if (loading) startLoadBar()
    else finishLoadBar()
}

/** 用某 webview 刷新导航栏状态（仅当其仍是激活标签页时）。 */
function syncNavFrom(wv: WebviewEl | null): void {
    if (!wv || wv !== wvApi.activeWv()) return
    try {
        const url = typeof wv.getURL === 'function' ? (wv.getURL() as string) : ''
        nav.url = url || ''
        nav.canBack = typeof wv.canGoBack === 'function' ? !!wv.canGoBack() : false
        nav.canForward = typeof wv.canGoForward === 'function' ? !!wv.canGoForward() : false
        if (!addrEditing.value) urlInput.value = nav.url
        // 加载态以 webview 实况为准：切换标签页时 did-start-loading 可能在它非激活时就已错过，
        // 靠 isLoading() 校正，否则地址栏会一直转圈、顶部进度条也会卡住。放在赋值之后，
        // 这样即便 webview 尚未 dom-ready、isLoading() 抛错，也不会连累地址栏同步。
        applyLoading(typeof wv.isLoading === 'function' ? !!wv.isLoading() : false)
    } catch {
    /* ignore */
    }
}

const wvApi = useWebviews({
    onNavChange: (wv) => syncNavFrom(wv),
    onLoadingChange: (loading) => applyLoading(loading)
})
const { setHolder } = wvApi

/** 网址导航栏仅在动态标签页激活时显示；三个固定站不显示。 */
const showNav = computed(() => activeTab()?.kind === 'dynamic')

// ---- 导航栏动作 ----
function navBack(): void {
    const wv = wvApi.activeWv()
    if (wv && typeof wv.goBack === 'function') wv.goBack()
}
function navForward(): void {
    const wv = wvApi.activeWv()
    if (wv && typeof wv.goForward === 'function') wv.goForward()
}
function navReload(): void {
    const wv = wvApi.activeWv()
    if (!wv) return
    if (nav.loading && typeof wv.stop === 'function') wv.stop()
    else if (typeof wv.reload === 'function') wv.reload()
}
/** 处理地址栏输入：URL / 扩展协议 / 搜索。 */
async function onAddressEnter(): Promise<void> {
    const wv = wvApi.activeWv()
    if (!wv) return
    const raw = urlInput.value.trim()
    if (!raw) {
        urlInput.value = nav.url
        return
    }
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw)
    if (scheme) {
        const proto = scheme[1].toLowerCase()
        // http/https/about 由 webview 内置加载；其它协议（mailto:/tel:/自定义等）交系统打开。
        if (proto === 'http' || proto === 'https' || proto === 'about') {
            urlInput.value = raw
            if (typeof wv.loadURL === 'function') await wv.loadURL(raw).catch(() => {})
        } else {
            urlInput.value = nav.url
            await window.api.post('/shell/open-external', { body: { url: raw } })
        }
        return
    }
    let url: string
    if (/^[\w.-]+\.[a-zA-Z]{2,}$/.test(raw)) {
        url = 'https://' + raw
    } else {
        url = buildSearchUrl(defaultEngine, raw) // 非网址 → 默认引擎搜索
    }
    urlInput.value = url
    try {
        if (typeof wv.loadURL === 'function') await wv.loadURL(url)
    } catch {
    /* did-fail-load will surface */
    }
}

function stopPolling(): void {
    if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
    }
}

function startPolling(): void {
    if (pollTimer !== null) return
    waitTimedOut.value = false
    let tries = 0
    pollTimer = window.setInterval(async () => {
        if (activeTab()?.url) {
            stopPolling()
            return
        }
        if (++tries > 120) {
            // 约 2 分钟仍无 URL：停表并显示失败态（含重试入口），而不是静默留住转圈图标
            stopPolling()
            waitTimedOut.value = true
            return
        }
        try {
            const u = await window.api.get('/dsh/url')
            if (u) {
                setHomeUrl(u)
                stopPolling()
            }
        } catch {
            /* keep polling */
        }
    }, 1000)
}

// 标签页增减 / 激活切换 / LRU 次序(used) / home URL 变化 → 重建激活 webview + 保活裁剪。
watch(
    () =>
        (webTabs.activeId ?? '') +
    '|' +
    webTabs.list.map((t) => `${t.id}:${t.kind}:${t.used}:${t.keep ? 1 : 0}:${t.url ?? ''}`).join('~'),
    () => {
        wvApi.ensureActive() // 激活标签页若无 webview 则新建（激活的动态必属于最近保活集）
        wvApi.prune() // 裁剪：只保留固定三站 + 最近 3 个动态标签页的 webview
        wvApi.syncHomeUrl()
        syncNavFrom(wvApi.activeWv())
    },
    { flush: 'post' }
)

onMounted(async () => {
    try {
        const s = await window.api.get('/settings')
        wvApi.setZoom(s.zoomPercent ?? 100)
        defaultEngine = s.searchEngine || 'bing'
    } catch {
        wvApi.setZoom(100)
    }

    // dsh:url 只定向发给“核心窗口”，但这里始终订阅：若本窗口稍后被提升为新的核心窗口，
    // 主进程会在提升后补发 dsh:url，让 dsh UI 固定站能及时拿到地址。
    offUrl = window.api.on('dsh:url', (u) => {
        waitTimedOut.value = false // 地址已就绪，清掉可能残留的超时失败态
        setHomeUrl(u)
    })
    offNewTab = window.api.on('ui:new-tab', (url) => { openTarget(url) })
    offReload = window.api.on('ui:reload-dsh', () => wvApi.reloadActive())
    offSettings = window.api.on('settings:changed', (s) => {
        wvApi.setZoom(s.zoomPercent ?? 100)
        if (s.searchEngine) defaultEngine = s.searchEngine
    })

    // 初始拉取 dsh URL 只对核心窗口做（dsh UI 固定站只在核心窗口）；副窗口由主进程以
    // ui:new-tab 定向给一个动态标签页，不需 home。
    wvApi.ensureActive()
    syncNavFrom(wvApi.activeWv())
    if (shellMeta.isCore) {
        const u = await window.api.get('/dsh/url')
        if (u) setHomeUrl(u)
        else startPolling()
    }
})

onBeforeUnmount(() => {
    stopPolling()
    offUrl?.()
    offNewTab?.()
    offReload?.()
    offSettings?.()
    wvApi.destroyAll()
})
</script>

<template>
    <div class="whost">
        <!-- 浏览器式导航栏：仅在动态标签页激活时显示（三个固定站用标题栏旧版刷新按钮） -->
        <div v-if="showNav" class="wb-nav">
            <button class="wn" type="button" :disabled="!nav.canBack" title="←" @click="navBack">
                <el-icon :size="16"><ArrowLeftOutlined /></el-icon>
            </button>
            <button class="wn" type="button" :disabled="!nav.canForward" title="→" @click="navForward">
                <el-icon :size="16"><ArrowRightOutlined /></el-icon>
            </button>
            <button class="wn" type="button" title="reload / stop" @click="navReload">
                <el-icon :size="15" :class="{ spin: nav.loading }"><ReloadOutlined /></el-icon>
            </button>
            <div class="wn-addr pill-input">
                <el-input
                    v-model="urlInput"
                    :placeholder="$t('app.tabs.promptPlaceholder')"
                    clearable
                    @focus="addrEditing = true"
                    @blur="addrEditing = false"
                    @keyup.enter="onAddressEnter"
                />
            </div>
        </div>

        <div class="wb-stage">
            <!-- 顶部加载进度条：真实百分比不可得，由 useLoadProgress 模拟；覆盖在 webview 之上 -->
            <div class="whost__progress" :class="{ on: loadBarActive }" aria-hidden="true">
                <div class="whost__progress-bar" :style="{ width: loadBarPercent + '%' }"></div>
            </div>
            <div
                v-for="tab in webTabs.list"
                :key="tab.id"
                class="whost__pane"
                :class="{ on: tab.id === webTabs.activeId }"
            >
                <NewTab v-if="tab.kind === 'newtab'" />
                <template v-else>
                    <div class="whost__holder" :ref="(el) => setHolder(tab.id, el as HTMLDivElement | null)"></div>
                    <div v-if="!tab.url" class="whost__wait">
                        <!-- 等待超时：给出原因与重试，不再无限转圈 -->
                        <div v-if="waitTimedOut" class="whost__timeout">
                            <div class="whost__timeout-txt">{{ $t('whost.timeout') }}</div>
                            <el-button size="small" :icon="ReloadOutlined" @click="startPolling">{{ $t('whost.retry') }}</el-button>
                        </div>
                        <el-icon v-else class="spin" :size="36"><LoadingOutlined /></el-icon>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<style scoped>
.whost {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
/* 导航栏 */
.wb-nav {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-blank);
}
.wn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.wn:hover:not(:disabled) {
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}
.wn:disabled {
  color: var(--el-text-color-placeholder);
  cursor: default;
}
.wn-addr {
  flex: 1 1 auto;
  min-width: 0;
}
/* 内容舞台 */
.wb-stage {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}
/* 顶部加载进度条：贴内容区上沿的一条细线，加载时淡入、结束后补满淡出 */
.whost__progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 6;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.25s ease;
}
.whost__progress.on {
  opacity: 1;
}
.whost__progress-bar {
  height: 100%;
  width: 0;
  background: var(--el-color-primary);
  transition: width 0.18s ease-out;
}
.whost__pane {
  position: absolute;
  inset: 0;
  /* 隐藏非激活页，避免各标签页内容叠穿；用 visibility 而非 display:none，
     使 webview 保持存活。切回时不再重载的关键是不去重设其 src（见 useWebviews）。 */
  visibility: hidden;
}
.whost__pane.on {
  visibility: visible;
}
.whost__holder {
  position: absolute;
  inset: 0;
  display: flex;
}
.whost__wait {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  pointer-events: none;
}
/* 等待超时的失败态：必须重新开启 pointer-events，否则里面的「重试」按钮点不动 */
.whost__timeout {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 420px;
  padding: 16px 20px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--el-box-shadow-light);
}
.whost__timeout-txt {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  text-align: center;
}
.spin {
  animation: rot 1s linear infinite;
}
@keyframes rot {
  to {
    transform: rotate(360deg);
  }
}
</style>
