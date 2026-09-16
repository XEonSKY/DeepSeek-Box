<script setup lang="ts">
import { computed } from 'vue'

/**
 * 向导步骤条：**扁平简约 + 一条整体进度条**。
 *
 * 结构 = 一行步骤标签 + 标签下方**一条贯通全长的进度条**。
 * 步骤标签只负责「在第几步」（未开始 / 已完成 / 进行中三档文字颜色），
 * 进度条负责「整体做到哪了」—— 两者分工，互不重复表达同一件事。
 *
 * 为什么是**一条**整体进度而不是每步各一条：
 * 每步各一条要求每一步都报得出百分比，而安装流程里测速、装 dsh 这类阶段
 * 根本拿不到百分比，只能让那一段跑「不确定」滑动动画 —— 于是同一排里
 * 有的段满、有的段空、有的段在动，反而更难一眼看出装到哪了。
 * 合成一条后进度必定单调不减，且任何时刻都有确切数值，**不需要任何加载动画**。
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
    <div class="wsteps">
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
        <!-- 整体进度：轨道贯穿全长，填充按百分比。没有动画，只有宽度过渡 -->
        <div
            class="wsteps__bar"
            role="progressbar"
            :aria-valuenow="width"
            aria-valuemin="0"
            aria-valuemax="100"
        >
            <div class="wsteps__fill" :style="{ width: width + '%' }" />
        </div>
    </div>
</template>

<style scoped>
.wsteps {
    flex: 0 1 560px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
/* 一行步骤标签，等宽平分；没有边框、底色、色块 */
.wsteps__list {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0;
    padding: 0;
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
/* 已完成：常规色；进行中：主色加粗。靠颜色分级，不靠背景块 */
.wsteps__item.is-done {
    color: var(--el-text-color-regular);
}
.wsteps__item.is-active {
    color: var(--el-color-primary);
    font-weight: 600;
}
/* 整体进度条：2px，贯穿步骤标签下方全长 */
.wsteps__bar {
    height: 2px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--el-border-color-lighter);
}
.wsteps__fill {
    height: 100%;
    border-radius: 999px;
    background: var(--el-color-primary);
    /* 只过渡宽度：进度是连续推进的，突变会显得跳 */
    transition: width 0.3s ease;
}
</style>
