import type { RegistrySpeedResult, RegistrySpeedSample } from '@shared/types'
import { httpFetch } from './http'
import { REGISTRY_IDS, pickFastestRegistry, rankRegistries, registryBase } from './registry'

/**
 * npm registry 测速：给向导的「简易安装」挑一个最快的源。
 *
 * 为什么值得测：Node / npm / dsh 的下载都走同一个源，源选错会让整个安装慢一个数量级；
 * 而「哪个源快」随网络环境变化（境内通常 npmmirror 快，境外反之），写死默认值必然对一半人不利。
 *
 * 探测目标是 **@deepseek-ai/dsh 的 abbreviated packument**（`Accept: application/vnd.npm.install-v1+json`）——
 * 正是 npm 自己解析版本列表时请求的那个文档：比完整 packument 小得多，
 * 又比 ping 类端点更能反映「接下来真要去拉这个包的源」到底有多快。
 */

/** 探测的包（与真正要装的包一致，URL 编码后的 scope 斜杠）。 */
const PROBE_PATH = '/@deepseek-ai%2Fdsh'

/** 单次探测的超时。竞速场景宁可判失败也不能一直挂着：慢到这一步的源本来就不该被选中。 */
const PROBE_TIMEOUT_MS = 8000

/** 单个 registry 的测速：返回往返毫秒数，失败 / 超时返回 null。 */
async function timeRegistry(registry: RegistrySpeedSample['registry']): Promise<RegistrySpeedSample> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const started = Date.now()
    try {
        const res = await httpFetch('registry', registryBase(registry) + PROBE_PATH, {
            signal: ctrl.signal,
            headers: { accept: 'application/vnd.npm.install-v1+json' }
        })
        // 必须把 body 读完：只测到响应头的话，测的是首字节延迟而不是真正拿到版本列表的时间。
        await res.arrayBuffer()
        if (!res.ok) return { registry, ms: null }
        return { registry, ms: Date.now() - started }
    } catch {
        // 网络错误 / 超时 / 被 abort 一律按「不可用」处理，由挑选规则把它排到最后。
        return { registry, ms: null }
    } finally {
        clearTimeout(timer)
    }
}

/** 并发探测全部候选源，返回排序后的结果与最快项。 */
export async function measureRegistrySpeed(): Promise<RegistrySpeedResult> {
    const samples = await Promise.all(REGISTRY_IDS.map((r) => timeRegistry(r)))
    return { samples: rankRegistries(samples), fastest: pickFastestRegistry(samples) }
}
