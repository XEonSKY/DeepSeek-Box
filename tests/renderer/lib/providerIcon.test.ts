import { describe, expect, it } from 'vitest'
import { DeepSeekFilled, OpenAIFilled, QwenFilled, WalletOutlined } from '@antdv-next/icons'
import { providerIcon } from '@/lib/providerIcon'

/**
 * 状态栏的余额图标按供应商品牌切换。
 * 认错品牌的代价比没有图标更大 —— 把 OpenAI 的图标挂在中转服务上，
 * 用户会以为自己在直连那家。所以这里重点守「认不出要返回 null」而不是「尽量认出来」。
 */

describe('providerIcon', () => {
    it('按供应商路由名认出对应品牌', () => {
        expect(providerIcon('deepseek')).toBe(DeepSeekFilled)
        expect(providerIcon('openai')).toBe(OpenAIFilled)
        expect(providerIcon('qwen')).toBe(QwenFilled)
    })

    it('deepseek-official 这类带后缀的路由名也能认出', () => {
        expect(providerIcon('deepseek-official')).toBe(DeepSeekFilled)
        expect(providerIcon('my-deepseek-proxy')).toBe(DeepSeekFilled)
    })

    it('大小写不敏感', () => {
        expect(providerIcon('DeepSeek')).toBe(DeepSeekFilled)
        expect(providerIcon('OpenAI')).toBe(OpenAIFilled)
    })

    it('路由名认不出时，退回用展示名再试一次', () => {
        // 路由键是程序生成的随机 id，展示名才是「我的 DeepSeek」这类人类可读值
        expect(providerIcon('token-abc123', '我的 DeepSeek')).toBe(DeepSeekFilled)
    })

    it('路由名能认出时优先于展示名', () => {
        // 展示名里写了别的牌子也不能覆盖路由键的判断
        expect(providerIcon('openai', 'DeepSeek')).toBe(OpenAIFilled)
    })

    it('认不出返回 null（由调用方回落通用图标，而不是随便顶一个牌子）', () => {
        expect(providerIcon('some-relay', '某中转')).toBe(null)
        expect(providerIcon('')).toBe(null)
    })

    it('空值 / 缺省值不会抛错', () => {
        expect(providerIcon(null)).toBe(null)
        expect(providerIcon(undefined)).toBe(null)
        expect(providerIcon(null, null)).toBe(null)
        expect(providerIcon(undefined, undefined)).toBe(null)
    })

    it('返回值是可渲染的组件，不是未定义', () => {
        const icon = providerIcon('anthropic')
        expect(icon).toBeDefined()
        expect(icon).not.toBe(null)
    })

    it('回落用的通用图标本身不该被映射表返回', () => {
        // WalletOutlined 是「认不出」时的兜底，任何已知品牌都不应该映射到它
        expect(providerIcon('deepseek')).not.toBe(WalletOutlined)
        expect(providerIcon('openai')).not.toBe(WalletOutlined)
    })
})
