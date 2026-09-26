/**
 * JSON / 任意值的**窄化**工具，跨端共用的纯逻辑。
 *
 * 起因：dsh 的配置（patch 层、manifest、profile bundle）与扩展清单都是「读进来才知形状」
 * 的 JSON，各处都要先确认「这是不是一个普通对象」再取字段。此前 `cordisPatch.ts` /
 * `providers.ts` / `pluginManifest.ts` / `loader/manifest.ts` 各写了一份一模一样的
 * `asRecord` / `asObject`，语义漂移的风险虽小，但没必要维护四份。收敛到这里。
 */

/**
 * 是否「普通对象」：数组与 null 都不算，其余 object 视为可安全取属性的字典。
 *
 * @returns 是普通对象则原样返回（带 `Record` 类型），否则 null。
 */
export function asRecord(v: unknown): Record<string, unknown> | null {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
