import type { NpmRegistry, RegistrySpeedSample } from '@shared/types'

/**
 * npm registry 的**纯**定义与挑选规则。
 *
 * 单独一个模块（不 import electron / http）：`registryBase` 决定装到哪个源，
 * 「挑最快的源」决定简易安装装到哪个源 —— 两者都是纯逻辑，必须能单测。
 * 需要联网的测速在 speed.ts，那里才依赖 httpFetch（进而依赖 electron）。
 */

/** 全部候选 registry，顺序即测速与展示顺序。 */
export const REGISTRY_IDS: readonly NpmRegistry[] = ['npmjs', 'npmmirror']

const BASE: Record<NpmRegistry, string> = {
    npmjs: 'https://registry.npmjs.org',
    npmmirror: 'https://registry.npmmirror.com'
}

/** npm registry 的 URL 基址（安装 / 查询 / 测速都走这里）。 */
export function registryBase(r: NpmRegistry): string {
    return BASE[r]
}

/** 样本是否可用：有实测值、有限、非负。 */
function usable(s: RegistrySpeedSample): boolean {
    return s.ms !== null && Number.isFinite(s.ms) && s.ms >= 0
}

/**
 * 排序规则：**可用的在前按延迟升序，失败的（ms = null）排在最后**。
 *
 * ⚠️ 失败项不能当作「延迟 0」或直接丢掉：丢掉会让 UI 没得展示，
 * 当成 0 则会把它误判成最快。这里显式排在末尾，并靠 `pickFastestRegistry` 排除。
 */
export function rankRegistries(samples: readonly RegistrySpeedSample[]): RegistrySpeedSample[] {
    return [...samples].sort((a, b) => {
        const ua = usable(a)
        const ub = usable(b)
        if (ua !== ub) return ua ? -1 : 1
        if (!ua || !ub) return 0
        return (a.ms as number) - (b.ms as number)
    })
}

/** 最快且可用的 registry；全部不可用返回 null（调用方应保留用户当前设置）。 */
export function pickFastestRegistry(samples: readonly RegistrySpeedSample[]): NpmRegistry | null {
    const best = rankRegistries(samples).find(usable)
    return best ? best.registry : null
}
