<script setup lang="ts">
import { computed } from 'vue'

/**
 * 向导步骤条：**圆角矩形 + 底部进度条**。
 *
 * 为什么不用 `el-steps`：
 *  - Element Plus 的步骤条把「已完成 / 进行中 / 未开始」表达为圆圈 + 连接线，
 *    没有「当前这一步整体完成了多少」的位置 —— 而安装向导恰恰是一个**长时间执行**的流程
 *    （测速、下载 npm、装 dsh），用户最需要看到的就是当前步的进度；
 *  - 底边进度条能在**不额外增加高度**的前提下表达进度：整条导航栏高度不变，
 *    进度就画在每个圆角矩形的下沿。
 *
 * 语义：矩形本身表示「第几步」（已完成 / 进行中 / 未开始），
 * 底部细条表示「这一步完成了多少」。进度为 `null` 时显示不确定动画（适合解压这类没有百分比的阶段）。
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

/** 某一步的填充样式：已完成恒满，当前步按进度（不确定时交给 CSS 动画），未开始为空。 */
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
            <!-- 底沿进度：轨道始终占位，宽度不足时也不影响布局 -->
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
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
}
.wsteps__item {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 10px;
    border: 1px solid var(--el-border-color);
    border-radius: 8px;
    background: var(--el-fill-color-lighter);
    color: var(--el-text-color-secondary);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    transition:
        color 0.2s ease,
        border-color 0.2s ease,
        background 0.2s ease;
}
.wsteps__label {
    overflow: hidden;
    text-overflow: ellipsis;
}
.wsteps__track {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    overflow: hidden;
    /* 与矩形下沿同曲率，进度条不会溢出圆角 */
    border-radius: 0 0 7px 7px;
    background: color-mix(in srgb, var(--el-border-color) 60%, transparent);
}
.wsteps__fill {
    display: block;
    height: 100%;
    width: 0;
    background: var(--el-color-primary);
    transition: width 0.3s ease;
}
/* 已完成：整体变绿，底条填满 */
.wsteps__item.is-done {
    border-color: var(--el-color-success-light-5);
    background: var(--el-color-success-light-9);
    color: var(--el-color-success);
}
.wsteps__item.is-done .wsteps__fill {
    background: var(--el-color-success);
}
/* 进行中：高亮 + 加粗，底条是当前步的进度 */
.wsteps__item.is-active {
    border-color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
    font-weight: 600;
}
/* 不确定进度：一条短条在轨道里来回滑（解压 / 测速这类拿不到百分比的阶段） */
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
