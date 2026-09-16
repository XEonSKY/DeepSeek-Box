import { describe, expect, it } from 'vitest'
import { MIN_NODE_MAJOR, isPrerelease, nodeMajor, stripV, withV } from './version'

/**
 * shared/version.ts 是 main 与 renderer **两端共用**的版本判定，
 * 两端结论不一致会导致「界面说不是预发布、主进程却按预发布处理」这类隐蔽 bug。
 */

describe('stripV', () => {
    it('去掉前导 v / V', () => {
        expect(stripV('v22.14.0')).toBe('22.14.0')
        expect(stripV('V1.2.3')).toBe('1.2.3')
        expect(stripV('22.14.0')).toBe('22.14.0')
    })

    it('只去掉一个前导字母，不动中间出现的 v', () => {
        expect(stripV('vv1.0.0')).toBe('v1.0.0')
        expect(stripV('1.0.0-dev')).toBe('1.0.0-dev')
    })
})

describe('isPrerelease', () => {
    it('带预发布段即为预发布', () => {
        expect(isPrerelease('1.0.0-beta.1')).toBe(true)
        expect(isPrerelease('v0.0.0-alpha.0')).toBe(true)
        expect(isPrerelease('2.0.0-rc.1')).toBe(true)
    })

    it('正式版不是预发布', () => {
        expect(isPrerelease('1.0.0')).toBe(false)
        expect(isPrerelease('v22.14.0')).toBe(false)
    })

    it('前缀 v 不影响判定（这正是当初两端结论分歧的根源）', () => {
        expect(isPrerelease('v1.0.0-beta.1')).toBe(isPrerelease('1.0.0-beta.1'))
    })

    it('不合法的版本号不当作预发布', () => {
        expect(isPrerelease('')).toBe(false)
        expect(isPrerelease('latest')).toBe(false)
        expect(isPrerelease('1.0')).toBe(false)
    })
})

describe('withV', () => {
    it('缺 v 时补上，已有则原样返回', () => {
        expect(withV('22.14.0')).toBe('v22.14.0')
        expect(withV('v22.14.0')).toBe('v22.14.0')
        expect(withV('V22.14.0')).toBe('V22.14.0')
    })

    it('空值返回占位符（默认破折号）', () => {
        expect(withV(null)).toBe('—')
        expect(withV(undefined)).toBe('—')
        expect(withV('')).toBe('—')
        expect(withV(null, '…')).toBe('…')
    })
})

describe('nodeMajor', () => {
    it('取主版本号，带不带 v 都行', () => {
        expect(nodeMajor('v22.14.0')).toBe(22)
        expect(nodeMajor('22.14.0')).toBe(22)
        expect(nodeMajor('20')).toBe(20)
    })

    it('两侧空白不影响', () => {
        expect(nodeMajor('  v18.19.0  ')).toBe(18)
    })

    it('解析不出返回 null', () => {
        expect(nodeMajor(null)).toBe(null)
        expect(nodeMajor(undefined)).toBe(null)
        expect(nodeMajor('')).toBe(null)
        expect(nodeMajor('node')).toBe(null)
    })
})

describe('MIN_NODE_MAJOR', () => {
    it('低于该主版本的 Node 会被环境页判定为「装了也跑不起 dsh」', () => {
        expect(nodeMajor('v18.20.0')).toBeLessThan(MIN_NODE_MAJOR)
        expect(nodeMajor('v20.0.0')).toBe(MIN_NODE_MAJOR)
    })
})
