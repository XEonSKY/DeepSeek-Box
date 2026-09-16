/**
 * 跨端（main / preload / renderer）共用的错误信息提取。
 *
 * 各处原先都写 `err instanceof Error ? err.message : String(err)`（全仓 34 处），
 * 除了啰嗦，还容易在个别地方漏掉非 Error 分支（如 IPC 传来的字符串、插件抛出的普通对象），
 * 表现为界面显示 `[object Object]`。收敛到一处后行为统一。
 */

/** 取任意抛出值的可读信息：Error 取 message，其余转字符串；null/undefined 给空串。 */
export function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    if (err === null || err === undefined) return ''
    return typeof err === 'string' ? err : String(err)
}
