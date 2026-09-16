# 渲染进程（Vue 3）

> 事实来源：`src/renderer/src/` + `docs/zh/dev/renderer.md`。渲染层只能通过 `window.api` 调主进程。

## 目录

| 路径 | 说明 |
|---|---|
| `App.vue` | 根组件：标题栏、webview 容器、设置覆盖层、状态栏、全局提示与迁移进度框 |
| `views/WebHost.vue` | dsh Web UI / 网页宿主 |
| `views/NewTab.vue` | 内置导航页 |
| `views/LogView.vue` | 终端（`@xterm/xterm`） |
| `views/settings/*.vue` | 设置面板：General / Appearance / Network / Env / Dsh / Models / Log / Hotkeys / Webview / About |
| `views/settings/actions/` | `dshActions.ts`（启停 / 向导）、`dshManageActions.ts`（版本管理） |
| `views/settings/useSettingsStore.ts`、`settingsStore.ts` | Pinia 设置镜像与写回 |
| `components/` | `DshWizard.vue`（四步向导）、`StatusBar.vue`、`TitleBar.vue`、`WindowControls.vue`、`ProxyFields.vue`、`ThreadsField.vue` |
| `lib/` | 主题、格式化、更新状态、locale、图标等工具 |
| `lib/update.ts` | 版本状态中心：`versionStatus` / `checkDsh` / `checkAllUpdates` / `applyAppUpdateEvent` |
| `shell/` | 路由、标签、窗口元信息、标签拖拽（`router` / `tabs` / `shellmeta` / `useTabDrag` / `viewnav`） |
| `styles/` | 分层：`base.css`（reset + Element Plus 变量）→ `shared.css` → `settings.css` |

### 窗口装饰的两处出口

窗口是**无边框**的（窗口控制按钮由前端自绘），因此「拖动区」与「窗口按钮」必须由页面自己提供。
目前有两个位置提供它们，**两处都必须存在**：

| 位置 | 何时可见 | 用途 |
|---|---|---|
| `TitleBar.vue` | 常规界面 | 标题栏：品牌、固定站、标签条、设置入口、窗口控制 |
| `DshWizard.vue` 的 `.wiz-navbar` | dsh 缺失时的安装向导 | 专属导航栏：**步骤条在左**，向导入口 + 窗口控制在右 |

安装向导是覆盖整窗口的遮罩（`z-index` 高于标题栏），会把标题栏连同其窗口按钮一起挡住 ——
所以向导必须自备一条导航栏，否则安装期间窗口既不能拖动也不能最小化 / 关闭。

- 窗口按钮（最小化 / 最大化-还原 / 关闭）由 `WindowControls.vue` 统一提供，两处复用同一组件；
- 它内部**必须订阅 `win:maximized` 事件**而不是自己记状态：双击拖动区、系统快捷键、
  Aero Snap 同样会改变最大化状态，各写一份会让图标与窗口对不上；
- `.icon-btn` / `.wglyph` / `.divider` 是两处共用的样式，放在 `styles/shared.css`
  （**不要再放进任一组件**，否则另一处会因 scoped 样式而丢失）；
- 容器加 `-webkit-app-region: drag`，其中的按钮加 `no-drag`。

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

## 新增一个设置面板

1. 在 `views/settings/` 新建 `XxxPanel.vue`（`<script setup lang="ts">`，4 空格缩进）。
2. 在 `SettingsView.vue` 注册入口（导航 + 条件渲染）。
3. 需要持久化的项：加到 `shared/types.ts` 的 `Settings` 与默认值，并按需订阅 `settings:changed`。
4. 文案加到 locales（zh / en / hant 三处，见 conventions.md）。
5. `npm run typecheck` + `npm run lint`。

## 与主进程通信

只用 `window.api`：`window.api.get('/settings')`、`window.api.on('settings:changed', ...)`。新增端点流程见 ipc.md；不要 import 任何 Electron API，渲染层没有 Node 集成。
