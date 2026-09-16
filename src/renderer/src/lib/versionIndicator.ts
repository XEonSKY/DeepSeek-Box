/**
 * 状态栏版本项的「指示文本」——纯逻辑，无 DOM、无 i18n 依赖。
 *
 * 状态栏那一格不显示版本号（号在浮层 / 关于页看），只说当前结论：
 * 「已是最新 / 检测到新版本 / 正在安装 / 等待重启」。
 * 这样这一格长度固定，不随版本号抖动；翻译也由调用方负责，便于单测。
 */

/** 一行版本在检查后的结局（与 update.ts 的 VersionCheckState 对齐）。 */
export type VersionLineState = 'idle' | 'checking' | 'latest' | 'available' | 'downloaded' | 'error'

/** 状态栏要给出的结论：瞬时态（checking / installing）+ 可用事件表示的四种结局。 */
export type StatusIndicatorState = Exclude<VersionLineState, 'idle'> | 'installing'

/**
 * 由程序 / dsh 两条线归并出状态栏唯一的一句话。优先级：
 *
 *  1. `installing` —— 正在下载安装，用户最该知道；
 *  2. `checking`   —— 程序 + dsh **都**在查；只有一边在查就沿用上次结论，免得文字闪；
 *  3. `downloaded` —— 已下好，等用户重启（可操作，且不该被 dsh 的结论盖掉）；
 *  4. `available`  —— 任一有新版本；
 *  5. `latest`     —— 已有明确结论且都没更新；
 *  6. `error`      —— 两条线都失败（一边成功说明还有结论可说）。
 *
 * 两条线都还没结论（idle）时返回 null，状态栏那一格留白。
 */
export function indicatorState(
    app: { state: VersionLineState },
    dsh: { state: VersionLineState },
    installing = false
): StatusIndicatorState | null {
    if (installing) return 'installing'
    if (app.state === 'checking' && dsh.state === 'checking') return 'checking'
    if (app.state === 'downloaded' || dsh.state === 'downloaded') return 'downloaded'
    if (app.state === 'available' || dsh.state === 'available') return 'available'
    // 一边还在查、另一边已是结论：沿用结论，不显示「检查中」。
    if (app.state === 'latest' || dsh.state === 'latest') return 'latest'
    // 只剩错误（另一边 idle / checking）：错误也是有效结论。
    if (app.state === 'error' || dsh.state === 'error') return 'error'
    return null
}
