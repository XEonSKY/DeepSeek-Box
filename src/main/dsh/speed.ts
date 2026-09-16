import type { RegistrySpeedResult, RegistrySpeedSample } from '@shared/types'
import { httpFetch } from './http'
import { REGISTRY_IDS, pickFastestRegistry, rankRegistries, registryBase, summarizeRounds } from './registry'

/**
 * npm registry 测速：给向导的「简易安装」挑一个最快的源。
 *
 * 为什么值得测：Node / npm / dsh 的下载都走同一个源，源选错会让整个安装慢一个数量级；
 * 而「哪个源快」随网络环境变化（境内通常 npmmirror 快，境外反之），写死默认值必然对一半人不利。
 *
 * 探测目标是 **@deepseek-ai/dsh 的 abbreviated packument**（`Accept: application/vnd.npm.install-v1+json`）——
 * 正是 npm 自己解析版本列表时请求的那个文档：比完整 packument 小得多，
 * 又比 ping 类端点更能反映「接下来真要去拉这个包的源」到底有多快。
 *
 * ## 为什么跑多轮
 *
 * 单次测量不足以分辨两个源：一次 HTTPS 往返里包含 DNS、TCP、TLS 握手，
 * 这些开销**每次请求都要重付**，方差很大 —— 一条到 npmjs 的请求偶然快过 npmmirror
 * 完全可能，而下一轮就反过来。跑多轮后取最小值（见 `bestOfRounds`），
 * 得到的更接近「该源稳定能给到的速度」，而不是一次抽样的运气。
 */

/** 探测的包（与真正要装的包一致，URL 编码后的 scope 斜杠）。 */
const PROBE_PATH = '/@deepseek-ai%2Fdsh'

/** 单次探测的超时。竞速场景宁可判失败也不能一直挂着：慢到这一步的源本来就不该被选中。 */
const PROBE_TIMEOUT_MS = 8000

/**
 * 轮数。3 轮是「够看出抖动」与「用户不必等太久」的折中：
 * 每轮最快也就几十毫秒，慢到超时的源在第 1 轮就已经拖到 8s，
 * 再多加轮数只会线性放大最坏情况的等待时间。
 */
export const SPEED_ROUNDS = 3

/**
 * 轮与轮之间让出的间隔（毫秒级抖动，不是给网络留时间）。
 *
 * ⚠️ 必须让出：若连续打同一台服务器，后一轮会命中连接复用与 DNS 缓存，
 * 测出来的就不再是「重新解析并连接要多久」。这里让出正好够连接池被回收的量级。
 */
const ROUND_GAP_MS = 60

/**
 * 单个 registry 的单轮测速：返回往返毫秒数，失败 / 超时返回 null。
 *
 * 每轮**各自**带超时，外部信号的取消也一并生效：
 * 只靠外层的整体 abort 不够 —— 那样一个卡住的源会把整轮拖到远超预期，
 * 而它的慢本来就是「不该被选中」的理由，没必要陪着等。
 */
async function timeOnce(registry: RegistrySpeedSample['registry'], outer: AbortSignal): Promise<number | null> {
    const ctrl = new AbortController()
    const onOuterAbort = (): void => ctrl.abort()
    outer.addEventListener('abort', onOuterAbort, { once: true })
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const started = Date.now()
    try {
        const res = await httpFetch('registry', registryBase(registry) + PROBE_PATH, {
            signal: ctrl.signal,
            headers: { accept: 'application/vnd.npm.install-v1+json' }
        })
        // 必须把 body 读完：只测到响应头的话，测的是首字节延迟而不是真正拿到版本列表的时间。
        await res.arrayBuffer()
        return res.ok ? Date.now() - started : null
    } catch {
        // 网络错误 / 超时 / 被取消一律按「这一轮失败」处理，不影响其它轮。
        return null
    } finally {
        clearTimeout(timer)
        outer.removeEventListener('abort', onOuterAbort)
    }
}

/** 让出 `ms` 毫秒；被取消时立即返回。 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) return resolve()
        const timer = setTimeout(done, ms)
        signal.addEventListener('abort', done, { once: true })
        function done(): void {
            clearTimeout(timer)
            signal.removeEventListener('abort', done)
            resolve()
        }
    })
}

/**
 * 测速全部候选源，跑 `SPEED_ROUNDS` 轮。
 *
 * **逐轮轮转**（每轮里两个源各测一次）而不是「一个源连测 N 次再换下一个」：
 * 后者会把两个源的测量错开到相隔数百毫秒，若这期间网络状态变了
 * （切网、VPN 重连、对端限速），比较的就不再是同一时刻的两个源。
 * 轮转让每一轮内两个源紧挨着测，横向可比。
 */
export async function measureRegistrySpeed(): Promise<RegistrySpeedResult> {
    // 整体超时：轮数 × 单轮超时是上界，但被取消时下面每个请求都会立刻中止。
    const ctrl = new AbortController()
    const roundsOf: Record<string, (number | null)[]> = {}
    for (const r of REGISTRY_IDS) roundsOf[r] = []

    try {
        for (let round = 0; round < SPEED_ROUNDS; round++) {
            if (round > 0) await sleep(ROUND_GAP_MS, ctrl.signal)
            // 一轮内并发测所有源（互不排队，避免串行等待把彼此的延迟算进对方）。
            const measured = await Promise.all(REGISTRY_IDS.map((r) => timeOnce(r, ctrl.signal)))
            REGISTRY_IDS.forEach((r, i) => roundsOf[r].push(measured[i]))
        }
    } finally {
        ctrl.abort()
    }

    const samples = REGISTRY_IDS.map((r) => summarizeRounds(r, roundsOf[r]))
    return { samples: rankRegistries(samples), fastest: pickFastestRegistry(samples) }
}
