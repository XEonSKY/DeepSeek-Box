<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { DeepSeekFilled, MessageFilled, SearchOutlined, WalletFilled } from '@antdv-next/icons'
import { useAppIcon } from '../lib/appIcon'
import { useGoView } from '../shell/viewnav'
import { webTabs, activateTab, closeTab, activeTab, findTab, launchFromNewTab } from '../shell/tabs'
import { SEARCH_ENGINE_IDS, ENGINE_LABEL_KEY, buildSearchUrl } from '../lib/engines'
import type { SearchEngineId, Shortcut } from '@shared/types'

const q = ref('')
const engine = ref<SearchEngineId>('bing')
const shortcuts = ref<Shortcut[]>([])
// 应用 Logo：随深浅色切换（深色用 icon-dark.png），见 appIcon.ts
const appIcon = useAppIcon()
const go = useGoView()

/**
 * 搜索框聚焦。`autofocus` 只是「挂载时聚焦」的声明，而导航页内容是**动态插入**的标签页视图；
 * 这里再显式聚焦一次（`focus` 走可选调用，拿不到组件实例就静默跳过），保证新开标签页能直接打字。
 */
const inputRef = ref<{ focus?: () => void } | null>(null)

/** 顶部固定三站（直达已有固定标签页）。图标与标题栏保持一致用实心，见 AGENT.md §6。 */
const fixedSites = [
    { id: 'home', key: 'app.nav.ui', icon: DeepSeekFilled },
    { id: 'chat', key: 'app.nav.chat', icon: MessageFilled },
    { id: 'platform', key: 'app.nav.platform', icon: WalletFilled }
] as const

onMounted(async () => {
    void nextTick(() => inputRef.value?.focus?.())
    try {
        const s = await window.api.get('/settings')
        engine.value = s.searchEngine || 'bing'
        shortcuts.value = Array.isArray(s.shortcuts) ? s.shortcuts : []
    } catch {
    /* defaults */
    }
})

/** 离开当前导航页（导航页是一次性的）。 */
function leave(act: () => void): void {
    const curId = webTabs.activeId
    const curKind = activeTab()?.kind
    act()
    if (curKind === 'newtab' && curId) {
        const cur = findTab(curId)
        if (cur) closeTab(curId)
    }
}

/** 点固定三站：切到对应固定标签页并关闭本导航页。 */
function goFixed(id: string): void {
    leave(() => activateTab(id))
}

/**
 * 打开一个 URL（新建动态标签页）。
 * `launchFromNewTab` 自己就会开新标签**并关掉发起它的导航页**，所以直接调用即可 ——
 * 原先前置的 `activeTab()?.kind === 'newtab'` 分支与 `leave()` 包装都是等价路径（死分支）。
 */
function openUrl(url: string, title?: string): void {
    launchFromNewTab(url, title)
}

/** 提交搜索/网址。 */
async function submit(): Promise<void> {
    const s = q.value.trim()
    if (!s) return
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s)
    if (scheme) {
        const proto = scheme[1].toLowerCase()
        if (proto === 'http' || proto === 'https') openUrl(s)
        else await window.api.post('/shell/open-external', { body: { url: s } }) // 扩展/非内置协议交给系统
        return
    }
    if (/^[\w.-]+\.[a-zA-Z]{2,}$/.test(s)) {
        openUrl('https://' + s, s)
        return
    }
    openUrl(buildSearchUrl(engine.value, s), s)
}

/** 空状态里的「去设置添加」：切到设置页（分类在常规页）。 */
function openSettings(): void {
    go('settings')
}
</script>

<template>
    <div class="nt">
        <!-- 内层负责居中：外层是滚动容器，直接给它 justify-content:center 会在内容超屏时裁掉顶部 -->
        <div class="nt__inner">
            <img :src="appIcon" class="nt__logo" alt="" draggable="false" />
            <h1 class="nt__title">{{ $t('app.title') }}</h1>

            <form class="nt__search" @submit.prevent="submit">
                <el-select v-model="engine" class="nt__engine" :placeholder="$t('navPage.engineLabel')">
                    <el-option v-for="id in SEARCH_ENGINE_IDS" :key="id" :value="id" :label="$t(ENGINE_LABEL_KEY[id])" />
                </el-select>
                <!-- 回车只走表单的 submit：再挂 keyup.enter 会与原生隐式提交叠加，同一个查询开两个标签页 -->
                <el-input
                    ref="inputRef"
                    v-model="q"
                    class="nt__input pill-input"
                    :placeholder="$t('navPage.placeholder')"
                    clearable
                    autofocus
                />
                <el-button native-type="submit" type="primary" class="nt__go">
                    <el-icon :size="16"><SearchOutlined /></el-icon>
                    <span>{{ $t('navPage.search') }}</span>
                </el-button>
            </form>

            <section class="nt__quick">
                <h2 class="nt__h">{{ $t('navPage.quick') }}</h2>
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
                    <span>{{ $t('navPage.noShortcuts') }}</span>
                    <el-button text type="primary" size="small" @click="openSettings">
                        {{ $t('navPage.addInSettings') }}
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
.nt__logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  -webkit-user-drag: none;
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
.nt__engine {
  flex: 0 1 132px;
  min-width: 112px;
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
/* 固定三站与常用站点统一成同一枚徽标，两种格子的首行才对得齐 */
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
