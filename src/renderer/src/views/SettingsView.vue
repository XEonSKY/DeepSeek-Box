<script setup lang="ts">
import { computed, markRaw, onMounted, ref } from 'vue'
import type { Component } from 'vue'
import { SettingOutlined, DashboardOutlined, BulbOutlined, ApiOutlined, DeploymentUnitOutlined, ClusterOutlined, AppstoreOutlined, CodeFilled, ControlOutlined, InfoCircleFilled, RobotFilled, ApiFilled, FileZipOutlined, DownloadOutlined, CompassOutlined } from '@antdv-next/icons'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from './settings/useSettingsStore'
import { extMenus } from '../extensions/panels'

type Group = 'general' | 'system' | 'appearance' | 'network' | 'env' | 'dsh' | 'models' | 'log' | 'hotkeys' | 'about'

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
    { key: 'about', icon: InfoCircleFilled }
]

/**
 * 扩展贡献的设置面板：**追加在内置项之后**（不能插入内置项中间，
 * 否则"设置页长什么样"会变得不确定）。扩展面板的图标由外壳统一映射 —— 扩展不能传组件。
 *
 * 注意：「扩展管理」页本身也走这条通路（由内置扩展 `xeonsky.extm` 贡献），
 * 外壳不为它写特例 —— 内置扩展与外部扩展在控制点上的待遇一致，唯一的差别是主进程侧的加载方式。
 */
const extItems = computed(() => extMenus())

/**
 * 扩展面板侧栏图标：贡献里只能给**图标名**（字符串），外壳在这里查表映射成组件 ——
 * 扩展不允许传组件进来，否则等于让它往外壳的 JS 上下文里注入任意实现。
 *
 * 表里没有的名字（或干脆没声明 `icon`）一律回落到 {@link EXT_ICON_FALLBACK}，
 * 所以这里**必须**有一个兜底项，不能出现"查不到就是空白"的情况。
 */
const EXT_ICON_FALLBACK: Component = markRaw(ApiFilled)
const EXT_ICONS: Record<string, Component> = {
    api: markRaw(ApiFilled),
    app: markRaw(AppstoreOutlined),
    archive: markRaw(FileZipOutlined),
    cluster: markRaw(ClusterOutlined),
    compass: markRaw(CompassOutlined),
    dashboard: markRaw(DashboardOutlined),
    download: markRaw(DownloadOutlined),
    setting: markRaw(SettingOutlined)
}

/** 取扩展面板的图标组件；查不到就回落（保证侧栏每项都有图标）。 */
function extIcon(name: string | undefined): Component {
    return (name && EXT_ICONS[name]) || EXT_ICON_FALLBACK
}

/**
 * 由当前子路由决定高亮分组。
 *
 * 内置面板的 name 是 `settings-<key>`；扩展贡献的面板走兜底路由（name 固定为
 * `settings-ext-panel`），key 在 `params.panelKey` 里 —— 两种都要能高亮，
 * 否则扩展面板在侧栏里点上去不亮。
 */
const activeGroup = computed<string>(() => {
    const n = route.name
    if (n === 'settings-ext-panel') {
        const p = route.params.panelKey
        return typeof p === 'string' ? p : Array.isArray(p) ? (p[0] ?? 'general') : 'general'
    }
    return typeof n === 'string' && n.startsWith('settings-') ? n.slice(9) : 'general'
})

function go(g: string): void {
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

                <!-- 扩展贡献的面板：追加在内置项之后，图标由外壳统一给（扩展不能传组件）。 -->
                <button
                    v-for="m in extItems"
                    :key="'ext-' + m.extId + '-' + m.key"
                    type="button"
                    class="nav__item"
                    :class="{ on: activeGroup === m.key }"
                    @click="go(m.key)"
                >
                    <el-icon :size="18"><component :is="extIcon(m.icon)" /></el-icon>
                    <span class="nav__label" :title="m.extName">{{ $t(m.titleKey) }}</span>
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
    它要同时作用于经 <router-view> 嵌套渲染的 10 个子面板（General / System / Appearance / Network / Env / Dsh / Models / Log / Hotkeys / About），留在本组件里既撑大文件、又让这层
    依赖不可见；抽成独立样式表后，子面板改样式时可一眼看到该改哪个文件。
-->
