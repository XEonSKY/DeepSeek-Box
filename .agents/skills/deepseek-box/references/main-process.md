# 主进程模块地图

> 事实来源：源码 + `docs/zh/dev/modules.md`。主进程分 `app/`（应用自身）与 `dsh/`（Harness 与运行环境）。

## app/

| 模块 | 职责 | 关键导出 / 说明 |
|---|---|---|
| `index.ts` | 应用入口 | 单实例锁、dev userData 隔离、whenReady 启动顺序、退出清理 |
| `settings.ts` | 设置与配置目录 | `configDir` / `loadSettings` / `persistSettings`、迁移编排、临时目录、文件监听 |
| `configmigrate.ts` | 配置目录迁移 | 计划持久化、`scanTree` / `migrateTree`、`rollbackMoves` |
| `models.ts` | 模型与余额 | `readModelsInfo` / `readCurrentBalance`；读取 dsh 的 `settings.yaml` / `.credentials.yaml`；**不依赖 electron，密钥只留主进程** |
| `ipc.ts` | 全部 IPC 端点 | 用 `Router` 登记 REST 路由 |
| `router.ts` | IPC 路由引擎 | Elysia 风格链式路由、`:name` 参数、唯一通道分发 |
| `ui.ts` | 窗口 / 托盘 / 快捷键 | `createShellWindow` / `createTray` / `syncGlobalHotkey` |
| `appupdate.ts` | 应用自更新 | 解析 GitHub Releases、后台下载、事件广播 |
| `appslots.ts` | A/B 版本槽 | 归档旧版、生成回退脚本、启动健康守卫 |
| `webview.ts` | 渲染参数 | 硬件加速、webview UserAgent |
| `windowreg.ts` | 窗口登记 | 核心 / 副窗口角色与接管 |
| `runtime.ts` | 运行态 | 托盘、退出标志、广播发送函数 |
| `contextmenu.ts` | 右键菜单 | 剪切 / 复制 / 粘贴 / 全选 |
| `http.ts`（在 `dsh/`） | 出网入口 | `httpFetch(scope, url, init)` |

## dsh/

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `dsh.ts` | dsh 启停 / 端口 / 日志 | `restart` / `stopDshGracefully` / `killAllChildren` / `isDshRunning` |
| `watchdog.ts` | 守护代码 | `WATCHDOG_CODE`（脱离本进程守护 dsh） |
| `manage.ts` | 安装 / 更新 / 卸载 | `resolveInstall` / `dshInstalled` / `installDsh` / `updateDsh` / `uninstallDsh` / 版本管理 |
| `nodeenv.ts` | Node 下载部署 | `deployLocalNode` / `listNodeVersions` / `nodeStatus` |
| `npmRunner.ts` | npm 探测 / 执行 / 缓存 | `ensureBundledNpmReady` / `runNpm` / `npmCacheEnv` |
| `downloader.ts` | 多线程下载 | `downloadFile`（HTTP Range 分段、去重、取消） |
| `cancel.ts` | 取消令牌 | `beginCancelable` / `cancelActive` / `CANCELED_MESSAGE` |
| `installs.ts` | 版本化目录 | 见下 |
| `tools.ts` | 路径解析 | `localNodeExecPath` / `nodeRuntimeFor` / `resolveDshModule` / `findSystemNode` |
| `semver.ts` | 版本工具 | `sortVersionsDesc` / `filterByPrerelease` / `pickLatest` |
| `net.ts` | 代理辅助 | 代理配置相关 |

## settings.ts 关键导出（改设置必看）

- 目录：`configDir` / `configDirInfo` / `setConfigDir` / `revertConfigDir` / `ensureDefaultConfigMigration` / `runConfigMigration` / `waitForConfigMigration` / `cancelConfigMigration` / `defaultWorkspaceDir`。
- 读写：`readDiskSettings` / `loadSettings` / `persistSettings` / `normalizeNpmSource` / `normalizeDownloadThreads` / `normalizeProxyScope`。
- i18n 与主题同步：`dshLocale` / `writeDshLocale` / `uiLocale` / `mt` / `syncDshTheme` / `syncNativeTheme`。
- 监听：`startConfigWatchers` / `stopConfigWatchers` / `rewatchConfig`。
- 临时目录：`tempDownloadDir`（`temp/download`）/ `tempNpmDir`（`temp/npm`）。

**红线**：`loadSettings()` 的归一化必须保留 `legacy` 判断（由 `settingsVersion` 控制）；不要反复改写用户手填值。

## installs.ts 与版本化目录

`InstallKind` 取 `node` / `npm` / `dsh`：

```text
<配置目录>/
├─ node/<版本>/           Node 运行时（含自带 npm）
├─ npm/<版本>/package/    应用代管的内置 npm
└─ dsh/<版本>/            内置 DeepSeek Harness
```

每个根目录下 `.active` 记录当前生效版本。关键 API：`installRoot` / `versionDir` / `resolveActive` / `isVersionComplete` / `activeVersion` / `setActiveVersion` / `listInstalled` / `prepareVersionDir` / `removeVersion` / `migrateLegacyInstalls`。

**完整性很关键**：搬迁时被占用的文件（典型是运行中的 `node.exe`）可能没搬进来。残缺目录一律当不存在；`moveFlatInto` 在关键文件未落位时拒绝写 `.active`。

## 下载 / 取消 / 解压 / npm 缓存

- `downloadFile` 用 HTTP Range 并发（默认 4，设置可调最多 16）；小于 1MB 或服务端不支持 Range 时退化单流；带重试与临时文件清理；完成后再搬到目标。
- **同一目标去重**：`inFlightDownloads` 按小写化最终路径合并，后到者订阅同一任务；`isFileDownloading()` 查询；支持 `signal` 取消。
- 取消是单活动令牌（`cancel.ts`），下载与解压都挂上去；路由 `POST /installs/cancel`；取消后返回 `{ ok:false, canceled:true }`，渲染层不当作错误。
- 解压是独立阶段，进度事件携带 `phase: 'download' | 'extract'`；解压时 UI 切不确定动画。
- npm 缓存统一注入 `npm_config_cache=tempNpmDir()`，不写 `~/.npm`。

## 安全与网络红线

- 所有主进程 HTTP 走 `httpFetch(scope, url, init)`；`scope` 取 `app` / `update` / `dsh` / `npm` / `node` / `registry`，三处共用 `proxyConfigFor()`。
- 新增出网点时：先确定属于哪个 scope，再接到对应落点，不要在别处裸 `fetch`。
- 模型 / 余额凭据读取只留主进程，渲染层永远拿不到密钥明文。
