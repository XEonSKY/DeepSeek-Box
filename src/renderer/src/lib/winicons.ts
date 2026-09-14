/**
 * Windows 窗口控制字形（最小化 / 最大化 / 还原 / 关闭）。
 *
 * Windows 自己就是用图标字体画这三个按钮的，字形落在私用区（`Chrome*` 系列）：
 *   `E921` 最小化 · `E922` 最大化 · `E923` 还原 · `E8BB` 关闭
 * 字体按世代回退：**Segoe Fluent Icons**（Win11）→ **Segoe MDL2 Assets**（Win10）→ **Segoe UI Symbol**。
 *
 * ⚠️ 为什么不能只写一条 CSS `font-family` 就完事：字体回退是**逐字形**的，而 Segoe UI Symbol
 * 里根本没有这几个私用区码位。若前面两个字体都不在（非 Windows、或被精简掉的系统），
 * 这一串会渲染成空白或豆腐块——比原来的 SVG 图标更糟。所以这里先**探测字形是否真的能渲染出来**，
 * 探不到就让调用方继续用 antdv 的矢量图标，而不是把按钮交给运气。
 */

/** 窗口控制字形码位（Segoe Fluent Icons / Segoe MDL2 Assets 通用）。 */
export const WIN_GLYPH = {
    minimize: '\uE921',
    maximize: '\uE922',
    restore: '\uE923',
    close: '\uE8BB'
} as const

/**
 * 字体栈（按世代回退）。导出给 TitleBar 以**内联样式**注入，保证样式与探测用的是同一份常量。
 * 末尾的 `sans-serif` 是真正的兜底（它和 Segoe UI Symbol 都缺这些码位，渲染出来是豆腐块）。
 */
export const WIN_GLYPH_STACK = "'Segoe Fluent Icons', 'Segoe MDL2 Assets', 'Segoe UI Symbol', sans-serif"

/** 探测用的字号（px）：够大才能让笔画差异稳定落在像素上。 */
const PROBE_FONT_PX = 48
/** 探针画布边长：字形是 1em 见方，留一倍余量。 */
const PROBE_CANVAS_PX = PROBE_FONT_PX * 2
/** 四个字形，逐字探测（顺序无关，只用于遍历）。 */
const PROBE_GLYPHS = [WIN_GLYPH.minimize, WIN_GLYPH.maximize, WIN_GLYPH.restore, WIN_GLYPH.close]
/** 墨迹判定阈值（alpha）：抗锯齿的浅边不算墨。 */
const INK_ALPHA = 40

/**
 * 用指定字体族画**单个**字形，返回「有墨 / 无墨」位图（每像素 1 bit）。
 * 取不到 2D 上下文或读不了像素时返回 null（画布被污染、极端环境）。
 */
function inkBitmap(family: string, cp: string): string | null {
    try {
        const canvas = document.createElement('canvas')
        canvas.width = PROBE_CANVAS_PX
        canvas.height = PROBE_CANVAS_PX
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.font = `${PROBE_FONT_PX}px ${family}`
        ctx.fillStyle = '#000'
        ctx.fillText(cp, 0, PROBE_FONT_PX)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let bits = ''
        for (let i = 3; i < data.length; i += 4) bits += data[i] > INK_ALPHA ? '1' : '0'
        return bits
    } catch {
    /* 没有 canvas / 读不了像素：交给调用方按不可用处理 */
        return null
    }
}

/**
 * 判断字体栈是否真的提供了这几个字形。
 *
 * ⚠️ **不能用「宽度比对」**——本文件第一版就是那么写的，结果**永远返回 false，图标一直没生效**。
 * 原因：Segoe 图标字形的宽度正好是 1em 见方，而兜底字体的 `.notdef` 前进宽度也是 1em，
 * 于是「字体栈」和「基准字体」量出来的宽度完全一样（实测都是 128）。更离谱的是 `monospace`：
 * 这四个码位**一个像素都不画**，前进宽度却仍是 1em。
 *
 * ⚠️ 也**不能用「与一个不存在的字体族比位图」**：实测 Segoe UI Symbol 缺这些码位时渲染出的
 * 豆腐块与 sans-serif 的豆腐块**并不相同**（25 列 vs 40 列），于是那一版会把 Symbol 误判为可用。
 *
 * 最终判据利用豆腐块的本质特征：**任何一个码位拿不到真字形时，都会退化成同一个 `.notdef`**。
 * 所以逐字渲染四个字形，只要满足两条就认为字体栈可用：
 *  1. 四个字形**都**有墨迹（挡掉 `monospace` 那种整串画不出来的情形）；
 *  2. 四个位图**并非完全相同**（真字形各不相同；豆腐块则四张图一模一样）。
 */
function stackRendersGlyphs(): boolean {
    const marks: string[] = []
    for (const cp of PROBE_GLYPHS) {
        const m = inkBitmap(WIN_GLYPH_STACK, cp)
        if (m === null) return false
        if (!m.includes('1')) return false
        marks.push(m)
    }
    return new Set(marks).size > 1
}

/** 探测结果的缓存：字体可用性在进程生命周期内不会变，量一次就够。 */
let cached: boolean | null = null

/**
 * 当前环境能否使用 Segoe 窗口控制字形。
 * 仅在 **Windows** 且字体栈确实提供了字形时返回 true；否则调用方应回退到矢量图标。
 */
export function winGlyphsAvailable(platform: string = window.api.platform): boolean {
    if (platform !== 'win32') return false
    if (cached === null) cached = stackRendersGlyphs()
    return cached
}
