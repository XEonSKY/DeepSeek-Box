# 架构总览

## 技术栈

Electron 44 · electron-vite 5 · Vite 7 · Vue 3 · TypeScript · Element Plus · Pinia · vue-i18n · @xterm/xterm。

## 三个进程

| 进程 | 目录 | 职责 |
|---|---|---|
| **主进程 main** | `src/main/` | 创建窗口与托盘、管理配置、启动 / 守护 dsh、下载与安装、应用自更新 |
| **预加载 preload** | `src/preload/` | 用 `contextBridge` 暴露 `window.api`（REST 客户端；契约 `ApiRoutes` 定义在 `shared/api.ts`） |
| **渲染进程 renderer** | `src/renderer/` | Vue 3 界面：标签页外壳、设置页、安装向导、终端 |

共享代码（类型、i18n、版本工具）放在 `src/shared/`，三边都能用。

## 主进程分层：微内核

主进程内部是**小内核 + 可插拔模块**：

- `src/main/kernel/` —— **稳定的机制层**，不认识业务名词：`runtime`（运行态原语）、`router`（唯一 `ipcMain` 落点）、`module`（`defineModule` / `ModuleRegistry`）、`operations`（进度注册表 + 取消令牌）、`treeops`（整目录删除唯一出口）、`services`（服务槽）。
- `src/main/modules/` —— **功能策略层**，一个功能一个文件，用 `defineModule` 声明自己的 IPC 路由（端点不再集中登记）。
- `src/main/app/`、`src/main/dsh/` —— 具体实现，被模块调用。

**依赖方向恒为** `modules → kernel`、`modules → app/dsh`；**模块之间不 import**，跨模块动作走 `kernel/services.ts` 的服务槽（提供方在 `onReady` 注册能力，消费方按名字取用）——这样 `modules/settings → dsh/dsh → app/settings` 之类的静态环不可能形成。`app/ipc.ts` 只是**装配器**。

## 启动流程

主进程入口 `src/main/index.ts`：

1. **dev/release 隔离**：开发态把 `userData` 指到 `"<app> (dev)"`，避免与已安装版抢单实例锁；
2. **登记配置目录迁移**：`ensureDefaultConfigMigration()`（必须在任何读设置之前）；
3. **读取启动所需设置**：是否忽略系统缩放、是否启用硬件加速；
4. **单实例锁**：未拿到锁则直接退出，第二次启动会把已有窗口置前；
5. **app ready 后**：`registerIpc()` + `runModuleReady()`（装配模块、跑模块 `onReady`）→ 建窗 → 建托盘 → 注册全局快捷键；
6. `await waitForConfigMigration()`：有待执行的配置目录迁移时先搬完（带进度广播），再继续；
7. `await migrateLegacyInstalls()`：把旧的平铺安装目录迁成版本化布局；
8. 启动配置文件监听；若 DeepSeek Harness 已存在则 `restart()` 启动 dsh；
9. 按设置检查应用更新。

## 生命周期与退出

- **关闭窗口**：默认隐藏到托盘（可在设置里改为直接退出）；关闭窗口**不**结束 dsh。
- **真正退出**：`before-quit` 先 `preventDefault()`，异步优雅停 dsh（`stopDshGracefully()`）→ 清理其余子进程 → `runModuleQuit()`（模块 `onQuit` 逆序）→ 二次放行 `app.quit()`。
- **兜底**：`process.on('exit')` 再杀一次 server 与子进程，避免孤儿进程。

## 窗口与标签模型

- 核心窗口承载三个固定站（dsh Web UI / 网页对话 / 用量充值）；核心窗口登记与接管逻辑见 `app/windowreg.ts` 与渲染层 `shell/tabs.ts`。
- 副窗口由「在新窗口打开」创建，可把标签拖入 / 拖出；核心窗口关闭后由最早的副窗口接管。
- 内嵌页面用 `<webview>`；地址栏只在动态标签显示，协议 / 搜索分流见渲染层。

## 数据与配置

- **应用设置**：配置目录下 `settings.json`（不是 Electron 的 userData）；
- **dsh 自身设置**：`~/.dsh/settings.yaml`，应用会把主题 / 语言同步过去；
- **DeepSeek Harness / Node / npm**：配置目录下按版本存放，见[DeepSeek Harness 与环境安装链路](/zh/dev/installs)。

## 设置与状态传播

- 应用设置的单一来源是配置目录下的 `settings.json`；`loadSettings()` 读取时做**一次性迁移**，由 `settingsVersion`（当前 2）控制——只有真正的老配置才改键名 / 升级默认值，用户后来手填的值不会被反复改写。改归一化逻辑时**必须保留 `legacy` 判断**。
- 渲染层保存走 `PUT /settings`：主进程落盘后**广播 `settings:changed` 给所有窗口**；配置文件监听只负责**外部改动**，对程序自己的写入刻意静默。
- 因此**凡是从设置派生状态的组件都要订阅 `settings:changed`**，漏订阅的表现就是「改完要重启才生效」；发起保存的那个窗口自己忽略这次回放（设置 store 的 `lastSaveAt`）。
- `PUT /settings` 里还会顺带做几件幂等的事：同步 dsh 主题、写开机自启登录项、更新内嵌网页的 UA 与代理、应用程序图标。

## 网络出口与代理

- **主进程里所有 HTTP 一律走 `httpFetch(scope, url, init)`**（`src/main/dsh/http.ts`），不要直接 `fetch`；`scope` 决定这次请求走不走代理（未启用代理时回落到全局 `fetch`）。
- 代理范围 `proxyScope` 有六个**互不牵连**的档位：`app`（主进程自身联网：模型 / 余额 + 内嵌网页）、`update`（应用自更新）、`dsh`（dsh 子进程联网）、`npm`（安装 / 下载）、`node`（Node 下载部署）、`registry`（版本列表 / 更新检查）。
- 落点分三处：`app` → `models.ts` + `app/webview.ts`、`app/appupdate.ts`；`dsh` → `dsh.ts` 注入的代理环境变量；`npm` / `node` / `registry` → `npmRunner.ts`、`nodeenv.ts`、`manage.ts`。三处共用 `proxyConfigFor()`。
- 代理分支只在「启用代理」时才会走到，改动后需在真机验证。

## 相关文档

- [主进程模块](/zh/dev/modules)
- [渲染进程](/zh/dev/renderer)
- [IPC 契约](/zh/dev/ipc)