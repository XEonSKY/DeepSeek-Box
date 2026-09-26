# 渲染进程

渲染层是 Vue 3 应用，负责标签页外壳、设置页、安装向导、状态栏与终端。源码在 `src/renderer/src/`。

## 目录

| 路径 | 说明 |
|---|---|
| `App.vue` | 根组件：标题栏、webview 容器、设置覆盖层、状态栏、全局提示与迁移进度框 |
| `views/` | 页面：`WebHost.vue`（dsh Web UI / 网页 / 新建标签页宿主）、`NewTabFallback.vue`（新建标签页兜底页，扩展停用时用）、`LogView.vue`（终端） |
| `views/settings/` | 设置面板：General / Appearance / Network / Env / Dsh / Models / Log / Hotkeys / About |
| `views/settings/ModelsPanel.vue` | 「模型」页：同意流程 + 模型 / 供应商 / 余额三列与「刷新全部」 |
| `views/settings/use{Node,Npm,Pnpm}Env.ts` | 「环境」页三档各自的状态与动作；`EnvPanel.vue` 只剩模板与加载编排 |
| `views/settings/actions/` | 设置动作：`dshActions.ts`（启停 / 安装向导）、`dshManageActions.ts`（DeepSeek Harness 版本管理） |
| `components/` | `DshWizard.vue`（四步安装向导）、`StatusBar.vue`（底部状态栏：余额与版本徽标）、`TitleBar.vue` 等 |
| `components/wizard/` | 向导三块自持逻辑：`useWizardRegistry.ts`（镜像源测速）、`useWizardNpm.ts`（内置 npm 准备）、`useWizardNode.ts`（本地 Node 与部署） |
| `shell/state.ts` | 外壳级跨组件共享状态：`dshMissing` 与 `shellMeta` / `loadShellMeta()` |
| `lib/` | 主题、格式化、更新状态、locale 等工具（标签相关在 `shell/`） |
| `lib/update.ts` | 版本更新状态中心：`versionStatus` / `checkDsh` / `checkAllUpdates` / `applyAppUpdateEvent` / `hasUpdate` |
| `views/settings/useSettingsStore.ts` / `views/settings/settingsStore.ts` | Pinia 状态与设置镜像 |

## 状态管理

- Pinia store 保存设置镜像，`useSettingsStore.ts` 负责从主进程读取并写回；
- 设置面板改动后调用主进程保存（部分设置需「立即应用」重启 dsh 才生效）。

## 标签与窗口

标签的创建、保活、拖动迁移逻辑在 `shell/tabs.ts` 等；核心窗口与副窗口的角色由主进程 `windowreg.ts` 与渲染层共同决定。

## 状态栏

底部状态栏由 `components/StatusBar.vue` 渲染，右对齐一组只读信息：

- **当前供应商余额**：授权后从 `GET /models/balance` 读取当前默认模型所属供应商的余额，前台每 5 分钟自动刷新、点击手动刷新；未授权时显示「点击授权」并跳转到「设置 → 模型」；
- **程序版本 · dsh 版本**：实际版本来自 `GET /app/meta` 与 `GET /dsh/version`；点击弹出浮层触发 `checkAllUpdates()`，检测结果显示为版本项上的小红点（静默提示，不弹通知）。状态真源是 `lib/update.ts` 的 `versionStatus`。

## 主题与语言

- 主题：跟随系统 / 浅色 / 深色；配色方案决定主色与底色；深色下应用图标切换深色版；
- i18n：`vue-i18n`，语言包在 `src/shared/locales/`（zh / en 及扩展翻译）；扩展翻译是文本覆盖；
- 主题与语言会同步到 dsh 自身的配置。

## 与主进程通信

所有主进程能力都通过 `window.api`（预加载暴露的 REST 客户端）调用，契约是 `src/shared/api.ts` 的 `ApiRoutes`：`window.api.get('/settings')`、`window.api.on('settings:changed', …)`。新增端点两处同步，见 [IPC 契约](/zh/dev/ipc)。

## 进度状态走共享 store

下载 / 安装由主进程执行，渲染层只负责显示。**面板不要自己 `window.api.on` 进度**：
面板一卸载（切到设置里别的子页、从初始化页跳走）订阅就没了，而主进程里的操作还在跑 ——
切回来只剩空进度条。统一用 `shell/progressStore.ts`：

- `main.ts` 启动时 `startOperationTracking()` 订阅一次三条进度频道；
- 面板只读 `useOperation(kind)` → `{ op, busy }`；
- 面板 `onMounted` 与操作返回后调 `refreshOperations()` —— 事件流里**没有**「结束」信号，
  不重新取快照进度条就不会收起来。

按钮的 loading 要用「本组件在途标记 ∨ `busy`」：广播先到、`await post()` 后才返回，取消时主进程
会立刻清空，只信 `busy` 会让按钮在取消瞬间闪回可点。
