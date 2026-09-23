import { createI18n } from 'vue-i18n'
import zh from '@shared/locales/zh'
import en from '@shared/locales/en'
import { catalogForLocale, styleLocaleOf } from '@shared/locales/ext'
import type { ResolvedLocale } from '@shared/types'
import type { ExtStyle } from '@shared/locales/ext'

export type { ResolvedLocale }

/**
 * renderer 的 vue-i18n 单例（组合式 API，legacy:false）。
 * 文案与 main 共用同一份 shared/locales 目录。
 * 界面语言由 dsh 的 locale 配置决定，语言码统一为 zh / en。
 */
export const i18n = createI18n({
    legacy: false,
    globalInjection: true,
    locale: 'zh',
    fallbackLocale: 'zh',
    missingWarn: false,
    fallbackWarn: false,
    messages: {
        zh,
        en
    }
})

/**
 * 把 catalogForLocale 产出的普通对象喂给 vue-i18n。
 * `setLocaleMessage` 是带约束的泛型重载，直接传 `Record<string, unknown>` 会被拒；
 * 这里收口成一个具体签名，既不用 `as any`，调用点也不必各自转型。
 */
const setLocaleMessages = i18n.global.setLocaleMessage as unknown as (
    locale: string,
    message: Record<string, unknown>
) => void

/** 把 vue-i18n 切到某语言（不写盘；持久化走 setUiLocale）。 */
export function setLocale(locale: ResolvedLocale): void {
    i18n.global.locale.value = locale
}

/** 当前界面语言（与 setLocale 对称；供外部读取，避免直接访问 i18n.global）。 */
export function currentLocale(): ResolvedLocale {
    return i18n.global.locale.value as ResolvedLocale
}

/**
 * 在**非组件**环境取翻译（模块级代码 / 组合式函数里没有 useI18n 上下文）。
 * 之前 update.ts、useSettingsStore.ts、AppearancePanel.vue 各自重复定义了一份，现统一于此。
 */
export function tt(key: string, named?: Record<string, unknown>): string {
    return named ? i18n.global.t(key, named) : i18n.global.t(key)
}

// ---------------------------------------------------------------------------
// 扩展翻译：变体目录由 shared/locales/ext.ts 汇总（各变体文本在 zh/、en/ 下的同名文件中），
// 这里只负责把构建结果覆盖到 vue-i18n 对应语言并触发刷新。不改 dsh 设置。
// ---------------------------------------------------------------------------

export type { ExtStyle }

function pingRefresh(): void {
    const cur = i18n.global.locale.value
    if (cur === 'zh' || cur === 'en') {
        i18n.global.locale.value = '__ext_ping__' as never
        i18n.global.locale.value = cur
    }
}

/** 把「扩展翻译」应用到对应语言的文案目录（off 还原 zh 与 en 两套）。 */
export function applyExtTranslation(style: ExtStyle): void {
    if (style === 'off') {
        setLocaleMessages('zh', catalogForLocale('zh', 'off'))
        setLocaleMessages('en', catalogForLocale('en', 'off'))
        pingRefresh()
        return
    }
    const loc = styleLocaleOf(style)
    setLocaleMessages(loc, catalogForLocale(loc, style))
    if (i18n.global.locale.value === loc) pingRefresh()
}

/**
 * 切换界面语言并重建两套文案目录。
 *
 * 扩展风格只对它所属的语言有意义（anime/wenyan/hant→zh、pirate/shakespeare→en），
 * 因此先把两套复位到基座再按需套用，避免上一次的覆盖残留在另一种语言上。
 */
export function applyLocaleChange(locale: ResolvedLocale, style: ExtStyle): void {
    applyExtTranslation('off')
    setLocale(locale)
    if (style !== 'off' && styleLocaleOf(style) === locale) applyExtTranslation(style)
}
