import { ref } from 'vue'

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
