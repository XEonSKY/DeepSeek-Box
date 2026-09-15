<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DeleteOutlined } from '@antdv-next/icons'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { LogEntry } from '@shared/types'

/**
 * 终端组件：用 xterm.js 渲染 dsh 的 stdout/stderr 流。
 * 相比原来的纯文本分行，xterm 能正确显示 dsh 输出的 ANSI 颜色/光标控制，且对“跨数据块被切开的
 * 半行”也能自然续写（不再把每个网络块误当一整行）。
 *
 * **不是路由视图**：终端现在是设置页的一个面板，由 `views/settings/LogPanel.vue` 渲染（标题与
 * 定高卡片都在那边）。本组件只管「工具条 + xterm 画布」，高度填满父容器 —— 所以父级必须给确定高度。
 */

const host = ref<HTMLDivElement | null>(null)
const written = ref(0)
const hasAny = ref(false)
const autoScroll = ref(true)

let term: Terminal | null = null
let fit: FitAddon | null = null
let ro: ResizeObserver | null = null
let offLog: (() => void) | null = null

const isDark = (): boolean => document.documentElement.classList.contains('dark')

function themeOf(dark: boolean): { background: string; foreground: string; cursor: string } {
    return dark
        ? { background: '#11151c', foreground: '#e6e6e6', cursor: '#6ea8ff' }
        : { background: '#fbfbfb', foreground: '#1f2329', cursor: '#2f6fce' }
}

function ensureFit(): void {
    try {
        fit?.fit()
    } catch {
    /* element not laid out yet */
    }
}

function scrollBottom(): void {
    try {
        term?.scrollToBottom()
    } catch {
    /* ignore */
    }
}

function write(k: LogEntry['k'], s: unknown): void {
    if (!term) return
    const text = String(s ?? '')
    if (!text) return
    // 错误流（stderr）着色提示；stdout 原样（其本身常已含 ANSI 颜色，交给 xterm 渲染）。
    term.write(k === 'e' ? `\u001b[91m${text}\u001b[0m` : text)
    written.value++
    hasAny.value = true
    if (autoScroll.value) scrollBottom()
}

function clear(): void {
    term?.reset()
    written.value = 0
    hasAny.value = false
}

onMounted(async () => {
    term = new Terminal({
        convertEol: true,
        cursorBlink: false,
        disableStdin: true,
        allowProposedApi: false,
        scrollback: 8000,
        fontSize: 13,
        lineHeight: 1.25,
        fontFamily:
      "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
        theme: themeOf(isDark())
    })
    fit = new FitAddon()
    term.loadAddon(fit)
    if (host.value) term.open(host.value)
    ensureFit()
    ro = new ResizeObserver(ensureFit)
    if (host.value) ro.observe(host.value)

    const history = await window.api.get('/logs')
    for (const entry of history) write(entry.k, entry.s)
    offLog = window.api.on('dsh:log', (entry) => write(entry.k, entry.s))
})

onBeforeUnmount(() => {
    offLog?.()
    ro?.disconnect()
    ro = null
    try {
        term?.dispose()
    } catch {
    /* already gone */
    }
    term = null
    fit = null
})
</script>

<template>
    <div class="log">
        <div class="log__bar">
            <span class="meta">{{ $t('log.lineCount', { count: written }) }}</span>
            <div class="spacer" />
            <el-checkbox v-model="autoScroll">{{ $t('log.autoScroll') }}</el-checkbox>
            <el-button size="small" text type="danger" @click="clear">
                <el-icon><DeleteOutlined /></el-icon>
                <span>{{ $t('log.clear') }}</span>
            </el-button>
        </div>
        <div ref="host" class="log__host"></div>
        <div v-if="!hasAny" class="placeholder">{{ $t('log.empty') }}</div>
    </div>
</template>

<style scoped>
.log {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}
.log__bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--el-border-color-light);
  font-size: 13px;
}
.meta {
  color: var(--el-text-color-secondary);
}
.spacer {
  flex: 1 1 auto;
}
.log__host {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  padding: 4px 8px 8px;
}
/* xterm 画布铺满、不露白色底 */
.log__host :deep(.xterm) {
  height: 100%;
}
.log__host :deep(.xterm-viewport) {
  background: transparent !important;
}
.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-placeholder);
  pointer-events: none;
}
</style>
