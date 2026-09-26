<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { DeepSeekFilled, MessageFilled, ArrowRightOutlined, WalletFilled } from '@antdv-next/icons'
import { useAppIcon } from '../lib/appIcon'
import { useGoView } from '../shell/viewnav'
import { webTabs, activateTab, closeTab, activeTab, findTab, launchFromNewTab } from '../shell/tabs'

/**
 * 「新建标签页」的**兜底页** —— 只在没有扩展贡献该视图时渲染。
 *
 * 完整的导航页（常用站点、跳转框）由内置扩展 `xeonsky.browser` 提供
 * （见 `extensions/tabviews.ts` 与 `src/extensions/xeonsky.browser/NewTab.vue`）。
 * 但「点＋新建标签页」是外壳自己的动作，扩展被停用时**不能出现空白页** ——
 * 所以留这一份极简实现：Logo + 一个跳转框 + 三个固定站入口。
 *
 * 它刻意**不含**搜索引擎选择、常用站点管理这些东西 —— 那些属于浏览器的知识，
 * 随功能一起在扩展里；外壳这份只保证「没有扩展也能用」。
 */

const q = ref('')
// 应用 Logo：随深浅色切换（深色用 icon-dark.png），见 appIcon.ts
const appIcon = useAppIcon()
const go = useGoView()

/** 搜索框聚焦。导航页内容是动态插入的标签页视图，`autofocus` 不一定生效，这里再显式聚焦一次。 */
const inputRef = ref<{ focus?: () => void } | null>(null)

/** 顶部固定三站（直达已有固定标签页）。图标与标题栏保持一致用实心。 */
const fixedSites = [
    { id: 'home', key: 'app.nav.ui', icon: DeepSeekFilled },
    { id: 'chat', key: 'app.nav.chat', icon: MessageFilled },
    { id: 'platform', key: 'app.nav.platform', icon: WalletFilled }
] as const

onMounted(() => {
    void nextTick(() => inputRef.value?.focus?.())
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
 * 提交跳转。
 *
 * 只做「跳转」：解析交给主进程（规则在浏览器扩展里，扩展不可用时返回 external）。
 * 不猜搜索引擎 —— 外壳不认识「搜索引擎」这个概念。
 */
async function submit(): Promise<void> {
    const raw = q.value.trim()
    if (!raw) return
    let r: { kind: 'url' | 'external' | 'none'; url?: string }
    try {
        r = await window.api.post('/shell/resolve-target', { body: { raw } })
    } catch {
        // 本地 IPC 理论上不会失败；兜底只做「补 https://」，不复制扩展的知识
        r = { kind: 'url', url: /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}` }
    }
    if (r.kind === 'none' || !r.url) return
    if (r.kind === 'external') {
        await window.api.post('/shell/open-external', { body: { url: r.url } })
        return
    }
    launchFromNewTab(r.url, r.url)
}

/** 打开设置页（去扩展管理里启用浏览器扩展）。 */
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
                    <el-icon :size="16"><ArrowRightOutlined /></el-icon>
                    <span>{{ $t('navPage.go') }}</span>
                </el-button>
            </form>

            <section class="nt__quick">
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
                </div>
            </section>

            <p class="nt__empty">
                <span>{{ $t('navPage.noBrowserExt') }}</span>
                <el-button text type="primary" size="small" @click="openSettings">
                    {{ $t('navPage.addInSettings') }}
                </el-button>
            </p>
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
