# 架构、启动与数据位置

> 本页是 `docs/zh/dev/architecture.md`、`config-dir.md` 的「AI 可执行版」；冲突时以源码为准。

## 三个进程

| 进程 | 目录 | 职责 | 边界 |
|---|---|---|---|
| 主进程 main | `src/main/` | 窗口 / 托盘、设置、启动守护 dsh、下载安装、自更新、IPC 路由 | 唯一可直接用 Electron 主进程 API 的层 |
| 预加载 preload | `src/preload/` | `contextBridge` 暴露 `window.api` | 唯一碰 `ipcRenderer` 的文件 |
| 渲染进程 renderer | `src/renderer/` | Vue 3 界面：标签页外壳、设置、向导、终端 | 只能通过 `window.api` 调主进程 |

共享代码（类型、i18n、版本工具）在 `src/shared/`，三边都能 import；别名 `@shared` 指向它，`@` 指向 `src/renderer/src`（见 `electron.vite.config.ts`）。

## 启动顺序（`src/main/index.ts`）

1. **dev / release 隔离**：开发态把 `userData` 指向 `"<app> (dev)"`，避免与已安装版抢单实例锁。
2. `ensureDefaultConfigMigration()`：登记配置目录迁移，**必须在任何读设置之前**。
3. 读取启动所需设置（忽略系统缩放、硬件加速）。
4. **单实例锁**：拿不到锁直接退出；第二次启动把已有窗口置前。
5. `app ready` 后：注册 IPC → 建窗 → 建托盘 → 注册全局快捷键。
6. `await waitForConfigMigration()`：有待迁移先搬完（带进度广播）再继续。
7. `await migrateLegacyInstalls()`：旧平铺安装目录迁成版本化布局。
8. 启动配置文件监听；dsh 已存在则 `restart()` 启动。
9. 按设置检查应用更新。

**改动启动逻辑时注意**：步骤 2 与 6 的顺序是配置目录可读性的前提，不要调换。

## 生命周期与退出

- **关闭窗口**：默认隐藏到托盘（设置可改为直接退出）；**关闭窗口不结束 dsh**。
- **真正退出**：`before-quit` 先 `preventDefault()` → 异步 `stopDshGracefully()` → 清理其余子进程 → 二次放行 `app.quit()`。
- **兜底**：`process.on('exit')` 再杀一次 server 与子进程，避免孤儿进程。

## 窗口与标签

- 核心窗口承载三个固定站（dsh Web UI / 网页对话 / 用量充值）；核心窗口登记与接管见 `src/main/app/windowreg.ts` 与渲染层 `src/renderer/src/shell/tabs.ts`。
- 副窗口由「在新窗口打开」创建，标签可拖入 / 拖出；核心窗口关闭后由最早的副窗口接管。
- 内嵌页面用 `<webview>`；地址栏只在动态标签显示，协议 / 搜索分流在渲染层。
- 窗口级操作（缩放 / 最小化 / 关闭 / 对话框）从 `ctx.event.sender` 反查发起请求的壳窗口，**不要用全局主窗口**。

## 数据与配置位置

- **应用设置**：配置目录下 `settings.json`（不是 Electron userData）。
- **dsh 自身设置**：`~/.dsh/settings.yaml`；应用把主题 / 语言同步过去。
- **Node / npm / dsh**：配置目录下按版本存放（见 references/main-process.md）。
- **配置目录默认**：打包 `~/.dsbox/release`；开发 `~/.dsbox/dev`。
- **覆盖指针**：`<userData>/config-dir`（与配置目录解耦，先于 `settings.json` 读取）。
- **迁移计划**：`<userData>/config-migration.json`。
- **临时下载 / npm 缓存**：工作目录下 `temp/download` 与 `temp/npm`。

## 配置目录两阶段迁移

**第一阶段（设置时）**：`setConfigDir()` 不立即搬迁，只写迁移计划；存在计划时 `configDir()` 仍返回旧目录，保证重启前设置可读。

**第二阶段（重启引导）**：建窗后 `await waitForConfigMigration()` 才启动 dsh 与监听；由 `main/app/configmigrate.ts` 执行：`scanTree` 统计 → `migrateTree` 逐项搬迁（同盘整目录 `rename`，跨盘或目标存在则递归 copy + unlink，记 journal）→ 每项广播 `configdir:migration` → 成功才指向新位置。**取消**则 `rollbackMoves` 逆序搬回并固定回旧目录。搬迁失败不删源文件，避免丢数据。

## 网络出口与代理

- 主进程所有 HTTP 走 `httpFetch(scope, url, init)`（`src/main/dsh/http.ts`）；未启用代理时回落到全局 `fetch`。
- `proxyScope` 六个互不牵连的档位：`app`（主进程自身联网：模型 / 余额 + 内嵌网页）、`update`（应用自更新）、`dsh`（dsh 子进程）、`npm`（安装 / 下载）、`node`（Node 下载部署）、`registry`（版本列表 / 更新检查）。
- 落点三处：`app` → `models.ts` + `app/webview.ts`、`app/appupdate.ts`；`dsh` → `dsh.ts` 注入的代理环境变量；`npm` / `node` / `registry` → `npmRunner.ts`、`nodeenv.ts`、`manage.ts`。三处共用 `proxyConfigFor()`。
- 代理分支只在「启用代理」时走到，改完需真机验证。

## 设置与状态传播

- 单一来源：配置目录 `settings.json`；`loadSettings()` 读取时按 `settingsVersion`（当前 2）做**一次性迁移**。
- 渲染层保存走 `PUT /settings`：主进程落盘后**广播 `settings:changed` 给所有窗口**；文件监听只负责**外部改动**，对程序自身写入刻意静默。
- **凡是从设置派生状态的组件都要订阅 `settings:changed`**；发起保存的窗口忽略这次回放（设置 store 的 `lastSaveAt`）。
- `PUT /settings` 顺带做幂等操作：同步 dsh 主题、写开机自启、更新内嵌网页 UA 与代理、应用程序图标。
