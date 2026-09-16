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
import { loadShellMeta } from './shell/shellmeta'
import { setupAntdv } from './lib/antdv'
import type { ResolvedLocale } from '@shared/types'

/**
 * 启动：读取本窗口元信息(是否核心窗口)与界面语言（dsh settings.yaml 的 locale.preference），
 * 据此挂载 vue-i18n、Element Plus 与 antdv-next。
 */
async function bootstrap(): Promise<void> {
    await loadShellMeta()
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
