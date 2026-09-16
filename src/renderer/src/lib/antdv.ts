import { h } from 'vue'
import { App as AntdvApp, ConfigProvider } from 'antdv-next'
import zhCN from 'antdv-next/locale/zh_CN'
import enUS from 'antdv-next/locale/en_US'
import type { App as VueApp, Component } from 'vue'
import type { ResolvedLocale } from '@shared/types'

/**
 * antdv-next 的运行时基座。
 *
 * - 组件与样式由 `unplugin-vue-components` 的 `AntdvNextResolver` 按需注入，
 *   因此这里不做 `app.use(Antdv)` 式的全量注册。
 * - `AntdvRoot` 用 `ConfigProvider` 包住 antdv 的 `App`：antdv 的 `message` /
 *   `Modal` / `notification` 需要 `App` 上下文才能拿到主题与语言，
 *   迁移命令式提示时统一经由这些 API。
 *
 * 迁移期与 Element Plus 共存，两者互不注册对方的组件。
 */

/** 把界面语言映射成 antdv 的 locale 包（其余语言回落到英文）。 */
export function antdvLocale(locale: ResolvedLocale) {
    return locale === 'zh' ? zhCN : enUS
}

/** 根容器：`ConfigProvider` → antdv `App`，为浮层与命令式 API 提供上下文。 */
export const AntdvRoot: Component = {
    name: 'AntdvRoot',
    props: { locale: { type: String, required: true } },
    setup(props, { slots }) {
        return () =>
            h(
                ConfigProvider,
                { locale: antdvLocale(props.locale as ResolvedLocale) },
                { default: () => h(AntdvApp, null, { default: () => slots.default?.() }) }
            )
    }
}

/** 安装 antdv-next 全局运行时配置；组件本身由构建期按需引入，无需在此注册。 */
export function setupAntdv(app: VueApp, locale: ResolvedLocale): void {
    app.provide('antdv-locale', locale)
}
