<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
    DeepSeekFilled,
    MessageFilled,
    WalletFilled,
    SettingFilled,
    MinusOutlined,
    FullscreenOutlined,
    FullscreenExitOutlined,
    CloseOutlined,
    ReloadOutlined,
    PlusOutlined,
    StarOutlined,
    StarFilled
} from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import { useAppIcon } from '../lib/appIcon'
import { tt } from '../lib/locales'
import { WIN_GLYPH, WIN_GLYPH_STACK, winGlyphsAvailable } from '../lib/winicons'
import { useView, useGoView } from '../shell/viewnav'
import { webTabs, activeTab, findTab, activateTab, closeTab, openTab, openNewTab, toggleKeep, tabLabel } from '../shell/tabs'
import { shellMeta } from '../shell/shellmeta'
import { useTabDrag } from '../shell/useTabDrag'
import { NEWTAB_URL } from '@shared/types'

/**
 * 自绘标题栏：应用标识 + 固定站 / 跳核心按钮 + 浏览器式标签条 + 窗口控制，
 * 并连同跨窗口拖拽的「可接收遮罩 / 幽灵标签」与标签右键菜单一起渲染。
 *
 * 从 App.vue 抽出。它是**多根组件**：`<header>` 保持为 .shell 的直接 flex 子项（布局不变），
 * 其余根节点都是 position:fixed，不参与 flex 布局。故无需 props——标签状态来自 tabs.ts 单例，
 * 视图状态来自 viewnav.ts，窗口控制直接走 window.api。
 */
const appIcon = useAppIcon()
const view = useView()
const go = useGoView()

// 标签页拖拽：同窗口内拖动=排序；拖到其它窗口（其顶部标签栏亮浅蓝遮罩可接收）=把标签移过去。
const { bindTabsBar, onTabPointerDown, draggingTabId, slotBeforeId, hoverMask, ghost } = useTabDrag()

/**
 * 点击一个标签页：激活并确保显示在 web 宿主。
 * Ctrl/⌘+点击则改用系统浏览器打开该标签网址（与普通点击一致的处理入口）。
 */
function onTabClick(id: string, ev?: MouseEvent): void {
    if (ev && (ev.ctrlKey || ev.metaKey)) {
        const tab = findTab(id)
        if (tab?.url) {
            ev.preventDefault()
            void window.api.openExternal(tab.url)
            return
        }
    }
    activateTab(id)
    go('web')
}

/** 点击标签页关闭按钮。 */
function onTabClose(id: string): void {
    closeTab(id)
}

/** 点击“保活固定”按钮（仅动态标签页）。 */
function onTabKeep(id: string): void {
    toggleKeep(id)
}

/** 中键(mouse button 1)关闭标签页。 */
function onTabMouseDown(id: string, e: MouseEvent): void {
    if (e.button === 1) {
        e.preventDefault()
        closeTab(id)
    }
}

/** 右键菜单状态：位置 + 目标标签。 */
const ctx = ref<{ x: number; y: number; id: string } | null>(null)
function onTabContext(id: string, e: MouseEvent): void {
    ctx.value = { x: e.clientX, y: e.clientY, id }
}
function closeCtx(): void {
    ctx.value = null
}
/** 复制标签页。 */
function ctxDup(): void {
    const tab = ctx.value ? findTab(ctx.value.id) : undefined
    closeCtx()
    if (!tab) return
    if (tab.kind === 'newtab') openNewTab()
    else openTab(tab.url ?? '', tab.title)
}
/** 关闭标签页。 */
function ctxClose(): void {
    const id = ctx.value?.id
    closeCtx()
    if (id) closeTab(id)
}

/** 在新窗口打开：把该标签目标（动态页 URL，或内置导航页伪链接 dssh://about:blank）开到一个独立窗口。 */
async function ctxOpenWindow(): Promise<void> {
    const tab = ctx.value ? findTab(ctx.value.id) : undefined
    closeCtx()
    if (!tab) return
    const target = tab.kind === 'newtab' ? NEWTAB_URL : tab.url
    if (target) await window.api.openWebWindow(target)
}

/** 移动到其它窗口：弹出目标窗口选择；目标开该标签（含内置导航页），再从本窗口移除；取消则保留。 */
async function ctxMove(): Promise<void> {
    const tab = ctx.value ? findTab(ctx.value.id) : undefined
    closeCtx()
    if (!tab) return
    const target = tab.kind === 'newtab' ? NEWTAB_URL : tab.url
    if (!target) return
    const moved = await window.api.moveTabToWindow(target)
    if (moved) closeTab(tab.id)
    // 「没有其它窗口可接收」时主进程返回 false；不说一声的话就是点了没反应
    else ElMessage.info(tt('app.tabs.moveWindowNoTarget'))
}

/** 跳转到核心窗口（副窗口用）：经 IPC 聚焦当前核心窗口；无核心则主进程重建一个。 */
async function jumpToCore(): Promise<void> {
    await window.api.focusCoreWindow()
}

/** 滚轮滚动标签条时改为横向滚动。 */
function onTabsWheel(e: WheelEvent): void {
    const el = e.currentTarget as HTMLElement | null
    if (!el || el.scrollWidth <= el.clientWidth) return
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (delta === 0) return
    el.scrollLeft += delta
}

/** ＋ 新建：按设置开内置导航页或自定义 URL。 */
async function onPlus(): Promise<void> {
    try {
        const s = await window.api.getSettings()
        if (s.newTabMode === 'url' && s.newTabUrl) openTab(s.newTabUrl)
        else openNewTab()
    } catch {
        openNewTab()
    }
    go('web')
}

/** 动态/新标签页（由新开链接/＋ 产生）；固定三站以图标按钮呈现，不在此列。 */
const dynamicTabs = computed(() => webTabs.list.filter((tab) => tab.kind === 'dynamic' || tab.kind === 'newtab'))

/** 某个 web 标签是否当前激活（仅 web 宿主视图内高亮）。 */
function isWebActive(id: string): boolean {
    return view.value === 'web' && webTabs.activeId === id
}

/** 某个 web 标签是否当前激活（仅 web 宿主视图内高亮）。 */
const navVisible = computed(() => view.value === 'web' && activeTab()?.kind === 'dynamic')
/** 激活的是否三个固定站之一（固定站才显示标题栏旧版刷新按钮）。 */
const fixedPageReload = computed(() => {
    if (view.value !== 'web') return false
    const k = activeTab()?.kind
    return k === 'home' || k === 'chat' || k === 'platform'
})

const winMinimize = (): void => window.api.windowMinimize()
const winMaximize = (): void => window.api.windowToggleMaximize()
const winClose = (): void => window.api.windowClose()
const winReload = (): void => window.api.reloadDsh()

/**
 * Windows 下改用系统自带的窗口控制字形（Segoe Fluent Icons → Segoe MDL2 Assets → Segoe UI Symbol），
 * 与系统原生标题栏一致；字体或字形不可用时保留 antdv 的矢量图标（见 lib/winicons.ts）。
 */
const useWinGlyphs = winGlyphsAvailable()

/**
 * 窗口是否最大化：决定右上角显示「最大化」还是「还原」图标 + 对应提示文案。
 * 必须订阅主进程事件而不是自己记状态 —— 双击拖动区、系统快捷键、Aero Snap 同样会改变最大化状态。
 */
const maximized = ref(false)
let offMaximized: (() => void) | null = null

/** 右上角第二个按钮的字形：最大化 / 还原。 */
const maxRestoreGlyph = computed(() => (maximized.value ? WIN_GLYPH.restore : WIN_GLYPH.maximize))

/**
 * 字形字体栈以**内联样式**注入，而不是写死在 CSS 里：字体顺序与可用性探测（lib/winicons.ts）
 * 必须永远是同一份，写两处迟早会走偏。
 */
const glyphStyle = { fontFamily: WIN_GLYPH_STACK }

onMounted(async () => {
    try {
        maximized.value = await window.api.isWindowMaximized()
    } catch {
    /* 取不到就按未最大化渲染 */
    }
    offMaximized = window.api.onWindowMaximized((v) => {
        maximized.value = v
    })
})

onBeforeUnmount(() => {
    offMaximized?.()
})
</script>

<template>
    <header class="titlebar" :class="{ 'titlebar--flush': navVisible }">
        <div class="left">
            <div class="brand">
                <div class="logo">
                    <img :src="appIcon" class="logo__img" alt="" draggable="false" />
                </div>
                <span class="title">{{ $t('app.title') }}</span>
            </div>

            <div class="quick">
                <template v-if="shellMeta.isCore">
                    <el-tooltip :content="$t('app.nav.ui')" placement="bottom" :show-after="300">
                        <button class="icon-btn" :class="{ active: isWebActive('home') }" type="button" @click="onTabClick('home', $event)">
                            <el-icon><DeepSeekFilled /></el-icon>
                        </button>
                    </el-tooltip>
                    <el-tooltip :content="$t('app.nav.chat')" placement="bottom" :show-after="300">
                        <button class="icon-btn" :class="{ active: isWebActive('chat') }" type="button" @click="onTabClick('chat', $event)">
                            <el-icon><MessageFilled /></el-icon>
                        </button>
                    </el-tooltip>
                    <el-tooltip :content="$t('app.nav.platform')" placement="bottom" :show-after="300">
                        <button class="icon-btn" :class="{ active: isWebActive('platform') }" type="button" @click="onTabClick('platform', $event)">
                            <el-icon><WalletFilled /></el-icon>
                        </button>
                    </el-tooltip>
                </template>
                <template v-else>
                    <el-tooltip :content="$t('app.jumpCoreHint')" placement="bottom" :show-after="300">
                        <button class="icon-btn core-jump" type="button" @click="jumpToCore">
                            <el-icon :size="18"><DeepSeekFilled /></el-icon>
                            <span class="core-jump__txt">{{ $t('app.jumpCore') }}</span>
                        </button>
                    </el-tooltip>
                </template>
                <span class="divider" />
            </div>

            <!-- 动态标签页条：可开很多，多标签时原生横向滚动；空白区可拖窗口 -->
            <div class="tabs" :ref="bindTabsBar" @wheel="onTabsWheel">
                <div
                    v-for="tab in dynamicTabs"
                    :key="tab.id"
                    class="tab"
                    :class="{ on: isWebActive(tab.id), dragging: draggingTabId === tab.id, slot: slotBeforeId === tab.id }"
                    :title="tab.url ?? ''"
                    @click="onTabClick(tab.id, $event)"
                    @mousedown="onTabMouseDown(tab.id, $event)"
                    @contextmenu.prevent="onTabContext(tab.id, $event)"
                    @pointerdown="onTabPointerDown(tab, $event)"
                >
                    <span class="tab__label">{{ tabLabel(tab) }}</span>
                    <button
                        v-if="tab.kind === 'dynamic'"
                        class="tab__pin"
                        :class="{ on: tab.keep }"
                        type="button"
                        :title="$t('app.tabs.keep')"
                        @click.stop="onTabKeep(tab.id)"
                    >
                        <el-icon :size="11"><component :is="tab.keep ? StarFilled : StarOutlined" /></el-icon>
                    </button>
                    <button
                        class="tab__x"
                        type="button"
                        :title="$t('app.tabs.close')"
                        @click.stop="onTabClose(tab.id)"
                    >
                        <el-icon :size="12"><CloseOutlined /></el-icon>
                    </button>
                </div>

                <button class="tab tab--add" type="button" :title="$t('app.tabs.new')" @click="onPlus">
                    <el-icon :size="16"><PlusOutlined /></el-icon>
                </button>
            </div>
        </div>

        <div class="right">
            <!-- 三个固定站(非动态标签页)：用旧版刷新按钮重载当前固定站 -->
            <el-tooltip v-if="fixedPageReload" :content="$t('app.reload')" placement="bottom" :show-after="300">
                <button class="icon-btn" type="button" @click="winReload">
                    <el-icon><ReloadOutlined /></el-icon>
                </button>
            </el-tooltip>
            <el-tooltip :content="$t('app.nav.settings')" placement="bottom" :show-after="300">
                <button
                    class="icon-btn"
                    :class="{ active: view === 'settings' }"
                    type="button"
                    @click="go('settings')"
                >
                    <el-icon><SettingFilled /></el-icon>
                </button>
            </el-tooltip>
            <span class="divider" />
            <el-tooltip :content="$t('app.minimize')" placement="bottom" :show-after="300">
                <button class="icon-btn" type="button" @click="winMinimize">
                    <span v-if="useWinGlyphs" class="wglyph" :style="glyphStyle" aria-hidden="true">{{ WIN_GLYPH.minimize }}</span>
                    <el-icon v-else><MinusOutlined /></el-icon>
                </button>
            </el-tooltip>
            <el-tooltip :content="maximized ? $t('app.restore') : $t('app.maximize')" placement="bottom" :show-after="300">
                <button class="icon-btn" type="button" @click="winMaximize">
                    <span v-if="useWinGlyphs" class="wglyph" :style="glyphStyle" aria-hidden="true">{{ maxRestoreGlyph }}</span>
                    <el-icon v-else><component :is="maximized ? FullscreenExitOutlined : FullscreenOutlined" /></el-icon>
                </button>
            </el-tooltip>
            <el-tooltip :content="$t('app.closeHint')" placement="bottom" :show-after="300">
                <button class="icon-btn danger" type="button" @click="winClose">
                    <span v-if="useWinGlyphs" class="wglyph" :style="glyphStyle" aria-hidden="true">{{ WIN_GLYPH.close }}</span>
                    <el-icon v-else><CloseOutlined /></el-icon>
                </button>
            </el-tooltip>
        </div>
    </header>

    <!-- 跨窗口拖拽：本窗口被悬停为目标 → 顶部标签栏浅蓝遮罩表示可接收 -->
    <div v-if="hoverMask" class="tab-drop-mask"></div>
    <div v-if="ghost.visible" class="tab-ghost" :style="{ left: ghost.x + 'px', top: ghost.y + 'px' }">
        {{ ghost.text }}
    </div>

    <template v-if="ctx">
        <div class="ctx-bk" @mousedown="closeCtx" @contextmenu.prevent="closeCtx" />
        <div class="ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }">
            <button type="button" @click="ctxDup">{{ $t('app.tabs.dup') }}</button>
            <button type="button" @click="ctxClose">{{ $t('app.tabs.close') }}</button>
            <span class="ctx__sep" />
            <button type="button" @click="ctxOpenWindow">{{ $t('app.tabs.openWindow') }}</button>
            <button type="button" @click="ctxMove">{{ $t('app.tabs.moveWindow') }}</button>
        </div>
    </template>
</template>

<style scoped>
.titlebar {
  -webkit-app-region: drag;
  flex: 0 0 auto;
  height: var(--titlebar-h, 52px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  /* 左侧不留内边距，Logo 才能贴住窗口最左边缘 */
  padding: 0 10px 0 0;
  /* 下边框改用 inset 阴影画：不占布局高度，52×52 的 Logo 正好顶满标题栏 */
  box-shadow: inset 0 -1px 0 var(--el-border-color-light);
  background: var(--el-bg-color);
  user-select: none;
}
/* 动态标签页显示网址导航栏时，去掉标题栏下边框，使标题栏与网址栏无缝相连 */
.titlebar--flush {
  box-shadow: none;
}
.left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}
/* 品牌区：Logo + 标题成组，组内紧贴、与右侧快捷站保持间距 */
.brand {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}
/* Logo 独立元素：宽高随标题栏高度；图标本体固定 32px 居中 */
.logo {
  flex: 0 0 auto;
  width: var(--titlebar-h, 52px);
  height: var(--titlebar-h, 52px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.logo__img {
  display: block;
  width: 32px;
  height: 32px;
  /* 图标本身已是圆角白底；这里圆角与之一致（224/1024 × 32 ≈ 7px），避免二次裁切 */
  border-radius: 7px;
  object-fit: contain;
  -webkit-user-drag: none;
}
.title {
  /* 允许收缩并省略：窄窗口下标题不挤占标签条 */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
  color: var(--el-text-color-primary);
}
.right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}
/* 标题栏里的图标按钮可点不可拖；非按钮区域(分割线/空隙)随容器可拖 */
.titlebar .icon-btn {
  -webkit-app-region: no-drag;
}
.divider {
  width: 1px;
  height: 22px;
  background: var(--el-border-color-lighter);
  margin: 0 6px;
}
/* 左侧快捷站与标签条之间的分割线：去掉右侧外边距，紧贴标签条 */
.quick .divider {
  margin-right: 0;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 点击热区仍是 40×40，只把图标本身调小 —— antdv 图标按 1em 走，改 font-size 即可（见 AGENT.md §6）。 */
  width: 40px;
  height: 40px;
  font-size: 18px;
  border: none;
  border-radius: var(--el-border-radius-base);
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}
.icon-btn.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.icon-btn.danger:hover {
  background: var(--el-color-danger);
  color: #fff;
}
.icon-btn.core-jump {
  width: auto;
  padding: 0 10px;
  gap: 6px;
  font-size: 13px;
}
/* Windows 窗口控制字形（字体族由 TitleBar 内联注入，见 lib/winicons.ts 的 WIN_GLYPH_STACK）。
   图标字体的字形自带留白，12px 才是 Windows 标题栏的观感；18px（.icon-btn 的 antdv 图标尺寸）会明显偏大。
   行高锁 1 且不参与基线对齐，避免字形在 flex 居中的按钮里被推偏。 */
.wglyph {
  font-size: 12px;
  line-height: 1;
  font-weight: 400;
  /* 图标字体只有 Regular 一档，禁止浏览器合成字形 */
  font-synthesis: none;
}
.core-jump__txt {
  white-space: nowrap;
}
/* ---- 固定三站图标按钮区 + 浏览器标签条 ---- */
.quick {
  display: flex;
  align-items: center;
  gap: 2px;
}
.tabs {
  /* 容器可拖窗口；空白（含标签少时右侧）即可拖动，多标签时原生横向滚动 */
  -webkit-app-region: drag;
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.tab {
  -webkit-app-region: no-drag;
  flex: 0 1 auto;
  min-width: 110px;
  max-width: 230px;
  height: 32px;
  padding: 0 6px 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.tab:hover {
  background: var(--el-fill-color);
}
.tab.on {
  background: var(--el-bg-color);
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
.tab__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 保活固定按钮（星标，点亮即保活且不计入名额） */
.tab__pin {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--el-text-color-placeholder);
  cursor: pointer;
}
.tab__pin:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.tab__pin.on {
  color: var(--el-color-warning);
}
.tab__x {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--el-text-color-placeholder);
  cursor: pointer;
}
.tab__x:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.tab--add {
  -webkit-app-region: no-drag;
  flex: 0 0 auto;
  min-width: 0; /* 覆盖 .tab 的 min-width，＋ 按钮不做最小宽度 */
  padding: 0 8px;
}
/* ---- 拖拽：正在拖的标签、本地插入位置、跨窗可接收遮罩、幽灵标签 ---- */
.tab {
  touch-action: none;
}
.tab.dragging {
  opacity: 0.5;
}
.tab.slot {
  box-shadow: -2px 0 0 0 var(--el-color-primary);
}
/* 跨窗口拖拽时，目标窗口顶部的“可接收”浅蓝遮罩带 */
.tab-drop-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  z-index: 60;
  pointer-events: none;
  /* 跟随「配色方案」的主色（原来写死 Element 蓝，换方案时会突兀地残留蓝色）。
     color-mix(in srgb, X N%, transparent) 等价于 X 的 N% 透明度。 */
  background: color-mix(in srgb, var(--el-color-primary) 16%, transparent);
  border-bottom: 1px dashed color-mix(in srgb, var(--el-color-primary) 75%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--el-color-primary) 30%, transparent);
}
/* 拖动时跟随指针的半透明幽灵标签 */
.tab-ghost {
  position: fixed;
  z-index: 3000;
  max-width: 240px;
  padding: 5px 12px;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* 半透明浮层：底色/文字跟随主题变量，深色下不再是一块刺眼的白药丸 */
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border: 1px solid color-mix(in srgb, var(--el-color-primary) 60%, transparent);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: none;
  opacity: 0.92;
}
/* ---- 标签页右键菜单 ---- */
.ctx-bk {
  position: fixed;
  inset: 0;
  z-index: 3000;
}
.ctx {
  position: fixed;
  z-index: 3001;
  min-width: 150px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
}
.ctx button {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.ctx button:hover:not(:disabled) {
  background: var(--el-fill-color);
}
.ctx__sep {
  height: 1px;
  background: var(--el-border-color-lighter);
  margin: 4px 0;
}
</style>
