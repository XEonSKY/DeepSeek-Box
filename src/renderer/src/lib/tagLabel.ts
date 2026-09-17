/**
 * 设置页短标签的「括号 → 标签」拆分（纯函数）。
 *
 * 设置页里大量短标签用括号补限定语，例如「启动增强（开机自启）」「插件（profile 组合包）」
 * 「版本回退（A/B）」「自动（推荐）」；zh 用全角「（）」、en 用半角「()」。约定这类限定语
 * 不再以括号形式写进界面，而是由 TagLabel 渲染成「主文案 + a-tag」。
 *
 * 只识别**结尾**的括号：说明性句子里的括号（hint / desc）与拼接后缀（如 currentSuffix
 * 的「（当前）」）保持原文不拆。括号内容含嵌套括号时也不拆，宁可原样展示。
 */

/** 拆分结果：tag 为 null 表示不是「短标签（限定语）」形态，调用方应原样输出 text。 */
export interface SplitTagResult {
    text: string
    tag: string | null
}

/**
 * 把「主文案（限定语）」拆成主文案与标签文案。
 *
 * @param label 已翻译好的短标签文案。
 * @returns 主文案与去括号的限定语；无法拆分时 tag 为 null、text 为原串（去首尾空白）。
 */
export function splitTag(label: string): SplitTagResult {
    const raw = label ?? ''
    // 结尾括号：主体任意（含空格），括号内不含任何括号字符，末尾允许空白。
    const m = /^([\s\S]*?)\s*[（(]([^（）()]+)[）)]\s*$/.exec(raw)
    if (!m) return { text: raw.trim(), tag: null }
    const text = m[1].trim()
    const tag = m[2].trim()
    if (!text || !tag) return { text: raw.trim(), tag: null }
    return { text, tag }
}
