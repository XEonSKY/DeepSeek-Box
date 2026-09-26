<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { DeepSeekFilled, MessageFilled, ArrowRightOutlined, WalletFilled } from '@antdv-next/icons'
import { extApi, extShell } from '@ext/renderer-api'

/**
 * 内置扩展 `xeonsky.browser` 的**新建标签页页**（程序内置标签页视图）。
 *
 * ## 它为什么在扩展里
 *
 * 「新建标签页」的内容（跳转框 + 常用站点）是**浏览器功能**，随功能一起从内核迁出：
 * 原先它是内核的 `views/NewTab.vue`，且配置（默认搜索引擎、常用站点）存在内核设置结构里。
 * 现在外壳只提供「按名挂载扩展视图」的机制（`renderer/src/extensions/tabviews.ts`），
 * 页面本身与它的配置都在这里 —— 停用本扩展时这些设置一并消失，内核不留残键。
 *
 * ## 边界（只依赖 API 面）
 *
 * 本组件**不能** import 外壳内部（`@/shell/*`、`@/lib/*`）—— 与主进程侧「扩展不 import
 * 内核」是同一条原则。但「新建标签页」这件事天生要和外壳的标签页模型打交道
 * （切到固定站、发起跳转、离开时关掉自己），所以这几件事经 **API 面**的 IPC 端点完成：
 *
 *  - 三个固定站 = 外壳的 `home/chat/platform` 标签页 → `extShell.activateFixed`
 *  - 固定站文案 → 外壳文案键 `app.nav.*`（用 `$t` 取，属于公共文案）
 *  - 跳转 → `POST /shell/resolve-target`（判定在**本扩展主进程侧**）+ `extShell.openTab`
 *
 * ## 交互语义：跳转，不是搜索
 *
 * 输入框是「跳转」：不是网址就给个 `https://` 前缀去试，**不拼搜索引擎 URL**。
 * 判定在主进程侧（`main.ts` 的 `resolveTarget`），这里只显示结论、不做猜测。
 *
 * ## 数据流
 *
 * 进入页面拉一次本扩展配置（常用站点 + 默认搜索）；点「保存」在设置面板里，
 * 这里只读。常用站点为空时给一个直达设置页的入口。
 */

/** 本扩展的通道前缀（与 manifest.id 一致）。 */
const CHANNEL = 'ext:xeonsky.browser'

/** 调一次本扩展的主进程动作。 */
function call<T>(action: string, payload?: unknown): Promise<T> {
    return extApi.ext.invoke(`${CHANNEL}:${action}`, payload) as Promise<T>
}

interface ConfigState {
    config: { userAgent: string; searchEngine: string; shortcuts: Array<{ title: string; url: string }> }
    defaultUserAgent: string
    appVersion: string
}

const q = ref('')
const shortcuts = ref<Array<{ title: string; url: string }>>([])

/** 顶部固定三站（外壳的核心标签页）。文案走外壳的公共文案键。 */
const fixedSites = [
    { id: 'home', key: 'app.nav.ui', icon: DeepSeekFilled },
    { id: 'chat', key: 'app.nav.chat', icon: MessageFilled },
    { id: 'platform', key: 'app.nav.platform', icon: WalletFilled }
] as const

/** 搜索框聚焦：内容是动态插入的标签页视图，`autofocus` 不一定生效，这里再显式聚焦一次。 */
const inputRef = ref<{ focus?: () => void } | null>(null)

onMounted(async () => {
    void nextTick(() => inputRef.value?.focus?.())
    try {
        const s = await call<ConfigState>('config')
        shortcuts.value = Array.isArray(s.config.shortcuts) ? s.config.shortcuts : []
    } catch {
        /* 扩展尚未就绪：留空 */
    }
})

// ---- 与外壳标签页模型的交互（经 API 面）-------------------------------------

/** 切到某个固定站标签页（顺带关掉本导航页 —— 它是一次性的）。 */
function goFixed(id: string): void {
    extShell.activateFixed(id, true)
}

/** 打开设置页并定位到本扩展面板（常用站点在那里配置）。 */
function openSettings(): void {
    extShell.goSettings('browser')
}

/**
 * 打开一个已知 URL（常用站点点击 / 跳转结论）。
 * 开一个动态标签页并**关掉本导航页**。
 */
function openUrl(url: string, title?: string): void {
    extShell.openTab(url, title, true)
}

/**
 * 提交跳转：判定交给主进程（本扩展的 `resolveTarget`），这里只按结论行事。
 * `catch` 的兜底也**不猜搜索引擎** —— 只补 `https://`。
 */
async function submit(): Promise<void> {
    const raw = q.value.trim()
    if (!raw) return
    let r: { kind: 'url' | 'external' | 'none'; url?: string }
    try {
        r = await extApi.post('/shell/resolve-target', { body: { raw } })
    } catch {
        r = { kind: 'url', url: /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}` }
    }
    if (r.kind === 'none' || !r.url) return
    if (r.kind === 'external') {
        await extApi.post('/shell/open-external', { body: { url: r.url } })
        return
    }
    openUrl(r.url, r.url)
}
</script>

<template>
    <div class="nt">
        <!-- 内层负责居中：外层是滚动容器，直接给它 justify-content:center 会在内容超屏时裁掉顶部 -->
        <div class="nt__inner">
            <h1 class="nt__title">{{ $t('app.title') }}</h1>

            <form class="nt__search" @submit.prevent="submit">
                <!-- 回车只走表单的 submit：再挂 keyup.enter 会与原生隐式提交叠加，同一个目标开两个标签页 -->
                <el-input
                    ref="inputRef"
                    v-model="q"
                    class="nt__input pill-input"
                    :placeholder="$t('ext.xeonskyBrowser.newTab.placeholder')"
                    clearable
                    autofocus
                />
                <el-button native-type="submit" type="primary" class="nt__go">
                    <el-icon :size="16"><ArrowRightOutlined /></el-icon>
                    <span>{{ $t('ext.xeonskyBrowser.newTab.go') }}</span>
                </el-button>
            </form>

            <section class="nt__quick">
                <h2 class="nt__h">{{ $t('ext.xeonskyBrowser.newTab.quick') }}</h2>
                <div class="nt__grid">
                    <button
                        v-for="site in fixedSites"
                        :key="site.id"
                        class="nt__cell"
                        type="button"
                        @click="goFixed(site.id)"
                    >
                        <span class="nt__badge nt__badge--brand"><el-icon :size="18"><component :is="site.icon" /></el-icon></span>
                        <span class="nt__label">{{ $t(site.key) }}</span>
                    </button>

                    <a
                        v-for="(sc, i) in shortcuts"
                        :key="i"
                        class="nt__cell"
                        href="#"
                        @click.prevent="openUrl(sc.url, sc.title)"
                    >
                        <span class="nt__badge">{{ (sc.title || '☆').slice(0, 1) }}</span>
                        <span class="nt__label">{{ sc.title }}</span>
                    </a>
                </div>

                <p v-if="!shortcuts.length" class="nt__empty">
                    <span>{{ $t('ext.xeonskyBrowser.newTab.noShortcuts') }}</span>
                    <el-button text type="primary" size="small" @click="openSettings">
                        {{ $t('ext.xeonskyBrowser.newTab.addInSettings') }}
                    </el-button>
                </p>
            </section>
        </div>
    </div>
</template>

<style scoped>
.nt {
    height: 100%;
    overflow-y: auto;
    background: var(--el-bg-color-page);
}
/*
 * 居中交给内层，并且用 min-height:100% 而不是给外层 justify-content:center：
 * 后者在内容高于容器时会连顶部一起裁掉，且滚不上去（flex 居中的老问题）。
 */
.nt__inner {
    box-sizing: border-box;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 24px 48px;
}
.nt__title {
    margin: 4px 0 18px;
    font-size: 20px;
    font-weight: 700;
}
.nt__search {
    display: flex;
    gap: 8px;
    width: min(680px, 92%);
}
.nt__input {
    flex: 1 1 auto;
}
.nt__go {
    flex: 0 0 auto;
}
.nt__quick {
    margin-top: 34px;
    width: min(680px, 92%);
}
.nt__h {
    font-size: 14px;
    color: var(--el-text-color-secondary);
    margin: 0 0 12px;
    font-weight: 600;
}
.nt__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 10px;
}
.nt__cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px 8px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 12px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-primary);
    text-decoration: none;
    font-size: 13px;
    cursor: pointer;
    overflow: hidden;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.nt__cell:hover {
    border-color: var(--el-color-primary);
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
}
/* 键盘操作时给个可见焦点圈（鼠标点击不显示，避免多余的描边） */
.nt__cell:focus-visible {
    outline: 2px solid var(--el-color-primary);
    outline-offset: 2px;
}
.nt__badge {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background: var(--el-fill-color);
    font-size: 15px;
}
.nt__badge--brand {
    color: var(--el-color-primary);
}
.nt__cell:hover .nt__badge {
    background: var(--el-color-primary-light-8);
}
/* 名称过长时省略，不撑破格子 */
.nt__label {
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.nt__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: 12px;
    color: var(--el-text-color-placeholder);
    margin-top: 6px;
}
</style>
