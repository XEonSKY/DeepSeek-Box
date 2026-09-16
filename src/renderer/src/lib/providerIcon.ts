import {
    AlibabaOutlined,
    AnthropicFilled,
    BaiduOutlined,
    ClaudeFilled,
    DeepSeekFilled,
    GeminiFilled,
    HuggingFaceFilled,
    MistralFilled,
    OllamaFilled,
    OpenAIFilled,
    PerplexityFilled,
    QwenFilled,
    XOutlined
} from '@antdv-next/icons'
import type { Component } from 'vue'

/**
 * 供应商 → 品牌图标。
 *
 * 图标全部取自 `@antdv-next/icons`（项目已确定优先用 antdv-next 生态，
 * 不额外引入图标库）。匹配不上时返回 `null`，由调用方回落到通用图标 ——
 * **不要随便挑一个相近的牌子顶上**：把 OpenAI 的图标挂在某个中转服务上，
 * 比没有图标更容易误导用户。
 *
 * 匹配是**按关键词包含**而不是全等：供应商 id 由用户的 settings.yaml 决定，
 * 常见形态有 `deepseek`、`deepseek-official`、`my-deepseek-proxy`、
 * `llm-pi-ai.providers.anthropic` 等，全等匹配会大面积漏掉。
 */

/** 关键词 → 图标。顺序即优先级：更具体的品牌名排在更泛的之前。 */
const PROVIDER_ICONS: ReadonlyArray<readonly [string, Component]> = [
    ['deepseek', DeepSeekFilled],
    ['openai', OpenAIFilled],
    ['azure', OpenAIFilled],
    ['anthropic', AnthropicFilled],
    ['claude', ClaudeFilled],
    ['gemini', GeminiFilled],
    ['google', GeminiFilled],
    ['qwen', QwenFilled],
    ['tongyi', QwenFilled],
    ['alibaba', AlibabaOutlined],
    ['bailian', AlibabaOutlined],
    ['mistral', MistralFilled],
    ['ollama', OllamaFilled],
    ['perplexity', PerplexityFilled],
    ['huggingface', HuggingFaceFilled],
    ['baidu', BaiduOutlined],
    ['wenxin', BaiduOutlined],
    ['grok', XOutlined],
    ['xai', XOutlined]
]

/**
 * 取供应商对应的品牌图标；认不出返回 null。
 *
 * `provider` 与 `providerName` 一起参与匹配：前者是 settings 里的路由键（更可靠），
 * 后者是展示名（用户可能自己起名如「我的 DeepSeek」）。两者都试，
 * 先命中者胜 —— 路由键排在前面，因为它是程序生成的、更不容易出错。
 */
export function providerIcon(provider: string | null | undefined, providerName?: string | null): Component | null {
    const haystacks = [provider, providerName]
    for (const raw of haystacks) {
        if (!raw) continue
        const key = raw.toLowerCase()
        for (const [keyword, icon] of PROVIDER_ICONS) {
            if (key.includes(keyword)) return icon
        }
    }
    return null
}
