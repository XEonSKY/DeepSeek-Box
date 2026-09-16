import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

/**
 * 收敛前这段判断在 15 个文件里各写一遍，最容易出错的正是**非 Error** 分支：
 * IPC 传来的字符串、插件抛出的普通对象，处理不当会让界面显示 [object Object]。
 */

describe('errorMessage', () => {
    it('Error 取 message', () => {
        expect(errorMessage(new Error('boom'))).toBe('boom')
    })

    it('Error 子类同样取 message', () => {
        class CustomError extends Error {}
        expect(errorMessage(new CustomError('custom'))).toBe('custom')
    })

    it('message 为空串时返回空串（不回落成 String(err)）', () => {
        expect(errorMessage(new Error(''))).toBe('')
    })

    it('字符串原样返回，不会被加上引号', () => {
        expect(errorMessage('操作已取消')).toBe('操作已取消')
    })

    it('非 Error 对象转成字符串（原来的 String(err) 分支）', () => {
        expect(errorMessage({ code: 1 })).toBe('[object Object]')
    })

    it('数字 / 布尔 / 大整数都能转', () => {
        expect(errorMessage(404)).toBe('404')
        expect(errorMessage(false)).toBe('false')
        expect(errorMessage(10n)).toBe('10')
    })

    it('null / undefined 返回空串，而不是 "null" / "undefined"', () => {
        expect(errorMessage(null)).toBe('')
        expect(errorMessage(undefined)).toBe('')
    })
})
