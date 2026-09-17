import { describe, expect, it } from 'vitest'
import { splitTag } from '@/lib/tagLabel'

describe('splitTag', () => {
    it('拆出结尾的全角括号限定语', () => {
        expect(splitTag('启动增强（开机自启）')).toEqual({ text: '启动增强', tag: '开机自启' })
    })

    it('拆出结尾的半角括号限定语', () => {
        expect(splitTag('Startup boost (launch at login)')).toEqual({ text: 'Startup boost', tag: 'launch at login' })
    })

    it('多个括号时只拆最后一处', () => {
        expect(splitTag('版本回退（A/B）（旧）')).toEqual({ text: '版本回退（A/B）', tag: '旧' })
    })

    it('没有括号时原样返回', () => {
        expect(splitTag('性能')).toEqual({ text: '性能', tag: null })
    })

    it('只有括号、没有主文案时不拆', () => {
        expect(splitTag('（当前）')).toEqual({ text: '（当前）', tag: null })
    })

    it('括号为空时不拆', () => {
        expect(splitTag('可选（）')).toEqual({ text: '可选（）', tag: null })
    })

    it('句中括号不是结尾时不拆', () => {
        expect(splitTag('内置（推荐）与其它')).toEqual({ text: '内置（推荐）与其它', tag: null })
    })

    it('去掉首尾空白', () => {
        expect(splitTag('  自动（推荐）  ')).toEqual({ text: '自动', tag: '推荐' })
    })
})
