# 主进程模块

主进程按**微内核**分层：`kernel/` 是稳定的机制层（不认识业务名词），`modules/` 是功能策略层
（每个功能一个文件、自己声明 IPC 路由），`app/` 与 `dsh/` 是具体实现。依赖方向恒为
`modules → kernel`、`modules → app/dsh`；**模块之间不 import**，跨模块动作走 `kernel/services.ts` 的服务槽。

## kernel/（机制）

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `runtime.ts` | 运行态原语（唯一无外部依赖的底座） | 托盘 / 退出标志 / `broadcast` / `sendToWindow` / `sendToWcId` / `sendCore` |
| `router.ts` | IPC 路由引擎（**唯一 `ipcMain` 落点**） | `Router`：Elysia 风格链式路由、`:name` 路径参数、先字面量后模板匹配 |
| `module.ts` | 模块契约与装配 | `defineModule` / `MainModule` / `ModuleRegistry`（`mountRoutes` / `runReady` / `runQuit`）；重复路由装配期抛错 |
| `operations.ts` | 「进行中的操作」注册表 + 取消令牌（**纯逻辑**） | `beginOperation` / `pushProgress` / `operationsSnapshot` / `trackedOperation` / `beginCancelable` / `cancelActive` |
| `treeops.ts` | 整目录删除唯一出口 | 转发 `dsh/fsutil` 的 `removeTree` / `removeQuietly` / `removeQuietlySync` / `readPkgVersion` |
| `services.ts` | 服务槽（打断模块间静态环） | `provideService` / `useService` / `hasService` / `SERVICE` |
| `extroute.ts` | 扩展端点挂载点（固定 `/ext` 前缀） | `bindExtRouter` / `registerExtRoute`：扩展端点仍进同一条 Router，但无法伪装成内置端点 |
| `logger.ts` | 全进程唯一日志入口（pino + pino-roll） | `initLogger` / `logger(tag)` / `writeRemoteLog` / `closeLogger`；目录由 `index.ts` 注入，kernel 不认业务目录 |

## modules/（功能策略）

每个模块用 `defineModule({ id, routes, onReady?, onQuit? })` 声明；路由按方法（`GET` / `POST` /
`PUT` / `PATCH` / `DELETE`）分组，路径必须是 `src/shared/api.ts` 的 `ApiRoutes` 里登记过的
`"<METHOD> <path>"`，写错会**编译期报错**。

| 模块 | 覆盖端点 |
|---|---|
| `settings.ts` | `/settings*`、`/locale`、`/logs`、`/operations` |
| `dsh.ts` | `/dsh*`（启停 / 更新 / 安装） |
| `env.ts` | `/env`、`/node/*`、`/npm/*`、`/pnpm/*`、`/versions/*`、`/registries/speed`、`/installs/cancel` |
| `shell.ts` | `/shell/*`、`/windows/*`、`/dialog/*`、`/hotkeys/state`、`/webview/info` |
| `tabdrag.ts` | `/tab-drag*`（跨窗口拖标签） |
| `appupdate.ts` | `/app/meta`、`/app/update/*`、`/app/relaunch`、`/app/quit` |
| `configdir.ts` | `/config-dir*`、`/models/*`、`/icons*` |
| `extensions.ts` | `GET /extensions`、`PUT /extensions/:id/enabled`、`POST /extensions/:id/forgive`、`POST /extensions/:id/exit-safe-mode` | 扩展管理：内核与扩展层唯一桥，装配期把路由 / 广播落点交给加载器 |

`index.ts` 汇总 `allModules()`；`app/ipc.ts` 是装配器（建 `Router` + `new ModuleRegistry(allModules())` + `mountRoutes`）。

## app/（应用自身实现）

| 模块 | 职责 | 关键导出 / 说明 |
|---|---|---|
| `index.ts` | 应用入口 | 单实例锁、dev userData 隔离、whenReady 启动顺序、退出清理 |
| `settings.ts` | 设置与配置目录 | `configDir()` / `loadSettings()` / `saveSettings()`；配置目录迁移编排；`tempDownloadDir()` / `tempNpmDir()`；文件监听 |
| `configmigrate.ts` | 配置目录迁移实现 | 计划持久化、`scanTree` / `migrateTree`、`rollbackMoves`（**全 async**，逐目录让出事件循环） |
| `models.ts` | 模型与余额 | `readModelsInfo()` / `readCurrentBalance()`；读 dsh 的 cordis patch 层 / `.credentials.yaml`，按令牌合并服务商，联网查询模型目录与余额；**不依赖 electron，密钥只留在主进程** |
| `ipc.ts` | **装配器** | 建 `Router` + `ModuleRegistry(allModules())`；导出 `registerIpc` / `runModuleReady` / `runModuleQuit`。**不再登记端点** |
| `ui.ts` | 窗口 / 托盘 / 快捷键 | `createShellWindow` / `createTray` / `syncGlobalHotkey` |
| `appupdate.ts` | 应用自更新 | 解析 GitHub Releases、后台下载、事件广播；启动守卫为 async |
| `appslots.ts` | A/B 版本槽 | 归档旧版、生成回退脚本、启动健康守卫（文件操作全 async） |
| `webview.ts` | 渲染参数与内嵌策略 | 硬件加速、webview UserAgent、代理、`installWebviewPermissionPolicy()` |
| `webviewPermissionPolicy.ts` | 内嵌页面权限判定（纯逻辑） | `decidePermission` / `isTrustedRequestingUrl`；失败即拒绝，放宽名单前先读模块头注释 |
| `autolaunch.ts` | 开机自启（「启动增强」） | Windows / macOS 走 `app.setLoginItemSettings`，Linux 写 `~/.config/autostart` 的 .desktop |
| `confirmDialog.ts` | 独立确认子窗口 | 替代内嵌弹层，OS 管理焦点与模态；外观由渲染层 `ConfirmWindow.vue` 负责 |
| `rollbackscript.ts` | 回退脚本纯文本构造（纯逻辑） | 不 import electron；规避 `tasklist | findstr` 判存活等三个坑 |
| `const.ts` | 品牌常量 | `APP_TITLE` 等的收敛处 |
| `windowreg.ts` | 窗口登记 | 核心 / 副窗口角色与接管 |
| `contextmenu.ts` | 右键菜单 | 剪切 / 复制 / 粘贴 / 全选 |
| `appicon.ts` | 应用程序图标 | `appLogoPath` / 读写图标 |

## dsh/

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `dsh.ts` | dsh 启停 / 端口 / 日志 | `restart` / `stopDshGracefully` / `killAllChildren` / `isDshRunning`；watchdog 子进程 |
| `watchdog.ts` | watchdog 代码 | `WATCHDOG_CODE`（脱离本进程守护 dsh） |
| `manage.ts` | DeepSeek Harness 安装 / 更新 / 卸载 | `resolveInstall` / `dshInstalled` / `performUpdateCheck` / `listVersions` / `installDsh` / `updateDsh` / `uninstallDsh` / `listInstalledDshVersions` / `useDshVersion` / `removeInstalledDshVersion` |
| `nodeenv.ts` | Node 下载部署 | `deployLocalNode` / `listNodeVersions` / `nodeStatus` / 版本管理 |
| `npmRunner.ts` | npm 探测 / 执行 / 缓存 | `ensureBundledNpmReady` / `runNpm` / `listNpmVersions` / `npmCacheEnv` |
| `pnpmRunner.ts` | pnpm 获取 / 运行（系统自带 / 内置两种来源） | `pnpmStatus` / `updatePnpm` / `systemPnpmPath` / `pnpmShimEnv`；入口解析见 `pnpmEntry.ts` |
| `download.ts` | **内核下载门面** | 内核所有「下一个文件到磁盘」从这里走：按约定名查能力槽 `ext:xeonsky.download`，查不到才回落 `downloader.ts` |
| `downloader.ts` | 下载兜底实现 | `downloadFile`（HTTP Range 分段、去重、取消）；扩展停用 / 安全模式时才走到 |
| `child.ts` | 子进程共同流程（纯编排） | spawn → 登记 → 收日志 → 可取消 → 只 settle 一次 |
| `logbus.ts` | 日志环形缓冲 + 子进程登记表 | 不依赖 dsh 服务状态，被整条 dsh 链路共用 |
| `pluginManifest.ts` | dsh profile / 组合包清单**纯读取** | 不碰 fs、不 import electron；`readBundleList` / `readBundlePatchFiles` / `requiredBundles`，供 `dshPatchLayers.ts` 合成有效配置层 |
| `ptcNode.ts` / `ptcNodeSync.ts` | 给 dsh PTC worker 指定真正的 node | 把 `nodeExecutable` 写进 home 级 patch 层，修复 electron.exe 冒充 Node 被 worker 清环境后崩溃 |
| `installs.ts` | 版本化目录 | `installRoot` / `versionDir` / `activeVersion` / `setActiveVersion` / `resolveActive` / `isVersionComplete` / `listInstalled` / `removeVersion` / `migrateLegacyInstalls`；`InstallKind` 取 `node` / `npm` / `pnpm` / `dsh` |
| `tools.ts` | 路径解析 | `localNodeExecPath` / `nodeRuntimeFor` / `resolveDshModule` / `findSystemNode` |
| `semver.ts` | 版本工具 | `sortVersionsDesc` / `filterByPrerelease` / `compareVersions` / `pickLatest` |
| `net.ts` | 代理 | 代理相关辅助 |

## extensions/ 与扩展层

扩展框架与登记表在 `src/main/extensions/`（`loader/` / `system/` / `builtin/`），内置与系统扩展的业务代码
在顶层 `src/extensions/<id>/`（一扩展一目录：`main.ts` + `manifest.ts` + 可选 `*.vue`）。现有
`xeonsky.download`（下载）/ `xeonsky.extm`（扩展管理页 + 扩展包管理 + 内置 7-Zip 核心），
以及 `system.*` 五个系统能力扩展。扩展只能经 `ExtContext`（主进程）与 `src/extensions/renderer-api.ts`
（渲染层）触达内核，端点固定走 `/ext/...` 前缀（`kernel/extroute.ts`）。

::: tip
逐模块细节见对应开发文档：安装链路见[DeepSeek Harness 与环境安装链路](/zh/dev/installs)，配置目录见[配置目录](/zh/dev/config-dir)，更新见[应用自更新](/zh/dev/app-update)。
:::
