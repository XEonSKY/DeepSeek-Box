import type { MainModule } from '../kernel/module'
import settings from './settings'
import dsh from './dsh'
import env from './env'
import shell from './shell'
import tabdrag from './tabdrag'
import appupdate from './appupdate'
import configdir from './configdir'
import extensions from './extensions'
import download from './download'

/**
 * 模块树：主进程的全部功能模块。
 *
 * **新增一个功能模块 = 写一个文件 + 在这里加一行。** 核心（kernel）不认识任何具体模块，
 * 它只负责遍历这张表并挂载；因此模块可以任意增删，装配逻辑不必改。
 *
 * 顺序即装配顺序（也决定 `onReady` / `onQuit` 的调用顺序：`onQuit` 逆序）。
 * 目前各模块互不依赖，顺序不重要；将来若有「A 的端点要用 B 提供的能力」，用 kernel 的
 * 服务槽（`kernel/services.ts`）解耦，而**不要**把顺序当成隐式依赖。
 *
 * `download` 排在最后：它的 `onReady` 要往窗口广播进度，`onQuit` 要中止在跑的任务 ——
 * 放在窗口相关模块之后装配，退出时就能最先被收尾（逆序）。
 */
const modules: MainModule[] = [settings, dsh, env, shell, tabdrag, appupdate, configdir, extensions, download]

/** 全部模块（装配器与测试用）。 */
export function allModules(): MainModule[] {
    return [...modules]
}
