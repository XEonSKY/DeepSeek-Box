import { reactive, ref } from 'vue'

/**
 * 外壳级共享状态 —— 跨组件 / 跨路由都需要读写、且由启动流程一次性初始化。
 *
 * 收敛到一处的原因：这些状态原先散在两个文件（`shellmeta.ts` / `dshstate.ts`）里，
 * 都是「bootstrap 时设定、之后只读 / 极少改」的单例；合并后维护外壳状态只找本模块。
 * 与 `shell/tabs.ts`（标签模型）、`shell/progressStore.ts`（操作进度）并列 ——
 * 那两者各有自己的写入协议，故不并入本文件。
 */

// ---------------------------------------------------------------------------
// 当前窗口元信息（winId + 是否核心窗口）
// ---------------------------------------------------------------------------

/**
 * 核心窗口才承载 dsh UI；多窗口架构中，新开的非核心窗口 isCore=false。
 * 由 bootstrap 在挂载前读取（见 main.ts 的 `loadShellMeta()`）。
 */
export const shellMeta = reactive<{ winId: number; isCore: boolean; loaded: boolean }>({
    winId: 0,
    isCore: true,
    loaded: false
})

/** 读取并写入当前窗口元信息（挂载 Vue 之前调用一次）。 */
export async function loadShellMeta(): Promise<void> {
    try {
        const m = await window.api.get('/shell/meta')
        shellMeta.winId = m.winId
        shellMeta.isCore = m.isCore
    } catch {
        /* 异常环境按核心窗口处理 */
    }
    shellMeta.loaded = true
}

// ---------------------------------------------------------------------------
// dsh 缺失状态（未安装 / 未初始化）
// ---------------------------------------------------------------------------

/**
 * dsh 是否缺失（未安装 / 未初始化）。
 *
 * 为什么是**共享**状态而不是 App.vue 的局部 ref：初始化页现在是独立路由（`/setup`），
 * 安装完成后要由页面自己把它清掉 —— 否则「进入 dsh 页自动跳初始化」会把刚装完的用户又弹回去。
 *
 * 更新时机：
 *  - App.vue 启动时查 `/dsh/installed`；
 *  - 主进程广播 `dsh:missing`（dsh 启动失败 / 被卸载 / 换到没装的版本）；
 *  - 初始化页安装完成后重新查询一次。
 */
export const dshMissing = ref(false)
