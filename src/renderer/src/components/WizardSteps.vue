<script setup lang="ts">
import { computed } from 'vue'

/**
 * 向导步骤条：**一排步骤文字 + 铺满导航栏整个高度的进度条**。
 *
 * 进度不是一条细线，而是**整条导航栏的背景填充**：导航栏本身就是进度条，
 * 左起已完成的百分比用主色铺满，右侧是未完成部分。这样进度是导航栏里
 * 面积最大的视觉元素，隔很远也能一眼看出装到哪了，且不额外占任何高度。
 *
 * 步骤文字浮在进度之上：靠颜色深浅区分状态（未开始 / 已完成 / 进行中）。
 * 进度条铺满时文字仍在同一位置，不会因为宽度变化而抖动。
 */

const props = defineProps<{
    /** 步骤列表；`key` 用于 v-for，`label` 是展示文案。 */
    steps: ReadonlyArray<{ key: string; label: string }>
    /** 当前进行到的下标（0 起）。 */
    active: number
    /** 整体完成百分比 0–100。 */
    percent: number
}>()

/** 夹到 0–100：上游给的值偶有越界或 NaN。 */
const width = computed(() => {
    const p = props.percent
    if (!Number.isFinite(p)) return 0
    return Math.max(0, Math.min(100, p))
})
</script>

<template>
    <!--
        进度填充铺满这个容器的整个高度（height: 100%），容器由 .wiz-navbar 撑满，
        因此进度条 = 导航栏背景。步骤文字与填充是同级叠放，文字在上层。
    -->
    <div class="wsteps">
        <div class="wsteps__bar" :style="{ width: width + '%' }" />
        <ol class="wsteps__list">
            <li
                v-for="(s, i) in steps"
                :key="s.key"
                class="wsteps__item"
                :class="{ 'is-done': i < active, 'is-active': i === active }"
                :aria-current="i === active ? 'step' : undefined"
            >
                {{ s.label }}
            </li>
        </ol>
        <!-- 无障碍：可视进度由上面的填充表达，这里给读屏一个数值 -->
        <div
            class="wsteps__sr"
            role="progressbar"
            :aria-valuenow="width"
            aria-valuemin="0"
            aria-valuemax="100"
        />
    </div>
</template>

<style scoped>
/* 容器撑满导航栏高度，进度填充才能铺满 */
.wsteps {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
}
/*
 * 进度填充：铺满容器整个高度，从最左边缘起算。
 * 不设圆角、不加边框 —— 它就是导航栏的背景，任何装饰都会让它退回「一条线」的观感。
 */
.wsteps__bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    /* 与导航栏等高的实心填充 */
    background: var(--el-color-primary-light-8);
    /* 只过渡宽度：进度是连续推进的，突变会显得跳 */
    transition: width 0.35s ease;
    pointer-events: none;
}
.wsteps__list {
    position: relative;
    z-index: 1;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 0;
    padding: 0 0 0 14px;
    list-style: none;
}
.wsteps__item {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--el-text-color-placeholder);
    font-size: 12px;
    line-height: 1.2;
    transition: color 0.2s ease;
}
/* 已完成：常规色；进行中：主色加粗 */
.wsteps__item.is-done {
    color: var(--el-text-color-regular);
}
.wsteps__item.is-active {
    color: var(--el-color-primary);
    font-weight: 600;
}
/* 仅供读屏，不参与布局 */
.wsteps__sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
</style>
