import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import 'element-plus/dist/index.css'
// Element Plus dark theme CSS variables (toggled via the `dark` class on <html>)
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
// 全局样式表（分层）：base=reset + Element Plus 变量基线 → shared=跨组件通用工具 → settings=设置页共享
import './styles/base.css'
import './styles/shared.css'
import './styles/settings.css'
import { i18n } from './lib/locales'
import { router } from './shell/router'
import { loadShellMeta } from './shell/state'
import { startOperationTracking } from './shell/progressStore'
import { startRendererExtensions } from './extensions'
import { setupAntdv } from './lib/antdv'
import { logger } from './lib/logger'
import type { ResolvedLocale } from '@shared/types'

const log = logger('[shell]')

/**
 * 兜住渲染层未捕获的错误 / 未处理的 Promise 拒绝。
 *
 * 之前这两类异常**完全静默**：用户看到界面卡住或某个操作没反应，而进程里不留任何痕迹，
 * 事后无从查起。挂上处理器后，它们会经 logger 进控制台并转交主进程落盘。
 *
 * 放在模块顶层（而非 bootstrap 内）：bootstrap 自己抛错时也要能被兜住。
 */
function installGlobalErrorHandlers(): void {
    window.addEventListener('error', (e) => {
        log.error({ err: e.error ?? e.message, source: e.filename, line: e.lineno, col: e.colno }, 'uncaught error')
    })
    window.addEventListener('unhandledrejection', (e) => {
        log.error({ err: e.reason }, 'unhandled rejection')
    })
}

installGlobalErrorHandlers()

/** 该窗口是否是「独立确认子窗口」（同一个 index.html，用 query 区分入口）。 */
function isConfirmWindow(): boolean {
    return new URLSearchParams(window.location.search).get('dialog') === 'confirm'
}

/**
 * 独立确认子窗口的启动：只挂一个轻量界面，不加载外壳（标签页 / webview / 状态栏 / Pinia 业务 store）。
 * 外观与交互见 views/ConfirmWindow.vue。
 */
async function bootstrapConfirmWindow(): Promise<void> {
    let resolved: ResolvedLocale = 'zh'
    try {
        resolved = await window.api.get('/locale')
    } catch {
        /* window.api 可能在异常环境不可用，按 zh 处理 */
    }
    i18n.global.locale.value = resolved
    // 按需加载：外壳启动路径不必带上确认窗的代码
    const { default: ConfirmWindow } = await import('./views/ConfirmWindow.vue')
    const app = createApp(ConfirmWindow)
    app.use(createPinia())
    setupAntdv(app, resolved)
    app.use(i18n)
    app.mount('#app')
}

/**
 * 启动：读取本窗口元信息(是否核心窗口)与界面语言（dsh 的 locale 配置），
 * 据此挂载 vue-i18n、Element Plus 与 antdv-next。
 */
async function bootstrap(): Promise<void> {
    // 确认子窗口走自己的入口，不碰外壳元信息与 Element Plus 全量注册。
    if (isConfirmWindow()) {
        await bootstrapConfirmWindow()
        return
    }
    await loadShellMeta()
    // 进度订阅放在外壳启动处（而不是各面板里）：面板卸载不能丢状态，切页回来才还能看到进度。
    startOperationTracking()
    // 扩展层：拉取一次扩展信息并订阅变化（不 await，扩展不该拖慢首屏）。
    startRendererExtensions()
    let resolved: ResolvedLocale = 'zh'
    try {
        resolved = await window.api.get('/locale')
    } catch {
    /* window.api 可能在异常环境不可用，按 zh 处理 */
    }
    i18n.global.locale.value = resolved

    const app = createApp(App)
    app.use(createPinia())
    // antdv-next：组件与样式由 unplugin-vue-components 按需注入，这里只装全局运行时配置
    setupAntdv(app, resolved)
    // Element Plus 仍在全量注册（迁移期共存），随组件逐个替换后移除
    app.use(ElementPlus, { locale: resolved === 'zh' ? zhCn : en })
    app.use(i18n)
    app.use(router)
    app.mount('#app')
}

void bootstrap()
