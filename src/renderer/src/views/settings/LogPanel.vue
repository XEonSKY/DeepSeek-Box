<script setup lang="ts">
import { CodeFilled } from '@antdv-next/icons'
import LogView from '../LogView.vue'

/**
 * 「终端」设置面板 —— 把 dsh 实时输出（stdout / stderr）搬进设置页。
 *
 * 终端本体仍是 `views/LogView.vue`（xterm 组件；和 `views/WebHost.vue` 一样是**非路由组件**，
 * 只是被谁渲染而已），本面板只负责设置页该有的外壳：品牌头 + 定高卡片。
 *
 * ⚠️ 卡片**必须给确定高度**：设置内容区是滚动容器（`.settings .main__scroll`），
 * 父级没有确定高度时 `height: 100%` 会塌成 0 —— 既看不见终端，xterm 的 FitAddon 也算不出行列。
 * 用视口单位而不是固定 px，这样窗口拉高时终端跟着长。
 */
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><el-icon :size="34"><CodeFilled /></el-icon></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.log') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.log') }}</div>
            </div>
        </div>

        <div class="term">
            <LogView />
        </div>
    </div>
</template>

<style scoped>
/* 只留本组件专用规则；跨组件的通用样式一律进 styles/*.css（见 AGENT.md §3 样式约定）。 */
.term {
    height: 58vh;
    min-height: 260px;
    border: 1px solid var(--el-border-color);
    border-radius: 10px;
    overflow: hidden;
    background: var(--el-bg-color);
}
</style>
