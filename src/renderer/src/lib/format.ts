import prettyBytes from 'pretty-bytes'

/**
 * 下载进度显示用的格式化：字节大小与下载速度。
 */

/**
 * 字节数 → 人类可读大小（B / KB / MB / GB / TB …）。
 *
 * 换成 pretty-bytes（Vite 会把它打进渲染层产物）：原手写实现只覆盖到 TB，
 * 且进位口径是自定的；库额外处理了各单位边界（例如 1023.95 KB 不会显示成「1024 KB」）
 * 与更大单位。maximumFractionDigits 与原观感对齐：B 不带小数，其余一位。
 */
export function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '0 B'
    return prettyBytes(n, { maximumFractionDigits: n < 1024 ? 0 : 1 })
}

/** 下载速度：bytes/s → 人类可读 + /s；尚未测出时显示占位符。 */
export function formatSpeed(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '—'
    return formatBytes(n) + '/s'
}

/** 进度文案：已下载 / 总大小 · 速度（总大小未知时只显示速度）。 */
export function formatDownload(total: number, downloaded: number, speed: number): string {
    if (!Number.isFinite(total) || total <= 0) return formatSpeed(speed)
    return formatBytes(downloaded) + ' / ' + formatBytes(total) + ' · ' + formatSpeed(speed)
}
