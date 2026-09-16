<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CloseOutlined, FullscreenExitOutlined, FullscreenOutlined, MinusOutlined } from '@antdv-next/icons'
import { WIN_GLYPH, WIN_GLYPH_STACK, winGlyphsAvailable } from '../lib/winicons'

/**
 * 窗口控制按钮组：最小化 / 最大化-还原 / 关闭。
 *
 * 从 TitleBar 抽出。安装向导是**全屏遮罩**（会盖住应用标题栏），它自带的顶部导航栏
 * 需要同一组按钮，否则安装期间窗口既不能移动也不能最小化 / 关闭。
 *
 * ⚠️ 最大化状态**必须订阅主进程事件**，不能各自记状态：双击拖动区、系统快捷键、Aero Snap
 * 同样会改变最大化状态，每个实例各写一份迟早会与真实状态脱节（表现为图标和窗口对不上）。
 * 两个位置同时挂载是正常的（向导盖住标题栏时标题栏仍在），因此这里不用单例、不共享状态。
 *
 * 无 props / 无 emits：按钮行为只走 IPC，样式靠全局的 `.icon-btn`（见 styles/shared.css）。
 */

const winMinimize = (): void => void window.api.post('/windows/minimize')
const winMaximize = (): void => void window.api.post('/windows/maximize-toggle')
const winClose = (): void => void window.api.post('/windows/close')

/**
 * Windows 下改用系统自带的窗口控制字形（Segoe Fluent Icons → Segoe MDL2 Assets → Segoe UI Symbol），
 * 与系统原生标题栏一致；字体或字形不可用时保留 antdv 的矢量图标（见 lib/winicons.ts）。
 */
const useWinGlyphs = winGlyphsAvailable()

const maximized = ref(false)
let offMaximized: (() => void) | null = null

/** 第二个按钮的字形：最大化 / 还原。 */
const maxRestoreGlyph = computed(() => (maximized.value ? WIN_GLYPH.restore : WIN_GLYPH.maximize))

/**
 * 字形字体栈以**内联样式**注入，而不是写死在 CSS 里：字体顺序与可用性探测（lib/winicons.ts）
 * 必须永远是同一份，写两处迟早会走偏。
 */
const glyphStyle = { fontFamily: WIN_GLYPH_STACK }

onMounted(async () => {
    try {
        maximized.value = await window.api.get('/windows/maximized')
    } catch {
    /* 取不到就按未最大化渲染 */
    }
    offMaximized = window.api.on('win:maximized', (v) => {
        maximized.value = v
    })
})

onBeforeUnmount(() => {
    offMaximized?.()
})
</script>

<template>
    <div class="window-controls">
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
</template>

<style scoped>
.window-controls {
    display: flex;
    align-items: center;
    gap: 4px;
}
/* 按钮可点不可拖：所在的容器（标题栏 / 向导导航栏）都是拖动区，空隙仍可拖窗口。 */
.window-controls .icon-btn {
    -webkit-app-region: no-drag;
}
</style>
