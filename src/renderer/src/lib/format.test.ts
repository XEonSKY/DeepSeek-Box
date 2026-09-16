import { describe, expect, it } from 'vitest'
import { formatBytes, formatDownload, formatSpeed } from './format'

/**
 * 下载进度的显示格式。换到 pretty-bytes 之后这里守着两件事：
 * 单位的进位边界，以及「总大小未知时不要显示 0 / 0」。
 */

describe('formatBytes', () => {
    it('1KB 以下按整数字节显示', () => {
        expect(formatBytes(0)).toBe('0 B')
        expect(formatBytes(1)).toBe('1 B')
        expect(formatBytes(999)).toBe('999 B')
    })

    it('进位阈值是 1000 而不是 1024（pretty-bytes 的既定行为）', () => {
        // 这是换库带来的**行为差异**：原手写实现按 1024 进位。
        // 对「下载了多大」这种展示而言十进制更符合直觉，故接受该差异并在此固化。
        expect(formatBytes(1000)).toBe('1 kB')
        expect(formatBytes(1024)).toBe('1 kB') // 1.024 kB → 一位小数
        expect(formatBytes(1500)).toBe('1.5 kB')
    })

    it('整数单位不带小数、其余保留最多一位', () => {
        expect(formatBytes(1536)).toBe('1.5 kB')
        expect(formatBytes(1000 * 1000)).toBe('1 MB')
    })

    it('非法输入回落到 0 B（进度事件偶尔会给出 NaN）', () => {
        expect(formatBytes(NaN)).toBe('0 B')
        expect(formatBytes(-1)).toBe('0 B')
        expect(formatBytes(Infinity)).toBe('0 B')
    })
})

describe('formatSpeed', () => {
    it('速度为零或未测出时显示占位符', () => {
        expect(formatSpeed(0)).toBe('—')
        expect(formatSpeed(NaN)).toBe('—')
    })

    it('正常速度带 /s 后缀', () => {
        expect(formatSpeed(2048)).toBe('2 kB/s')
    })
})

describe('formatDownload', () => {
    it('总大小已知时显示 已下载 / 总大小 · 速度', () => {
        expect(formatDownload(2048, 1024, 512)).toBe('1 kB / 2 kB · 512 B/s')
    })

    it('总大小未知时只显示速度 —— 不能出现 "1 kB / 0 B"', () => {
        expect(formatDownload(0, 1024, 512)).toBe('512 B/s')
        expect(formatDownload(NaN, 1024, 512)).toBe('512 B/s')
    })
})
