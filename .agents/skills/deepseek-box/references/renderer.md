# 渲染进程（Vue 3）

> 事实来源：`src/renderer/src/` + `docs/zh/dev/renderer.md`。渲染层只能通过 `window.api` 调主进程。

## 目录

| 路径 | 说明 |
|---|---|
| `App.vue` | 根组件：标题栏、webview 容器、设置覆盖层、状态栏、全局提示与迁移进度框 |
| `views/WebHost.vue` | dsh Web UI / 网页宿主 |
| `views/SetupView.vue` | 初始化页（安装向导；`/setup` 路由，与设置页同级） |
| `views/NewTabFallback.vue` | 新建标签页**兜底页**（扩展 `xeonsky.browser` 停用时才渲染；正常由扩展的 `NewTab.vue` 贡献） |
| `views/LogView.vue` | 终端（`@xterm/xterm`） |
| `views/settings/*.vue` | 设置面板：General / Appearance / Network / Env / Dsh / Models / Log / Hotkeys / About。**pnpm 的来源与版本在「环境」页**（与 npm 同构：折叠卡片 + 标签即来源）。原先的「插件」页已随 dsh 插件管理体系一并移除；「Webview」页已随 webview 功能迁出：浏览器标识（UA）现由内置扩展 `xeonsky.browser` 用自己的设置面板承载（`src/extensions/xeonsky.browser/BrowserPanel.vue`，经 `renderer/src/extensions/panels.ts` 登记） |
| `views/settings/actions/` | `dshActions.ts`（启停 / 向导）、`dshManageActions.ts`（版本管理） |
| `views/settings/useSettingsStore.ts`、`settingsStore.ts` | Pinia 设置镜像与写回 |
| `views/settings/use{Node,Npm,Pnpm}Env.ts` | 「环境」页三档各自的**状态与动作**（`useNodeEnv` / `useNpmEnv` / `usePnpmEnv`）；`EnvPanel.vue` 只剩模板与一次加载编排 |
| `views/settings/useInstallCancel.ts` | 「取消当前在途安装」的共享实现（dsh / node / npm / pnpm 共用） |
| `components/` | `DshWizard.vue`（安装向导）、`WizardSteps.vue`（自绘步骤条）、`StatusBar.vue`、`TitleBar.vue`、`WindowControls.vue`、`ProxyFields.vue` |
| `components/wizard/` | 向导的三块自持逻辑：`useWizardRegistry.ts`（镜像源测速）、`useWizardNpm.ts`（内置 npm 准备）、`useWizardNode.ts`（本地 Node 版本与部署） |
| `lib/` | 主题、格式化、更新状态、locale、图标等工具 |
| `lib/update.ts` | 版本状态中心：`versionStatus` / `checkDsh` / `checkAllUpdates` / `applyAppUpdateEvent` |
| `shell/` | 路由、标签、窗口元信息、标签拖拽、外壳共享状态、进行中操作（`router` / `tabs` / `useTabDrag` / `viewnav` / `state` / `progressStore`） |
| `shell/state.ts` | 外壳级**跨组件共享状态**：`dshMissing`（dsh 缺失标记）与 `shellMeta` + `loadShellMeta()`（窗口元信息）。原 `dshstate.ts` / `shellmeta.ts` 已并入此文件 |
| `shell/progressStore.ts` | 「进行中的操作」在渲染层的**唯一**状态源：`startOperationTracking()`（`main.ts` 启动时订阅一次三条进度频道）、`refreshOperations()`（重取主进程快照）、`useOperation(kind)` → `{ op, busy }`。**面板不要自己 `window.api.on` 进度**：面板卸载订阅就没了，切页回来只剩空进度条 |
| `styles/` | 分层：`base.css`（reset + Element Plus 变量）→ `shared.css` → `settings.css` |

### 窗口装饰只有一处出口：`TitleBar.vue`

窗口是**无边框**的（窗口控制按钮由前端自绘），因此「拖动区」与「窗口按钮」必须由页面自己提供。
现在只有一个出口：

| 位置 | 用途 |
|---|---|
| `components/TitleBar.vue` | 标题栏：品牌、固定站与标签条、设置入口、窗口控制（`WindowControls.vue`） |

**初始化页与设置页都是「顶层视图」**（`/setup` → `views/SetupView.vue` → `components/DshWizard.vue`；
`/settings` → `views/SettingsView.vue`），由 `App.vue` 的 `<div class="web-overlay">` 承载，
**不遮挡标题栏与状态栏**，因此都不再自备标题栏或窗口按钮：

- 向导只把步骤条放在页面底部（`.wiz-footbar`，绝对定位贴在内容区底部，高 40px）；
- 向导内的「安装设置 / 安装日志」入口已取消 —— 镜像源 / 配置目录 / 代理本就是设置页里的那几项，
  dsh 输出流也一直显示在设置页「终端」，统一从标题栏进设置页看与改；
- 判断视图处于哪一层用 `shell/viewnav.ts` 的 `useView()`（`web` / `settings` / `setup`）。

- 窗口按钮（最小化 / 最大化-还原 / 关闭）由 `WindowControls.vue` 提供；
- 它内部**必须订阅 `win:maximized` 事件**而不是自己记状态：双击拖动区、系统快捷键、
  Aero Snap 同样会改变最大化状态，各写一份会让图标与窗口对不上；
- `.icon-btn` / `.wglyph` / `.divider` 放在 `styles/shared.css`（TitleBar 与其内嵌的
  `WindowControls` 共用；**不要放进任一组件**，否则另一处会因 scoped 样式而丢失）；
- 容器加 `-webkit-app-region: drag`，其中的按钮加 `no-drag`。

### 安装向导的步骤条是自绘的

`WizardSteps.vue` 把**整个容器高度**当作进度条的填充区（左起已完成百分比铺主色，右侧留白），
步骤文字浮在填充之上，**不要改用 `el-steps` / `a-steps`**：

- 那两种组件把状态表达为「圆圈 + 连接线」，没有「当前这一步完成了多少」的位置；
  而安装是长耗时流程（测速、下载 npm、装 dsh），用户最需要看到的正是当前步的进度；
- 填充铺满容器高度，所以那条步骤栏本身就是进度条，不额外占高度；
- 组件只接 `percent`（0–100，越界自动夹取）：拿不到百分比的阶段（解压、测速）由调用方
  另画 `.activity-bar` 滑动条。

向导共 **5 步**：`0 安装方式 · 1 镜像源 · 2 Node · 3 NPM · 4 DSH`。
第 0 步选「简易安装」后由 `runSimpleInstall()` 自动跑完 1–4（测速选源 → 本地 Node → 内置 npm → dsh 最新版），
选「自定义安装」则回到逐步选择。改动步骤顺序时，`watch(step)`、各 `v-if="step === n"` 与主按钮文案要一起改。

### 进度状态一律走 `shell/progressStore.ts`（不要自己订阅）

下载 / 安装是**主进程**在跑，渲染层只是显示。此前每个面板各自 `window.api.on(...)`
把进度存进自己的 `ref` —— 面板一卸载（切到设置里别的子页、从初始化页跳走）订阅与状态一起没了，
而主进程里的操作还在跑，切回来只剩空进度条。现在的分工：

| 谁 | 做什么 |
|---|---|
| `main.ts` | `startOperationTracking()` —— 启动时**订阅一次**三条进度频道（`nodeenv:deploy-progress` / `npmenv:progress` / `pnmenv:progress`，载荷带 `kind` 用来归位） |
| 主进程 `kernel/operations.ts` | 记住进行中的操作；操作结束（成功 / 失败 / 取消）时清空 |
| 面板 | 只读 `useOperation(kind)` → `{ op, busy }`；`onMounted` 与操作返回后调 `refreshOperations()` |

两条必须记住的：

- **按钮的 loading 用「本组件在途标记 ∨ `busy`」**，不要只用其一。广播**先**到、`await post()`
  后**才**返回；取消时主进程立刻清空 → `busy` 会先变假，但发起方还在等返回（只信 `busy` 会让按钮
  在取消瞬间闪回可点）。反过来，「离开本页期间由别处发起的操作」只有 `busy` 能反映 —— 这正是
  必须共享的原因。
- **事件流里没有「结束」信号**，所以操作 `finally` 里要 `refreshOperations()`，否则进度条不会收起来。

`busy` 还兼作「这个种类正在跑」的判据：EnvPanel 的 npm / pnpm / node 三块都靠它判断「是否正在准备」。

## 主进程别做同步阻塞

长耗时或大批量文件操作**不要用同步 API**，它会把主进程独占到界面完全没响应
（「一些操作时整个程序会卡住」）。已有两处收口：

- **进程终止**：`logbus.killTree()` 是 async（`spawn('taskkill', …)` + `unref()`）。Windows 上
  `taskkill /T` 常要几百毫秒遍历子孙进程，`spawnSync` 就是把界面冻在那里。只有紧接着要删被占用目录
  的场合才 `await`，退出收尾之类的直接 `void` 掉。
- **文件删除 / 拷贝**：`fsutil.removeTree` / `removeQuietly` / `prepareVersionDir` / `removeVersion`
  以及 `fs.promises.cp` —— 一个版本目录动辄几万个小文件。`removeQuietlySync` **只**给启动期
  无法 await 的同步迁移（`installs.ts` 的目录改名）用。

## 启动（`src/renderer/src/main.ts`）

```ts
async function bootstrap() {
    await loadShellMeta()                       // 本窗口是否核心窗口
    let resolved = 'zh'
    try { resolved = await window.api.get('/locale') } catch {}
    i18n.global.locale.value = resolved
    const app = createApp(App)
    app.use(createPinia())
    app.use(ElementPlus, { locale: resolved === 'zh' ? zhCn : en })
    app.use(i18n)
    app.use(router)
    app.mount('#app')
}
```

新增全局插件 / 样式时要保持这个顺序；`loadShellMeta()` 必须先于任何依赖「是否核心窗口」的逻辑。

## 状态管理

- Pinia store 保存设置镜像；`useSettingsStore.ts` 从主进程读取并写回。
- 面板改动后调主进程保存；部分设置需「立即应用」重启 dsh 才生效。
- **凡从设置派生的状态都要订阅 `settings:changed`**，见 architecture.md 的「设置与状态传播」；发起保存的窗口用 store 的 `lastSaveAt` 忽略自己触发的回放。

## UI 组件库（antdv-next 优先）

**新功能一律用 `antdv-next`**（模板 `<a-*>` 前缀），禁止新增 `el-*`；Element Plus 处于迁移期，改动触及的文件顺手替换。

- **按需引入**：组件与样式由 `electron.vite.config.ts` 里的 `Components({ resolvers: [AntdvNextResolver()] })` 自动注入。
  - 模板直接写 `<a-button>` / `<a-tag>`，**不要手动 import 组件**，也**不要** `app.use(Antdv)` 全量注册。
  - `dts: false`、`dirs: []`：不生成 `components.d.ts`、不扫描本地组件（本地组件保持显式 import）。
- **运行时基座**：`src/renderer/src/lib/antdv.ts`
  - `AntdvRoot` = `ConfigProvider`（locale）→ antdv `App`，包在 `App.vue` 最外层。
  - 命令式提示（`message` / `Modal` / `notification`）从 `antdv-next` 显式导入，依赖 `AntdvRoot` 提供的上下文，否则主题 / 语言不生效。
  - `antdvLocale()` 把界面语言映射到 antdv locale 包（非 zh 回落 `en_US`）。
- **图标**：统一用 `@antdv-next/icons`；`@ant-design/icons-vue` 与 antdv-next 不适配，不要引入。
- **迁移对照**：`el-button`→`a-button`、`el-tag`→`a-tag`、`el-form`→`a-form`、`el-input`→`a-input`、`el-select`→`a-select`、`el-switch`→`a-switch`、`el-collapse`→`a-collapse`、`ElMessage`→`message`、`ElMessageBox`→`Modal`、`ElNotification`→`notification`。
  组件 API 有差异（`el-option` → `a-select-option`、`el-collapse-item` → `a-collapse-panel`），改动前查 `antdv-next` 技能对应组件的 `docs.md` 与 `demo/`。

## 主题与语言

- 主题：跟随系统 / 浅色 / 深色；配色方案决定主色与底色；深色下切换深色应用图标。
- i18n：`vue-i18n`，语言包在 `src/shared/locales/`；`lib/locales.ts` 负责装配。
- 主题与语言会同步到 dsh 自身配置（主进程 `syncDshTheme` / `writeDshLocale`），渲染层不要自己去写 dsh 配置。

## 状态栏（`components/StatusBar.vue`）

- **当前供应商余额**：授权后读 `GET /models/balance`；前台每 5 分钟自动刷新、点击手动刷新；未授权显示「点击授权」并跳转「设置 → 模型」。
- **程序版本 · dsh 版本**：`GET /app/meta` 与 `GET /dsh/version`；点击弹层触发 `checkAllUpdates()`，结果只显示为版本项小红点（静默提示）。
- 真源是 `lib/update.ts` 的 `versionStatus`，不要在组件里另存版本状态。

## 标签与窗口

标签创建、保活、拖动迁移在 `shell/tabs.ts` 等；核心 / 副窗口角色由主进程 `windowreg.ts` 与渲染层共同决定。跨窗口拖标签用 `/tab-drag` 系列端点，屏幕坐标决定落点。

**新建标签页（`kind === 'newtab'`）是「程序内置标签页视图」，不是 webview**：内容由扩展贡献（`ExtTabContribution.view`），渲染层 `extensions/tabviews.ts` 的 `LOCAL_TAB_VIEWS` 按名字解析本地组件（**只有 builtin / system** 能解析），`WebHost.vue` 用 `defineAsyncComponent(newTabViewLoader())` 挂载；取不到就回落 `views/NewTabFallback.vue`。带 `view` 的贡献**不会**被 `registerExtTabs` 打开成标签页（`isTabViewContribution` 跳过）。

**扩展视图与外壳标签模型交互的唯一通道是 `renderer-api.ts` 的 `extShell`**（`openTab` / `activateFixed` / `goSettings`）—— 扩展不能 import `@/shell/*`。需要新交互**先扩 `extShell`**，不要在扩展里绕主进程发端点（标签模型是渲染层单例）。

## 新增一个设置面板

1. 在 `views/settings/` 新建 `XxxPanel.vue`（`<script setup lang="ts">`，4 空格缩进）。
2. 在 `SettingsView.vue` 注册入口（导航 + 条件渲染）。
3. 需要持久化的项：加到 `shared/types.ts` 的 `Settings` 与默认值，并按需订阅 `settings:changed`。
4. 文案加到 locales（zh / en 两处；hant 是差异覆盖，无需补充，见 conventions.md）。
5. `npm run typecheck` + `npm run lint`。

## 与主进程通信

只用 `window.api`：`window.api.get('/settings')`、`window.api.on('settings:changed', ...)`。新增端点流程见 ipc.md；不要 import 任何 Electron API，渲染层没有 Node 集成。
