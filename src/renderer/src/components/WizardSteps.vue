<script setup lang="ts">
import { computed } from 'vue'

/**
 * 向导步骤条：**扁平简约** —— 只有一行文字 + 一条细进度线，没有边框、底色和色块。
 *
 * 为什么不用 `el-steps` / `a-steps`：
 *  - 这两种组件用「圆圈 + 连接线」表达状态，占高度、视觉重，还与自绘的标题栏风格不搭；
 *  - 更要紧的是它没有「当前这一步完成了多少」的位置 —— 而安装是长耗时流程
 *    （测速、下载 npm、装 dsh），用户最需要看到的恰恰是这个。
 *
 * 设计：每一步只保留两样东西 —— 标签文字、标签下方的细线。
 *  - 文字颜色表达状态：未开始（浅）· 已完成（常规）· 进行中（主色）；
 *  - 细线表达进度：已完成铺满、进行中按百分比、未开始为空。
 *
 * 线只有 2px 且不额外占高度，所以整条导航栏高度不受影响；
 * 进度为 `null` 时线里跑一段滑动动画，用于解压 / 测速这类拿不到百分比的阶段。
 */

const props = defineProps<{
    /** 步骤列表；`key` 用于 v-for，`label` 是展示文案。 */
    steps: ReadonlyArray<{ key: string; label: string }>
    /** 当前进行到的下标（0 起）。 */
    active: number
    /** 当前步的完成百分比 0–100；`null` 表示不确定（跑动画）。 */
    progress: number | null
}>()

/** 把进度夹到 0–100：上游给的速度 / 百分比偶有越界或 NaN。 */
const activePercent = computed(() => {
    const p = props.progress
    if (p === null || !Number.isFinite(p)) return null
    return Math.max(0, Math.min(100, p))
})

/** 某一步的填充宽度：已完成恒满，当前步按进度（不确定时交给 CSS 动画），未开始为空。 */
function fillStyle(i: number): Record<string, string> {
    if (i < props.active) return { width: '100%' }
    if (i > props.active) return { width: '0' }
    const p = activePercent.value
    return p === null ? {} : { width: p + '%' }
}

/** 当前步是否处于「不确定进度」状态（需要跑动画）。 */
function isIndeterminate(i: number): boolean {
    return i === props.active && activePercent.value === null
}
</script>

<template>
    <ol class="wsteps">
        <li
            v-for="(s, i) in steps"
            :key="s.key"
            class="wsteps__item"
            :class="{ 'is-done': i < active, 'is-active': i === active }"
            :aria-current="i === active ? 'step' : undefined"
        >
            <span class="wsteps__label">{{ s.label }}</span>
            <span class="wsteps__track">
                <span
                    class="wsteps__fill"
                    :class="{ 'is-indeterminate': isIndeterminate(i) }"
                    :style="fillStyle(i)"
                />
            </span>
        </li>
    </ol>
</template>

<style scoped>
.wsteps {
    flex: 0 1 560px;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 0;
    padding: 0;
    list-style: none;
}
/* 每一步 = 文字 + 下方细线；没有任何边框 / 底色 / 色块 */
.wsteps__item {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: var(--el-text-color-placeholder);
    font-size: 12px;
    line-height: 1.2;
    transition: color 0.2s ease;
}
.wsteps__label {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
/* 轨道：很浅的一条底线，用来交代「这条线是有长度的」 */
.wsteps__track {
    height: 2px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--el-border-color-lighter);
}
.wsteps__fill {
    display: block;
    height: 100%;
    width: 0;
    border-radius: 999px;
    background: var(--el-color-primary);
    transition: width 0.3s ease;
}
/* 已完成：文字转为常规色，线铺满 */
.wsteps__item.is-done {
    color: var(--el-text-color-regular);
}
.wsteps__item.is-done .wsteps__fill {
    background: var(--el-color-success);
}
/* 进行中：主色文字，线是当前步的进度 */
.wsteps__item.is-active {
    color: var(--el-color-primary);
    font-weight: 600;
}
/* 不确定进度：一段短线在轨道里来回滑（解压 / 测速这类拿不到百分比的阶段） */
.wsteps__fill.is-indeterminate {
    width: 40%;
    animation: wsteps-slide 1.1s ease-in-out infinite;
}
@keyframes wsteps-slide {
    0% {
        transform: translateX(-100%);
    }
    100% {
        transform: translateX(250%);
    }
}
</style>
