<script setup lang="ts">
/**
 * DeepSeek Harness 启动加载动画。
 *
 * 复刻 dsh Web UI 进入时的 boot 卡片（HARNESS 字标 + 旋转弧光 spinner + 提示），
 * 让外壳等待 dsh 启动时的占位与内嵌页面自身的进入动画无缝衔接。
 * 配色改用外壳主题变量，深浅色与配色方案自动跟随。
 */
defineProps<{
    /** 可选提示文案（如「正在启动 DeepSeek Harness…」）。 */
    hint?: string
}>()
</script>

<template>
    <div class="hloader">
        <div class="hloader__card">
            <span class="hloader__wordmark">HARNESS</span>
            <span class="hloader__spinner" aria-hidden="true" />
            <span v-if="hint" class="hloader__hint">{{ hint }}</span>
        </div>
    </div>
</template>

<style scoped>
.hloader {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
}
.hloader__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
}
.hloader__wordmark {
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--el-text-color-primary);
}
.hloader__hint {
    font-size: 12px;
    line-height: 18px;
    color: var(--el-text-color-placeholder);
}
/* 旋转弧光：整圈按 0.8s 匀速转动，conic-gradient 画出缺口弧，径向 mask 掏空中心 */
.hloader__spinner {
    position: relative;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--el-border-color);
    animation: hloader-spin 0.8s linear infinite;
}
.hloader__spinner::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    background: conic-gradient(var(--el-color-primary) var(--hloader-arc, 72deg), transparent 0);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0);
    mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0);
}
@keyframes hloader-spin {
    to {
        transform: rotate(360deg);
    }
}
@media (prefers-reduced-motion: reduce) {
    .hloader__spinner {
        animation: none;
    }
}
</style>
