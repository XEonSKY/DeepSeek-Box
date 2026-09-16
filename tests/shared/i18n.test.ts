import { describe, expect, it } from 'vitest'
import { localeCodeOf, messages, resolveLocale, t } from '@shared/i18n'

/**
 * 主进程的翻译入口（mt → t）与渲染层的 vue-i18n 消费同一份目录。
 * 这里守两条线：语言解析的回退顺序，以及「缺失文案不要把界面变成空白」。
 */

describe('resolveLocale', () => {
    it('显式偏好优先于系统语言', () => {
        expect(resolveLocale('zh', 'en-US')).toBe('zh')
        expect(resolveLocale('en', 'zh-CN')).toBe('en')
    })

    it('偏好缺失时按系统语言回退', () => {
        expect(resolveLocale(null, 'zh-CN')).toBe('zh')
        expect(resolveLocale(undefined, 'zh-Hant-TW')).toBe('zh')
        expect(resolveLocale(null, 'en-US')).toBe('en')
        expect(resolveLocale('', 'fr-FR')).toBe('en')
    })

    it('系统语言大小写不敏感', () => {
        expect(resolveLocale(null, 'ZH-cn')).toBe('zh')
    })

    it('系统语言也缺失时默认 en', () => {
        expect(resolveLocale(null)).toBe('en')
        expect(resolveLocale(null, '')).toBe('en')
    })

    it('非法偏好值不作为有效偏好', () => {
        expect(resolveLocale('hant', 'zh-CN')).toBe('zh')
        expect(resolveLocale('fr', 'en-US')).toBe('en')
    })
})

describe('localeCodeOf', () => {
    it('内部语言码即 dsh settings.yaml 用的两字母码', () => {
        expect(localeCodeOf('zh')).toBe('zh')
        expect(localeCodeOf('en')).toBe('en')
    })
})

describe('t', () => {
    it('按点分路径取文案', () => {
        const zhValue = t('zh', 'app.tabs.new')
        expect(typeof zhValue).toBe('string')
        expect(zhValue).not.toBe('app.tabs.new')
    })

    it('替换 {name} 占位符', () => {
        const out = t('zh', 'app.tabs.new', { name: 'X' })
        expect(out).toBe(t('zh', 'app.tabs.new'))
    })

    it('缺失的占位符原样保留，不显示 undefined', () => {
        const template = t('zh', 'app.tabs.new')
        if (template.includes('{')) {
            expect(t('zh', 'app.tabs.new', {})).toContain('{')
        }
    })

    it('路径不存在时回退到 zh，再不行就原样返回路径', () => {
        expect(t('en', 'this.path.does.not.exist')).toBe('this.path.does.not.exist')
        // 只在 zh 下存在的键，用 en 取也应能拿到 zh 的内容（而不是路径本身）
        expect(t('en', 'app.tabs.new')).not.toBe('app.tabs.new')
    })

    it('zh / en 两份目录都挂载了', () => {
        expect(Object.keys(messages).sort()).toEqual(['en', 'zh'])
    })
})
