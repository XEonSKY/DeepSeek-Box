<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CompassOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import { extApi, extErrorMessage, extT } from '../renderer-api'
import { SEARCH_ENGINE_IDS, ENGINE_LABEL_KEY } from './shared'
import type { SearchEngineId, Shortcut } from './shared'

/**
 * 「内嵌浏览器」设置面板 —— 内置扩展 `xeonsky.browser` 的渲染层实现。
 *
 * 与主进程入口（同目录 `main.ts`）、清单（同目录 `manifest.ts`）与语言文件
 * （同目录 `locales.ts`）放在一起，四者构成这个扩展的完整定义；
 * 挂载入口见 `renderer/src/extensions/panels.ts` 的 `LOCAL_VIEWS`。
 *
 * 对外依赖全部收在 `../renderer-api`（渲染层扩展 API 面），不 import 外壳内部模块 ——
 * 与主进程侧「扩展不直接 import 内核」是同一条原则。
 *
 * ## 迁自哪里
 *
 * 三节内容原先都在内核设置里：UserAgent 在「设置 → 系统与性能 → 浏览器标识」，
 * 默认搜索引擎与新标签页常用站点在「设置 → 通用 → 新建标签页」。随 webview 与新标签页
 * 功能迁到本扩展后，配置统一存在扩展数据目录（`ctx.dataDir/config.json`）——
 * 停用本扩展时这些设置随之消失，不在内核设置结构里留可选功能的字段。
 *
 * 数据流：进入面板拉一次 `config`（含当前配置、默认 UA、应用版本）；
 * 点「保存」调 `setConfig`，主进程落盘并立即把新 UA 应用到会话。
 */

/** 本扩展的通道前缀（与 manifest.id 一致）。 */
const CHANNEL = 'ext:xeonsky.browser'

/** 调一次本扩展的主进程动作。 */
function call<T>(action: string, payload?: unknown): Promise<T> {
    return extApi.ext.invoke(`${CHANNEL}:${action}`, payload) as Promise<T>
}

interface ConfigState {
    config: { userAgent: string; searchEngine: SearchEngineId; shortcuts: Shortcut[] }
    defaultUserAgent: string
    appVersion: string
}

const userAgent = ref('')
const searchEngine = ref<SearchEngineId>('bing')
const shortcuts = ref<Shortcut[]>([])
const defaultUa = ref('')
const appVersion = ref('')
const busy = ref(false)

/** 搜索引擎下拉项：项目约定 a-select 用 :options（见外壳 DshWizard.vue）。 */
const engineOptions = computed(() =>
    SEARCH_ENGINE_IDS.map((id) => ({ value: id, label: extT(ENGINE_LABEL_KEY[id]) }))
)

function applyState(s: ConfigState): void {
    userAgent.value = s.config.userAgent
    searchEngine.value = s.config.searchEngine
    shortcuts.value = s.config.shortcuts.map((sc) => ({ ...sc }))
    defaultUa.value = s.defaultUserAgent
    appVersion.value = s.appVersion
}

async function reload(): Promise<void> {
    try {
        applyState(await call<ConfigState>('config'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    }
}

onMounted(() => {
    void reload()
})

/** 清空 = 回到默认 UA（实际字符串由主进程按平台 / 版本生成）。 */
function resetUa(): void {
    userAgent.value = ''
}

function addShortcut(): void {
    shortcuts.value.push({ title: '', url: '' })
}
function removeShortcut(i: number): void {
    shortcuts.value.splice(i, 1)
}

async function save(): Promise<void> {
    busy.value = true
    try {
        const s = await call<ConfigState>('setConfig', {
            userAgent: userAgent.value,
            searchEngine: searchEngine.value,
            // 丢掉全空的占位行，否则会在新标签页渲染出无意义的空按钮
            shortcuts: shortcuts.value.filter((sc) => sc.title.trim() || sc.url.trim())
        })
        applyState(s)
        ElMessage.success(extT('ext.xeonskyBrowser.panel.saved'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        busy.value = false
    }
}
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><CompassOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ extT('ext.xeonskyBrowser.nav') }}</div>
                <div class="dsh-brand__desc">{{ extT('ext.xeonskyBrowser.intro') }}</div>
            </div>
        </div>

        <div class="sec">
            <div class="sec__title">{{ extT('ext.xeonskyBrowser.panel.engineTitle') }}</div>
            <a-select v-model:value="searchEngine" :options="engineOptions" style="width: 100%" />
            <div class="hint">{{ extT('ext.xeonskyBrowser.panel.engineHint') }}</div>
        </div>

        <div class="sec">
            <div class="sec__title">{{ extT('ext.xeonskyBrowser.panel.shortcutsTitle') }}</div>
            <div class="sh-list">
                <div v-for="(sc, i) in shortcuts" :key="i" class="sh-row">
                    <a-input v-model:value="sc.title" class="sh-in" :placeholder="extT('ext.xeonskyBrowser.panel.shortcutTitle')" />
                    <a-input v-model:value="sc.url" class="sh-in" :placeholder="extT('ext.xeonskyBrowser.panel.shortcutUrl')" />
                    <a-button :icon="DeleteOutlined" type="text" @click="removeShortcut(i)" />
                </div>
            </div>
            <a-button :icon="PlusOutlined" @click="addShortcut">{{ extT('ext.xeonskyBrowser.panel.shortcutAdd') }}</a-button>
            <div class="hint">{{ extT('ext.xeonskyBrowser.panel.shortcutHint') }}</div>
        </div>

        <div class="sec">
            <div class="sec__title">{{ extT('ext.xeonskyBrowser.panel.uaTitle') }}</div>
            <div class="ua">
                <div class="ua__t">{{ extT('ext.xeonskyBrowser.panel.ua') }}</div>
                <a-textarea
                    v-model:value="userAgent"
                    :rows="3"
                    :placeholder="defaultUa"
                    spellcheck="false"
                />
                <div class="ua-actions">
                    <a-button :icon="ReloadOutlined" :disabled="!userAgent" @click="resetUa">
                        {{ extT('ext.xeonskyBrowser.panel.uaReset') }}
                    </a-button>
                    <a-button type="primary" :icon="SaveOutlined" :loading="busy" @click="save">
                        {{ extT('ext.xeonskyBrowser.panel.save') }}
                    </a-button>
                </div>
                <div class="hint">{{ extT('ext.xeonskyBrowser.panel.uaHint') }}</div>

                <div class="ua-cur">
                    <div class="ua-cur__t">{{ extT('ext.xeonskyBrowser.panel.uaDefault') }}</div>
                    <code class="ua-cur__v">{{ defaultUa }}</code>
                    <template v-if="userAgent">
                        <div class="ua-cur__t ua-cur__t--top">{{ extT('ext.xeonskyBrowser.panel.uaCurrent') }}</div>
                        <code class="ua-cur__v">{{ userAgent }}</code>
                    </template>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 面板被复用为「一节一节」的卡片：节之间留出与外壳设置页一致的间距。 */
.sec {
    margin-top: 18px;
}
/* UA 串很长：允许折行、等宽字体，别撑破面板（样式随设置项从内核设置页迁入）。 */
.ua {
    margin-top: 2px;
}
.ua__t {
    margin-bottom: 6px;
    font-weight: 600;
}
.ua-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
}
.ua-cur {
    margin-top: 6px;
}
.ua-cur__t {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-bottom: 4px;
}
.ua-cur__t--top {
    margin-top: 12px;
}
.ua-cur__v {
    display: block;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--el-fill-color-light);
    font-family: var(--el-font-family-mono);
    font-size: 12px;
    line-height: 1.6;
    word-break: break-all;
    color: var(--el-text-color-regular);
}
/* 常用站点：每行「标题 + 网址 + 删除」，两个输入框等宽撑满。 */
.sh-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    margin-bottom: 8px;
}
.sh-row {
    display: flex;
    gap: 6px;
    width: 100%;
}
.sh-in {
    flex: 1 1 auto;
}
</style>

