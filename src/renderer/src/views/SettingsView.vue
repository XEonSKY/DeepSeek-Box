<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import { SettingOutlined, DashboardOutlined, BulbOutlined, ApiOutlined, DeploymentUnitOutlined, ClusterOutlined, CodeFilled, ControlOutlined, CompassOutlined, InfoCircleFilled, RobotFilled } from '@antdv-next/icons'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from './settings/useSettingsStore'

type Group = 'general' | 'system' | 'appearance' | 'network' | 'env' | 'dsh' | 'models' | 'log' | 'hotkeys' | 'webview' | 'about'

const { actions } = useSettingsStore()
const route = useRoute()
const router = useRouter()

const menus: { key: Group; icon: Component }[] = [
    { key: 'general', icon: SettingOutlined },
    { key: 'system', icon: DashboardOutlined },
    { key: 'appearance', icon: BulbOutlined },
    { key: 'network', icon: ApiOutlined },
    { key: 'env', icon: DeploymentUnitOutlined },
    { key: 'dsh', icon: ClusterOutlined },
    { key: 'models', icon: RobotFilled },
    { key: 'log', icon: CodeFilled },
    { key: 'hotkeys', icon: ControlOutlined },
    { key: 'webview', icon: CompassOutlined },
    { key: 'about', icon: InfoCircleFilled }
]

/** 由当前子路由决定高亮分组。 */
const activeGroup = computed<Group>(() => {
    const n = route.name
    return typeof n === 'string' && n.startsWith('settings-') ? (n.slice(9) as Group) : 'general'
})

function go(g: Group): void {
    void router.push(`/settings/${g}`)
}

const loading = ref(false)

// 进入设置时把磁盘设置填进 store（store 的 watch 会随之应用主题/语言）。
onMounted(async () => {
    loading.value = true
    try {
        const s = await window.api.get('/settings')
        actions.fillFrom(s)
    } finally {
        loading.value = false
    }
    await actions.loadVersion()
    void actions.loadVersions()
})
</script>

<template>
    <div class="settings">
        <aside class="side">
            <div class="side__cap">{{ $t('sv.cap') }}</div>
            <nav class="nav">
                <button
                    v-for="m in menus"
                    :key="m.key"
                    type="button"
                    class="nav__item"
                    :class="{ on: activeGroup === m.key }"
                    @click="go(m.key)"
                >
                    <el-icon :size="18"><component :is="m.icon" /></el-icon>
                    <span class="nav__label">{{ $t('sv.nav.' + m.key) }}</span>
                </button>
            </nav>
        </aside>

        <div class="main">
            <!-- 页头由各子页自带（大图标标题头），此处不再渲染 -->
            <el-scrollbar v-loading="loading" class="main__scroll">
                <div class="cols">
                    <router-view />
                </div>
            </el-scrollbar>
        </div>
    </div>
</template>

<!--
    样式已抽到 src/renderer/src/styles/settings.css（非 scoped 的全局样式，由 main.ts 统一加载）。
    它要同时作用于经 <router-view> 嵌套渲染的 11 个子面板（General / System / Appearance / Network / Env / Dsh / Models / Log / Hotkeys / Webview / About），留在本组件里既撑大文件、又让这层
    依赖不可见；抽成独立样式表后，子面板改样式时可一眼看到该改哪个文件。
-->
