# 架构总览

## 技术栈

Electron 44 · electron-vite 5 · Vite 7 · Vue 3 · TypeScript · Element Plus · Pinia · vue-i18n · @xterm/xterm。

## 三个进程

| 进程 | 目录 | 职责 |
|---|---|---|
| **主进程 main** | `src/main/` | 创建窗口与托盘、管理配置、启动 / 守护 dsh、下载与安装、应用自更新 |
| **预加载 preload** | `src/preload/` | 用 `contextBridge` 暴露 `window.api`（类型 `RendererApi` 定义在 `shared/types.ts`） |
| **渲染进程 renderer** | `src/renderer/` | Vue 3 界面：标签页外壳、设置页、安装向导、终端 |

共享代码（类型、i18n、版本工具）放在 `src/shared/`，三边都能用。

## 启动流程

主进程入口 `src/main/index.ts`：

1. **dev/release 隔离**：开发态把 `userData` 指到 `"<app> (dev)"`，避免与已安装版抢单实例锁；
2. **登记配置目录迁移**：`ensureDefaultConfigMigration()`（必须在任何读设置之前）；
3. **读取启动所需设置**：是否忽略系统缩放、是否启用硬件加速；
4. **单实例锁**：未拿到锁则直接退出，第二次启动会把已有窗口置前；
5. **app ready 后**：注册 IPC → 建窗 → 建托盘 → 注册全局快捷键；
6. `await waitForConfigMigration()`：有待执行的配置目录迁移时先搬完（带进度广播），再继续；
7. `await migrateLegacyInstalls()`：把旧的平铺安装目录迁成版本化布局；
8. 启动配置文件监听；若 DeepSeek Harness 已存在则 `restart()` 启动 dsh；
9. 按设置检查应用更新。

## 生命周期与退出

- **关闭窗口**：默认隐藏到托盘（可在设置里改为直接退出）；关闭窗口**不**结束 dsh。
- **真正退出**：`before-quit` 先 `preventDefault()`，异步优雅停 dsh（`stopDshGracefully()`）→ 清理其余子进程 → 二次放行 `app.quit()`。
- **兜底**：`process.on('exit')` 再杀一次 server 与子进程，避免孤儿进程。

## 窗口与标签模型

- 核心窗口承载三个固定站（dsh Web UI / 网页对话 / 用量充值）；核心窗口登记与接管逻辑见 `app/windowreg.ts` 与渲染层 `shell/tabs.ts`。
- 副窗口由「在新窗口打开」创建，可把标签拖入 / 拖出；核心窗口关闭后由最早的副窗口接管。
- 内嵌页面用 `<webview>`；地址栏只在动态标签显示，协议 / 搜索分流见渲染层。

## 数据与配置

- **应用设置**：配置目录下 `settings.json`（不是 Electron 的 userData）；
- **dsh 自身设置**：`~/.dsh/settings.yaml`，应用会把主题 / 语言同步过去；
- **DeepSeek Harness / Node / npm**：配置目录下按版本存放，见[DeepSeek Harness 与环境安装链路](/zh/dev/installs)。

## 相关文档

- [主进程模块](/zh/dev/modules)
- [渲染进程](/zh/dev/renderer)
- [IPC 契约](/zh/dev/ipc)