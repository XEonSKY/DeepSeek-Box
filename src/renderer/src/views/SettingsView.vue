<script setup lang="ts">
import { computed, onMounted, ref, markRaw } from 'vue'
import type { Component } from 'vue'
import { SettingOutlined, BulbOutlined, DeploymentUnitOutlined, ClusterOutlined, CodeFilled, ControlOutlined, InfoCircleFilled, BuildFilled, CaretDownFilled, DownloadOutlined } from '@antdv-next/icons'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from './settings/useSettingsStore'
import { extMenus } from '../extensions/panels'

type Group = 'general' | 'appearance' | 'env' | 'dsh' | 'log' | 'download' | 'hotkeys' | 'about'

const { actions } = useSettingsStore()
const route = useRoute()
const router = useRouter()

/**
 * 内置一级菜单。
 *
 * 侧栏刻意收窄到「一个面板一件事」：
 *  - 原「系统与性能」「网络」已并入 `general`（都是程序的常规行为，拆开只是让人多点两次）；
 *  - 原「模型」已并入 `dsh`（令牌与余额本来就属于 DeepSeek 的配置）。
 * 剩余这些面板彼此不重叠，继续各自成一页。
 */
const menus: { key: Group; icon: Component }[] = [
    { key: 'general', icon: SettingOutlined },
    { key: 'appearance', icon: BulbOutlined },
    { key: 'env', icon: DeploymentUnitOutlined },
    { key: 'dsh', icon: ClusterOutlined },
    { key: 'log', icon: CodeFilled },
    { key: 'download', icon: DownloadOutlined },
    { key: 'hotkeys', icon: ControlOutlined },
    { key: 'about', icon: InfoCircleFilled }
]

/**
 * 扩展贡献的设置面板 —— 统一收在「扩展」这个一级菜单之下。
 *
 * 之所以收拢：扩展面板是**可变集合**（扩展可以装卸、可以停用），与上面那排固定的一级菜单
 * 性质不同；平铺在一起时，用户分不清哪一项是程序自带、哪一项来自某个扩展。
 * 现在一级项「扩展」是常量（永远在，即便一个扩展都没装），其下才是随扩展增减的子项。
 *
 * 「扩展管理」页本身也走这条通路（由内置扩展 `xeonsky.extm` 贡献），外壳不为它写特例。
 */
const extItems = computed(() => extMenus())

/**
 * 扩展面板的图标：扩展只能给**图标名**（字符串），外壳统一映射成 `<BuildFilled />` ——
 * 扩展不允许传组件进来，否则等于让它往外壳的 JS 上下文里注入任意实现。
 *
 * 之所以所有扩展项用同一个图标（而不是继续查 {@link EXT_ICONS} 那张表）：它们已经是
 * 二级子项，被折叠在「扩展」一级项之下，各自的图标反而让层级更乱；统一图标把
 * 「这一组都是扩展」这件事表达得更清楚。
 */
const EXT_ICON: Component = markRaw(BuildFilled)

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

/** 「扩展」一级项是否处于展开 / 高亮态（子项任一命中即算）。 */
const extRootOn = computed(() => extItems.value.some((m) => m.key === activeGroup.value))

/** 分组是否收起（默认展开；用户手动折叠后保持）。 */
const extCollapsed = ref(false)

/** 实际渲染的扩展子项（收起时为空）。 */
const visibleExtItems = computed(() => (extCollapsed.value ? [] : extItems.value))

function go(g: string): void {
    void router.push(`/settings/${g}`)
}

/** 点「扩展」一级项：不导航（它没有自己的页面），只折叠 / 展开子项。 */
function toggleExt(): void {
    extCollapsed.value = !extCollapsed.value
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
                <template v-for="m in menus" :key="m.key">
                    <button
                        type="button"
                        class="nav__item"
                        :class="{ on: activeGroup === m.key }"
                        @click="go(m.key)"
                    >
                        <el-icon :size="18"><component :is="m.icon" /></el-icon>
                        <span class="nav__label">{{ $t('sv.nav.' + m.key) }}</span>
                    </button>
                    <!-- 「扩展」一级项紧随「DeepSeek」之后：它承载的也是「可配置的东西」，
                         而不是外观 / 环境 / 日志这类工具性面板。 -->
                    <template v-if="m.key === 'dsh'">
                        <button
                            type="button"
                            class="nav__item nav__item--root"
                            :class="{ on: extRootOn }"
                            @click="toggleExt"
                        >
                            <el-icon :size="18"><BuildFilled /></el-icon>
                            <span class="nav__label">{{ $t('sv.nav.extensions') }}</span>
                            <el-icon :size="12" class="nav__caret" :class="{ 'is-collapsed': extCollapsed }"><CaretDownFilled /></el-icon>
                        </button>
                        <!-- 各扩展贡献的二级面板：折叠在「扩展」之下，缩进一级。 -->
                        <button
                            v-for="m2 in visibleExtItems"
                            :key="'ext-' + m2.extId + '-' + m2.key"
                            type="button"
                            class="nav__item nav__item--sub"
                            :class="{ on: activeGroup === m2.key }"
                            @click="go(m2.key)"
                        >
                            <el-icon :size="16"><component :is="EXT_ICON" /></el-icon>
                            <span class="nav__label" :title="m2.extName">{{ $t(m2.titleKey) }}</span>
                        </button>
                    </template>
                </template>
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
    它要同时作用于经 <router-view> 嵌套渲染的子面板（General / Appearance / Env / DeepSeek / Log /
    Hotkeys / About）以及扩展贡献的面板，留在本组件里既撑大文件、又让这层依赖不可见。
-->
