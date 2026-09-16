---
name: deepseek-box
description: DeepSeek Box 桌面外壳（本工作区专属）的专业开发指南。在本仓库修改 src/main（主进程）、src/preload、src/renderer（Vue 3）、src/shared（类型/契约/i18n）、IPC 路由、应用设置与迁移、DeepSeek Harness 安装链路、文档站或发布流程时使用。给出三进程架构、REST 风格 IPC 契约、硬性约定与验证命令，避免跨进程契约不同步。
license: Apache-2.0
metadata:
  scope: workspace-only
  project: DeepSeek Box
  version: "0.1.6-alpha.3"  # 跟随应用版本
---

# DeepSeek Box 项目开发技能

> 仅用于本工作区（仓库根 = 工作区根，`package.json` 的 `name` 为 `deepseek-box`）。
> 换到其它 Electron / Vue 仓库时不要套用本文结论。

## 何时使用

命中任一情况即加载本技能：

- 在本仓库改代码：`src/main/**`、`src/preload/**`、`src/renderer/**`、`src/shared/**`；
- 新增 / 修改 IPC 端点或主进程事件；
- 改动应用设置、配置目录、迁移逻辑；
- 改动 dsh / Node / npm 的安装、下载、更新链路；
- 改动界面文案、主题、设置面板、标签页外壳；
- 改动 `docs/**` 文档站或发布 / 打包流程。

与其它技能的分工：

- 通用 Vue 写法（响应式、SFC、props/emits、composable）→ 用 `vue-best-practices`；
- 组件库细节 → 查 `antdv-next`（本仓库主题是 Element Plus，若引入 Antdv 组件时再查）；
- 本技能只讲「这个项目怎么改才不破坏契约」。

## 项目速览

**DeepSeek Box** 是 DeepSeek Harness（npm 包 `@deepseek-ai/dsh`）的桌面外壳：Electron 44 + electron-vite 5 + Vite 7 + Vue 3 + TypeScript + Element Plus + Pinia + vue-i18n + @xterm/xterm。它负责定位 / 安装 / 启动 / 守护 dsh，并把 dsh 的 Web UI 嵌进原生窗口。

| 目录 | 职责 |
|---|---|
| `src/main/` | 主进程：窗口 / 托盘 / 设置 / dsh 启停 / 下载安装 / 自更新 / IPC 路由 |
| `src/main/app/` | 应用自身（设置、迁移、模型、窗口、更新、IPC） |
| `src/main/dsh/` | DeepSeek Harness 与运行环境（安装、下载、Node/npm、版本目录） |
| `src/preload/` | 唯一 `contextBridge` 出口：`window.api`（REST 客户端 + 本地常量 + 事件订阅） |
| `src/renderer/src/` | Vue 3 界面：标签页外壳、设置页、安装向导、状态栏、终端 |
| `src/renderer/src/lib/antdv.ts` | antdv-next 运行时基座：`AntdvRoot`（ConfigProvider + App 上下文） |
| `src/shared/` | 三端共享：类型、IPC 契约、i18n、版本工具 |
| `docs/` + `.vitepress/` | 文档站（zh/en 成对，内容 + nav/sidebar） |
| `.agents/skills/` | 本工作区技能（含本文件） |

运行期数据不在 Electron userData，而在**配置目录**：`~/.dsbox/release`（打包）/ `~/.dsbox/dev`（开发），含 `settings.json` 与 `node/`、`npm/`、`dsh/`、`workspace/`。

## 铁律（违反即视为改坏）

1. **契约唯一事实来源是 `src/shared/api.ts`**：`ApiRoutes`（请求）与 `AppEvents`（推送）。新增端点必须**两处同步**：先登记 `ApiRoutes`，再在 `src/main/app/ipc.ts` 的 `registerIpc()` 实现；`preload` 不改。
2. **IPC 通道收口**：全项目只有 `src/main/app/router.ts` 直接碰 `ipcMain`；只有 `src/preload/index.ts` 直接碰 `ipcRenderer`。
3. **主进程禁止裸 `fetch`**：所有 HTTP 走 `httpFetch(scope, url, init)`（`src/main/dsh/http.ts`），`scope` 决定是否走代理。
4. **主进程推送不能直接 `webContents.send`**：用 `runtime.ts` 的 `broadcast` / `sendToWindow` / `sendToWcId` / `sendCore`，否则绕过 `ipc:event` 信封，渲染层收不到。
5. **密钥不出主进程**：模型 / 余额相关的凭据读取只留在主进程，渲染层拿不到明文。
6. **设置派生状态必须订阅 `settings:changed`**：否则表现为「改完要重启才生效」；发起保存的窗口忽略回放（靠 store 的 `lastSaveAt`）。
7. **归一化必须保留 `legacy` 判断**：`loadSettings()` 按 `settingsVersion`（当前 2）做一次性迁移，不能反复改写用户手填值。
8. **i18n 三处同步**：新增文案要同时改 `src/shared/locales/zh/index.ts`、`en/index.ts`、`zh/hant.ts`，键名 / 顺序 / 占位符都对齐。
9. **代码风格**：缩进 **4 个空格**（`src/**`、`.vitepress/**`、`scripts/**` 的 ts/vue/js/css/mts 与 `package.json`、`tsconfig*.json` 全部统一）；注释与 JSDoc 用**简要中文**。**YAML 例外**：`.github/workflows/*.yml` 保持 2 空格（缩进敏感 + Actions 惯例），见 `.editorconfig`。
10. **agent 只做静态验证**：`npm run typecheck` / `npm run lint`（必要时 `npm run build`）。运行时行为（窗口 / 托盘 / 下载 / 迁移 / 自更新）由用户验证，**不要自行启动应用**。
11. **agent 产生的缓存 / 临时文件统一放 `.agents/temp/`**（用完即删），不要散落到工作区根或 `docs/`。
12. **分支与推送**：改动推送至 `dev`，**发行时才推 `main`**；任何 `git push`（含 `--force` / `--tags` / 删远程分支标签）都要先说明目标并征得同意；本地 `add`/`commit`/`branch`/`merge`/`checkout` 可直接做。
13. **一个提交只做一件事**，禁止顺手改无关文件；不维护 `CHANGELOG.md`，变更记录以 GitHub Release notes 为准。
14. **新增依赖优先复用现有能力**，避免重复依赖与体积膨胀。**装到哪一侧**：前端 / 构建期依赖（Vue、UI 库、Vite 插件、resolver、图标等）一律进 `devDependencies`——渲染层会被 Vite 打进产物，运行时无需 node_modules；`dependencies` 只放**主进程外置的运行时依赖**（因为 `electron.vite.config.ts` 里 `main`/`preload` 设了 `externalizeDeps: true`，这些会被随包分发）。当前 `dependencies` 仅有 `electron-updater` / `semver` / `yaml`。
15. **用户可见文案必须 i18n**（主进程 `mt()`、渲染层 `t()`），日志走统一入口，禁止硬编码文案。
16. **`settings.json` 结构变更必须向后兼容**：升 `settingsVersion` 并保留旧值迁移；发布保持 A/B 版本槽 + 自动回退能力。
17. **技能维护**：`deepseek-box` 攒一批再统一更新；`metadata.version` 跟随应用版本。
18. **版本号规范 `X.Y.Z-{alpha|beta|rc}.N`**：主次修订三段正常递增，**预发布通道限定为 alpha / beta / rc**，通道内序号从 `.0` 起递增（`0.1.6-alpha.2` → `0.1.6-alpha.3`）；遵守 semver 字典序，故 `alpha < beta < rc` 升级链天然正确。改版本要**同时改四处**：`package.json`、`package-lock.json` 顶层与 `packages[""]`、技能 `metadata.version`；一律不带 `v` 前缀（`v` 只在 Git tag 上）。
19. **提交信息用 Conventional Commits**：`feat:` / `fix:` / `docs:` / `refactor:` / `chore:` 等。
20. **质量门禁**：`npm run check`（typecheck + lint + 单元测试）必须通过；仓库自带 `.githooks/pre-commit`（`npm install` 的 `prepare` 自动启用 core.hooksPath），CI 见 `.github/workflows/quality.yml`；仅紧急情况用 `--no-verify`。
21. **纯逻辑必须配单测**：`src/shared/**` 与 `src/main/**` 里不依赖 Electron 的纯函数（版本比较、路径与文件助手、设置归一化、i18n 解析）改动时必须补 `*.test.ts`（与源码同目录）。组件渲染与运行时行为仍由用户验证。
22. **`.agents` 入库策略**：`.agents/skills/**` 纳入版本管理；`.agents/temp/` 忽略（仅保留 `.gitkeep`）。
23. **文档同步节奏**：开发期只维护技能；`docs/` 中英在**发布时**统一更新，并同时整理技能。
24. **UI 组件优先 antdv-next**：新功能一律用 `antdv-next`（`<a-*>` 前缀），**禁止新增 `el-*` 组件**；样式与主题优先走 antdv 的 token。
25. **antdv-next 按需引入**：组件与样式由 `electron.vite.config.ts` 的 `AntdvNextResolver` 自动注入，模板里直接写 `<a-button>` 即可，**不要手动 `import { Button }`，也不要全量 `app.use(Antdv)`**；需要上下文（`message` / `Modal` / `notification`）时从 `antdv-next` 显式导入，根容器由 `lib/antdv.ts` 的 `AntdvRoot` 提供。
26. **Element Plus 迁移进行中**：改动触及某个文件时，顺手把该文件内的 `el-*` 换成 antdv 等价组件（语义对齐、不改变观感行为）；剩余存量逐步清理，全部替换后再卸载 `element-plus` 并移除 `element-plus` 样式。
27. **图标用 `@antdv-next/icons`**：`@ant-design/icons-vue` 与 antdv-next 不适配，不要引入。

## 任务路由表

| 我要做的事 | 先改 | 必须同步 | 详见 |
|---|---|---|---|
| 新增 / 改 IPC 端点 | `src/shared/api.ts` 的 `ApiRoutes` | `src/main/app/ipc.ts` | references/ipc.md |
| 新增主进程事件 | `shared/api.ts` 的 `AppEvents` | 用 `broadcast` 发送 + 渲染层 `api.on` | references/ipc.md |
| 新增 / 改设置项 | `shared/types.ts`（`Settings` + 默认值） | 归一化 legacy、订阅 `settings:changed` | references/main-process.md |
| 新增界面文案 | `locales/zh/index.ts`、`en/index.ts` | `zh/hant.ts` | references/conventions.md |
| 新增设置面板 | `renderer/src/views/settings/*.vue` | `SettingsView.vue` 注册 + 文案 | references/renderer.md |
| 改 dsh / Node / npm 安装 | `main/dsh/{manage,nodeenv,npmRunner}.ts` | `dsh/installs.ts` 版本目录 | references/main-process.md |
| 改下载 / 取消 / 解压 | `main/dsh/downloader.ts`、`cancel.ts` | 进度事件 `phase` | references/main-process.md |
| 改配置目录与迁移 | `main/app/settings.ts`、`configmigrate.ts` | `main/index.ts` 启动顺序 | references/architecture.md |
| 改窗口 / 标签 / 托盘 | `main/app/{ui,windowreg}.ts` + `renderer/src/shell/*` | `shell/*` 路由与事件 | references/architecture.md |
| 改文档站 | `docs/zh/...` + `docs/en/...` 成对 | `.vitepress/config.mts` nav/sidebar | references/conventions.md |
| 新增 / 迁移 UI 组件 | `<a-*>` 组件（antdv-next） | 迁移同文件的 `el-*`；查 `antdv-next` 技能 | references/renderer.md |
| 打包 / 发布 | `package.json` 版本号 | `package-lock.json` | references/conventions.md |

## 常用命令（仓库根执行）

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 开发态（electron-vite，主进程改动自动重启、渲染层 HMR） |
| `npm run typecheck` | 类型检查（node + web 两份） |
| `npm run check` | typecheck + lint + 单测（提交前必过；pre-commit 钩子自动执行） |
| `npm run test` | 只跑单元测试 |
| `npm run test:watch` | 单元测试 watch 模式 |
| `npm run lint` / `lint:fix` | ESLint（0 error 为通过） |
| `npm run build` | 构建到 `out/` |
| `npm run dist:win` / `dist:mac` / `dist:linux` | 打包安装包 |
| `npm run docs:dev` / `docs:build` | 文档站预览 / 构建 |

环境要求 Node >= 20；`DSH_NODE` 可覆盖运行 dsh 所用的 Node 可执行文件。

## 交付前自检

- [ ] 契约类改动是否 `shared/api.ts` 与 `main/app/ipc.ts` 两处一致（类型检查会拦，但先自查）？
- [ ] 主进程联网是否都走 `httpFetch`？推送是否都走 `runtime` 的发送函数？
- [ ] 设置项是否处理了 `legacy` 与 `settingsVersion`？派生 UI 是否订阅 `settings:changed`？
- [ ] 文案是否 zh / en / hant 三处对齐？
- [ ] 缩进 4 空格、注释中文、无新增裸 `fetch` / 裸 `webContents.send`？
- [ ] 新增 / 改动的纯逻辑是否补了 `*.test.ts`，且 `npm run check`（typecheck + lint + 单测）通过？
- [ ] 有需要人工验证的运行时行为，是否在最终说明里写清复现步骤？
- [ ] 新依赖是否装对位置（前端 → `devDependencies`；主进程运行时 → `dependencies`）？
- [ ] 缩进是否 4 空格（YAML 除外）？改过 YAML 是否验证过可解析？
- [ ] 是否只改了本任务相关文件（原子提交）？
- [ ] agent 缓存 / 临时文件是否都放在 `.agents/temp/` 且已清理？
- [ ] 新增 / 改动的 UI 是否用 antdv-next（`<a-*>`），且没有引入新的 `el-*`？
- [ ] 是否避免了未经确认的 `git push`？

## 参考文件

- references/architecture.md —— 三进程、启动顺序、生命周期、窗口 / 标签、数据位置、代理范围、设置传播
- references/ipc.md —— REST 风格 IPC 契约、新增端点全流程、事件、窗口级操作
- references/main-process.md —— `app/` 与 `dsh/` 模块地图、关键导出、安装与下载链路
- references/renderer.md —— Vue 目录、Pinia、订阅 `settings:changed`、主题 / i18n、状态栏
- references/conventions.md —— 代码风格、注释、i18n、文档、Git、临时文件、验证
