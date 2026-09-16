/**
 * 跨端（main + renderer）共用的版本号工具。
 *
 * 这里刻意**不依赖 `semver` 包**：renderer 侧只做轻量判断，引入 semver 会白白增大渲染层产物。
 * 主进程的 `main/semver.ts` 复用本函数，从而保证「是否预发布」在两端判断一致
 * （此前 main 用 semver.prerelease、renderer 用正则，遇到带前导 v 的版本号会得出不同结论）。
 */

/** 去掉前导 v/V（GitHub Release tag 常见）。 */
export function stripV(v: string): string {
    return v.replace(/^[vV]/, '')
}

/** 是否预发布版本（含 rc / beta / alpha / 数字预发布段）。 */
export function isPrerelease(v: string): boolean {
    return /^\d+\.\d+\.\d+-/.test(stripV(v))
}

/**
 * 统一补上 `v` 前缀供界面展示：`process.versions.node` 不带 v，`node --version` 带，
 * 同一列里混着两种写法很难看；空值统一显示占位符。
 *
 * 此前 DshPanel / EnvPanel 各写了一份（其中一份还用了模板字符串），展示层合并为一处。
 */
export function withV(v: string | null | undefined, placeholder = '—'): string {
    if (!v) return placeholder
    return /^[vV]/.test(v) ? v : `v${v}`
}

/** dsh 可用的 Node 最低主版本 —— 低于它的 Node 装了也跑不起 dsh。 */
export const MIN_NODE_MAJOR = 20

/** 取版本号主版本（`v22.14.0` / `22.14.0` → 22）；解析不出返回 null。 */
export function nodeMajor(v: string | null | undefined): number | null {
    if (!v) return null
    const m = /^v?(\d+)/.exec(v.trim())
    return m ? parseInt(m[1], 10) : null
}
