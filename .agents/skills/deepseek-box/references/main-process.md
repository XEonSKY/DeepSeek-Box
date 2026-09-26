# 主进程模块地图

> 事实来源：源码 + `docs/zh/dev/modules.md`。主进程分四层：`kernel/`（微内核，机制）、
> `modules/`（功能模块，策略）、`app/`（应用自身的遗留实现，正在被 modules 收编）、`dsh/`（Harness 与运行环境）。

## 分层总览（微内核）

```text
kernel/     ← 稳定的「机制」：不认识任何业务名词，只认识模块与路由
  runtime.ts      运行态原语（唯一无外部依赖的底座：窗口/托盘/广播/退出标志）
  router.ts       Elysia 风格路由引擎（唯一 ipcMain 落点）
  module.ts       defineModule / MainModule / ModuleRegistry（模块契约 + 装配）
  operations.ts   进度注册表 + 取消令牌 + trackedOperation（纯逻辑，emit 由外部注入）
  treeops.ts      整目录删除的唯一出口（转发 dsh/fsutil 的 removeTree/removeQuietly*）
  services.ts     服务槽：provideService / useService（模块间解耦，见下）
  extroute.ts     扩展端点挂载点（固定 `/ext` 前缀；内核为扩展开的受控口子，仍走同一个 Router）
  logger.ts       全进程唯一日志入口（pino + pino-roll；目录由启动方注入，kernel 不认业务目录）
modules/    ← 可插拔的「策略」：每个功能一个文件，自己声明路由
  settings.ts  dsh.ts  env.ts  shell.ts  tabdrag.ts  appupdate.ts  configdir.ts  extensions.ts
  index.ts        allModules()：模块清单
app/ipc.ts  ← 装配器：建 Router → new ModuleRegistry(allModules()) → mountRoutes
app/… dsh/… ← 具体实现，被 modules 调用（modules 不互相 import）
```

**依赖方向是单向的**：`modules → kernel`、`modules → app/dsh`；**模块之间不 import**。
需要模块 A 触发模块 B 的动作时，走 kernel 的服务槽（例：`modules/settings` 通过
`useService(SERVICE.RESTART_DSH)` 重启 dsh，而 `RESTART_DSH` 由 `modules/dsh` 在 `onReady` 时
`provideService` 注册）——用控制反转打断 `settings → dsh/dsh → app/settings` 的静态环。

## kernel/ 新增一个模块

```ts
import { defineModule } from '../kernel/module'

export default defineModule({
    id: 'foo',
    routes: {
        GET: { '/foo': () => fooState() },
        POST: { '/foo/act': async ({ body }) => doAct(body) }
    },
    onReady: () => { /* 可选：注册服务 / 建监听 */ },
    onQuit: () => { /* 可选：清理；按注册逆序执行 */ }
})
```

- 路由按**方法**分组（`GET`/`POST`/`PUT`/`PATCH`/`DELETE`），路径必须以 `@shared/api` 的
  `ApiRoutes` 里登记过的 `"<METHOD> <path>"` 为准 —— 写错路径 / 返回值对不上 **编译期直接报错**，
  这就是 contract-first 的落点。
- `ModuleRegistry` 在 `mountRoutes` 时对重复的 `"<METHOD> <path>"` **抛错**（两个模块抢同一条路由会在启动时立刻暴露）。
- `onReady` 正序、`onQuit` 逆序（后建先拆）。`app/ipc.ts` 暴露 `runModuleReady()` / `runModuleQuit()`，
  由 `index.ts` 在 `whenReady` 与 `cleanExit` 里各调一次。

## kernel 的另外四件「机制」

- **进度注册表**（`kernel/operations.ts`）：`beginOperation` / `pushProgress`（返回「这次要不要广播」）/
  `currentProgress` / `endOperation` / `operationsSnapshot` / `isOperationRunning` / `MIN_INTERVAL_MS`。
  解决两件事：① 进度只活在面板 ref 里，切页卸载即丢 → 由**主进程**记住状态，`GET /operations`
  快照让任何页面取回；② npm / pnpm 共用一个进度通道会串台 → 每条进度都带 `kind`。顺带做节流
  （下载是每块回调一次，全转发会灌几千条 IPC）。**阶段变化与窗口外的进度一定放行**，否则进度条停在半路。
- **trackedOperation**（同上文件）：`trackedOperation(kind, emit, run)` 把「开表 → 转发节流后的进度 → `finally` 关表」
  包在四条长任务链路（node 部署 / npm / pnpm / dsh-plugin）外面，成功 / 失败 / 取消都清空。
  `emit` 是**注入**的（kernel 不认识 `broadcast`，保持纯逻辑可测）；`CHANNEL_OF` 常量把 `kind` 映射到推送通道。
- **整目录删除**（`kernel/treeops.ts`）：只转发 `dsh/fsutil` 的 `removeTree` / `removeQuietly` /
  `removeQuietlySync` / `readPkgVersion`。**红线**：任何「整目录删除」都从 `treeops` 走，
  靠 import 图把「不跟随链接 + 不阻塞主进程」变成结构约束，而不是口头约定。
- **服务槽**（`kernel/services.ts`）：`provideService(name, fn)`（重复注册抛错）/ `useService(name)`
  （未注册抛错）/ `hasService` / `resetServices` + `SERVICE` 常量。用于打断模块间静态依赖环。
- **日志**（`kernel/logger.ts`）：`initLogger(dir)` / `logger(tag)` / `writeRemoteLog(rec)` / `closeLogger()`。
  pino 实例带两个 transport —— 控制台（开发态 `pino-pretty`、发行态 JSON）+ 文件（`pino-roll` 写
  `<配置目录>/logs/dsbox.log`，5 MB 轮转 / 留 5 个历史）。
  - **目录靠注入**：kernel 不认业务目录，所以 `initLogger` 的 dir 由 `index.ts` 传 `configDir()` 进来。
  - **`pino-pretty` 只在开发态挂**：它是 devDependency，打包产物里没有；靠 `NODE_ENV` 分支避开
    MODULE_NOT_FOUND（不是 try/catch 探测）。
  - **`initLogger` 之前调用 `logger()` 也不会炸**：退化成裸 pino（只进控制台）。
  - 渲染层经 `POST /logs/renderer` 上报 warn 及以上，主进程用 `writeRemoteLog` 按级别号重新记一遍。

## app/（应用自身）

| 模块 | 职责 | 关键导出 / 说明 |
|---|---|---|
| `index.ts` | 应用入口 | 单实例锁、dev userData 隔离、whenReady 启动顺序、退出清理 |
| `settings.ts` | 设置与配置目录 | `configDir` / `loadSettings` / `persistSettings`、迁移编排、临时目录、文件监听 |
| `configmigrate.ts` | 配置目录迁移 | 计划持久化、`scanTree` / `migrateTree`、`rollbackMoves`（**全 async**：逐目录 `setImmediate` 让出事件循环，避免大目录搬迁把界面卡死） |
| `models.ts` | 模型与余额 | `readModelsInfo(consented, env)` / `readCurrentBalance(consented, env)`；读 dsh 的**合成**配置（`dshPatchLayers`）+ `.credentials.yaml`；**不依赖 electron**（`installNodeModules` 由 `ipc.ts` 注入），密钥只留主进程。两个入口都以 `settings.modelsCredConsent` 为前置：未授权时直接回 `no-consent`，**不读配置、不读凭据文件、不联网**（把关在主进程，不靠渲染层自觉）。缺 dsh 安装（无 bundle 层）时退回只看凭据引用，并区分 `dsh-missing`（提示去装）与 `no-provider`（提示去配） |
| `ipc.ts` | **装配器**（已瘦身到 ~50 行） | 建 `Router` + `new ModuleRegistry(allModules())` + `mountRoutes`；导出 `registerIpc` / `runModuleReady` / `runModuleQuit`。**不再直接登记端点** |
| `ui.ts` | 窗口 / 托盘 / 快捷键 | `createShellWindow` / `createTray` / `syncGlobalHotkey` |
| `appupdate.ts` | 应用自更新 | 解析 GitHub Releases、后台下载、事件广播；启动守卫 `runBootGuard` / `rollbackAppUpdate` / `startAutoCheckIfEnabled` **均为 async**（内部等 `restorePrevious` / `takeRollbackResult`） |
| `appslots.ts` | A/B 版本槽 | 归档旧版、生成回退脚本、启动健康守卫。文件操作（`pruneArchives` / `takeRollbackResult` / `pruneRollbackScripts` / `writeRollbackScript` / `restorePrevious` / `canWriteDir`）**全 async** |
| `bootguard.ts` | 启动守卫判定（**纯逻辑**） | `decideBootGuard`：无记录 / 记录过期 / 计数 / 触发回退 / 放弃回退，五选一 |
| `webview.ts` | 渲染参数与内嵌页面策略 | 硬件加速、webview UserAgent、代理，以及 `installWebviewPermissionPolicy()`（与 UA 同理，权限处理器**必须在建窗前**装到 `defaultSession`，晚一步先建出来的 webview 就是「未装处理器 = 默认放行一切」） |
| `webviewPermissionPolicy.ts` | 内嵌页面权限判定（**纯逻辑**） | `decidePermission` / `isTrustedRequestingUrl`（回环地址与 `file:` / `app:` 算可信）/ `PermissionMemory`（会话级「记住选择」，**不落盘**）/ `checkPermission`。判定是**失败即拒绝**：未列入名单的权限（含将来新出现的）一律拒；往名单里加权限等于把一个能力交给任意网页，改之前先读模块头注释 |
| `autolaunch.ts` | 开机自启（「启动增强」） | Windows / macOS 走 `app.setLoginItemSettings`，Linux 写 `~/.config/autostart` 的 .desktop |
| `confirmDialog.ts` | 独立确认子窗口 | 替代内嵌 `ElMessageBox.confirm`：OS 管理焦点与模态，不遮挡页面；外观由渲染层 `ConfirmWindow.vue` 负责 |
| `rollbackscript.ts` | 回退脚本纯文本构造（**纯逻辑**） | 老实现内联在 appslots.ts 的三个坑逐条规避（不靠 `tasklist | findstr` errorlevel 判存活等） |
| `const.ts` | 品牌常量 | `APP_TITLE` 等收敛处（此前 `ui.ts` 与 `ipc.ts` 各一份字面量） |
| `windowreg.ts` | 窗口登记 | 核心 / 副窗口角色与接管 |
| `contextmenu.ts` | 右键菜单 | 剪切 / 复制 / 粘贴 / 全选 |
| `appicon.ts` | 应用程序图标 | `appLogoPath` / 读写图标 |
| `http.ts`（在 `dsh/`） | 出网入口 | `httpFetch(scope, url, init)` |

> `router.ts` / `runtime.ts` / `operationProgress.ts`（现 `operations.ts`）/ `cancel.ts` **已迁进 `kernel/`**：
> `cancel.ts` 并入 `kernel/operations.ts`；`operationProgress.ts` 改名 `operations.ts` 并补上 `trackedOperation`。


## dsh/

| 模块 | 职责 | 关键导出 |
|---|---|---|
| `dsh.ts` | dsh 启停 / 端口 / 日志 | `restart` / `stopDshGracefully` / `killAllChildren` / `isDshRunning` |
| `watchdog.ts` | 守护代码 | `WATCHDOG_CODE`（脱离本进程守护 dsh） |
| `manage.ts` | 安装 / 更新 / 卸载 | `resolveInstall` / `dshInstalled` / `installDsh` / `updateDsh` / `uninstallDsh` / 版本管理 |
| `nodeenv.ts` | Node 下载部署 | `deployLocalNode` / `listNodeVersions` / `nodeStatus` |
| `npmRunner.ts` | npm 探测 / 执行 / 缓存 | `ensureBundledNpmReady` / `runNpm` / `npmCacheEnv`（`hasSystemNpm` 导出给 pnpm 的 system 来源复用） |
| `pnpmRunner.ts` | pnpm 获取 / 运行（**两种来源**：系统自带 / 内置） | `pnpmStatus`（system + bundled）/ `updatePnpm({source})`（system 走 `npm i -g pnpm`，bundled 走 tarball）/ `systemPnpmPath` / `pnpmShimEnv`（内置的 PATH 垫片）；入口解析见 `pnpmEntry.ts` |
| `download.ts` | **内核下载门面**（内核所有「下一个文件到磁盘」从这里走） | 按约定名查能力槽 `ext:xeonsky.download`，查不到才回落 `downloader.ts`（扩展停用 / 安全模式时核心功能不失效） |
| `downloader.ts` | 下载**兜底**实现 | `downloadFile`（HTTP Range 分段、去重、取消）；扩展不可用时才走到 |
| `child.ts` | 子进程共同流程（**纯编排**） | spawn → 登记 → 收日志 → 可取消 → 只 settle 一次（原在 npm / 解压三处各写一遍） |
| `logbus.ts` | 日志环形缓冲 + 子进程登记表 | 不依赖 dsh 服务状态，被整条 dsh 链路共用 |
| `plugins.ts` | dsh 插件（profile 组合包）管理 | 读取 / 启停 `dsh.profile.bundles`，经 `dsh plugin --profile` 安装 / 卸载 |
| `pluginManifest.ts` | 插件清单**纯逻辑** | 不碰 fs、不 import electron；文件读写与 pnpm 调用分别在 plugins.ts / pnpmRunner.ts |
| `ptcNode.ts` / `ptcNodeSync.ts` | 给 dsh PTC（run_code）worker 指定真正的 node | 把 `nodeExecutable` 写进 **home 级** patch 层（home 层压过 profile 层）；修复 electron.exe 冒充 Node 被 dsh worker 清环境后崩溃的问题 |
| `installs.ts` | 版本化目录 | 见下 |
| `pnpmEntry.ts` | 内置 pnpm 入口解析（**纯逻辑**） | `pnpmEntryRel` / `pnpmEntryIn` / `isPnpmPackageReady`。⚠️ 入口名随 pnpm 大版本变（12+ = `package/bin/pnpm.mjs`，≤ 11 = `package/bin/pnpm.cjs`），**不要写死文件名**；manifest 的 `bin.pnpm` 在 12 指向根级 sh 脚本，node 跑不了 |
| `tools.ts` | 路径解析 | `localNodeExecPath` / `nodeRuntimeFor` / `resolveDshModule` / `findSystemNode` |
| `semver.ts` | 版本工具 | `sortVersionsDesc` / `filterByPrerelease` / `pickLatest` |
| `registry.ts` | npm 源定义与挑选（**纯逻辑**） | `REGISTRY_IDS` / `registryBase` / `rankRegistries` / `pickFastestRegistry` |
| `speed.ts` | 镜像源测速（走 `httpFetch`） | `measureRegistrySpeed` |
| `http.ts` | 主进程 HTTP 出口（代理生效点） | `httpFetch(scope, url, init)` / `proxyConfigFor` |
| `net.ts` | 代理辅助 | 代理配置相关 |
| `cordisPatch.ts` | Cordis patch 层纯文本（**纯逻辑**） | `PATCH_FILENAME` / `parsePatchLayer` / `parsePatchEntries` / `composePatchEntries` / `composePatchConfig` / `readConfigString` / `mergePatchEntryConfig` |
| `dshHome.ts` | dsh home 与 profile 路径（**纯逻辑**） | `DSH_PROFILE` / `dshHomeDir` / `homePatchFile` / `profilesRoot` / `profileDir` / `hostProfileDir` / `profilePatchFile` / `profileManifestFile`；home 解析语义对齐 dsh 的 `resolveDshHome`（空白覆盖视为未设置、展开 `~`、规范化为绝对路径，改之前先看该文件的注释） |
| `providers.ts` | 供应商路由与服务商分组（**纯逻辑**） | `collectProviderRoutes` / `groupProviderRoutes` / `routesFromCredentials`（dsh 未安装时的凭据兜底） + `DEEPSEEK_BASE` / `isHttpURL` / `joinURL` / `defaultKeyEnv` |
| `dshPatchLayers.ts` | 收集 dsh 的**有效** patch 层（**纯逻辑**） | `collectPatchLayers(installNodeModules)`（bundle 层 → profile 层 → home 层）、`composeMountedConfig(layers)`（**条目存在即入表**）。⚠️ dsh 的默认供应商写在 **bundle 层**（`dsh-base` 的 `agent-default-model`，以及只有 id/name、没有 config 的 `llm-deepseek`），只读用户层会让模型页显示「共 0 个供应商」 |
| `fsutil.ts` | 文件系统助手 | `removeTree` / `removeQuietly`（**均为 async**）、`removeQuietlySync`（只给启动期无法 await 的同步迁移用）、`readPkgVersion`。删除**不跟随符号链接 / Windows 目录联接**（与官方 desktop 的 `removeOwnedDirectory` 同策略）。⚠️ **新增的「整目录删除」一律走 kernel 的 `treeops.ts`（转发这几个函数）**，不要直接写 `fs.rmSync(recursive)`：dsh / pnpm 的安装目录里到处是链接；且一个版本目录动辄几万个小文件，**同步删会把主进程独占到界面卡死**（这正是「操作时整个程序会卡住」的成因之一）。实测 Node 的 `rmSync` 目前也不跟随链接，因此「不跟随」是**把语义写死 + 回归护栏**，不是修某个现存 bug |

## settings.ts 关键导出（改设置必看）

- 目录：`configDir` / `configDirInfo` / `setConfigDir` / `revertConfigDir` / `ensureDefaultConfigMigration` / `runConfigMigration` / `waitForConfigMigration` / `cancelConfigMigration` / `defaultWorkspaceDir`。
- 读写：`readDiskSettings` / `loadSettings` / `persistSettings` / `normalizeNpmSource` / `normalizeDownloadThreads` / `normalizeProxyScope`。
- i18n 与主题同步：`dshLocale` / `writeDshLocale`（读写 dsh 的 `locale` 条目）/ `uiLocale` / `mt` / `syncDshTheme`（写 dsh 的 `ui-theme` 条目）/ `syncNativeTheme`；**都落在 profile 层的 `cordis.patch.yml`**（写 home 层会被 dsh 的设置表单拒绝）。
- 监听：`startConfigWatchers` / `stopConfigWatchers` / `rewatchConfig`。
- 临时目录：`tempDownloadDir`（`temp/download`）/ `tempNpmDir`（`temp/npm`）。

**红线**：`loadSettings()` 的归一化必须保留 `legacy` 判断（由 `settingsVersion` 控制）；不要反复改写用户手填值。

## installs.ts 与版本化目录

`InstallKind` 取 `node` / `npm` / `pnpm` / `dsh`：

```text
<配置目录>/
├─ node/<版本>/           Node 运行时（含自带 npm）
├─ npm/<版本>/package/    应用代管的内置 npm
├─ pnpm/<版本>/package/   应用代管的内置 pnpm（dsh 插件安装用）
└─ dsh/<版本>/            内置 DeepSeek Harness
```

每个根目录下 `.active` 记录当前生效版本。关键 API：`installRoot` / `versionDir` / `resolveActive` / `isVersionComplete` / `activeVersion` / `setActiveVersion` / `listInstalled` / `prepareVersionDir` / `removeVersion` / `migrateLegacyInstalls`。

**完整性很关键**：搬迁时被占用的文件（典型是运行中的 `node.exe`）可能没搬进来。残缺目录一律当不存在；`moveFlatInto` 在关键文件未落位时拒绝写 `.active`。各类型的判据是 `keyRelPath`，**pnpm 例外** —— 它按入口候选判（见 `pnpmEntry.ts`）。

## 下载 / 取消 / 解压 / npm 缓存

- **两层结构**：能力在内置扩展 `xeonsky.download`（`src/extensions/xeonsky.download/`：分段、跨会话断点续传、令牌桶限速、重试、大小校验、`tasks.json` 队列持久化）；内核调用方（Node 发行包、内置 npm / pnpm）走门面 `dsh/download.ts`，按约定名查能力槽，查不到才回落 `downloader.ts`。网络栈仍在内核——扩展引擎只经注入的 `OpenStream`（= `net.stream`）发请求，「设置 → 网络 → 代理」照常生效；断点续传靠 `.part` 旁的 `.part.json` 侧车。
- 兜底 `downloader.ts` 的 `downloadFile`：HTTP Range 并发（默认 4，设置可调最多 16）；小于 1MB 或服务端不支持 Range 时退化单流；带重试与临时文件清理；完成后再搬到目标。
- **同一目标去重**：`inFlightDownloads` 按小写化最终路径合并，后到者订阅同一任务；`isFileDownloading()` 查询；支持 `signal` 取消。
- 取消是单活动令牌（`kernel/operations.ts` 的 `beginCancelable` / `cancelActive` / `CANCELED_MESSAGE`，
  原 `dsh/cancel.ts` 已并入），下载与解压都挂上去；路由 `POST /installs/cancel`；取消后返回
  `{ ok:false, canceled:true }`，渲染层不当作错误。
- 解压是独立阶段，进度事件携带 `phase: 'download' | 'extract'`；解压时 UI 切不确定动画。
- npm 缓存统一注入 `npm_config_cache=tempNpmDir()`，不写 `~/.npm`。

## 安全与网络红线

- 所有主进程 HTTP 走 `httpFetch(scope, url, init)`；`scope` 取 `app` / `update` / `dsh` / `npm` / `node` / `registry`，三处共用 `proxyConfigFor()`。
- 新增出网点时：先确定属于哪个 scope，再接到对应落点，不要在别处裸 `fetch`。
- 模型 / 余额凭据读取只留主进程，渲染层永远拿不到密钥明文。
- **授权是主进程的前置，不是界面行为**：读凭据的入口都以 `settings.modelsCredConsent` 为门槛
  （未授权 → `no-consent`，不读配置、不读 `.credentials.yaml`、不联网）。不要让「渲染层不请求」成为唯一防线。

## 在无 electron 环境下验证主进程模块（探针套路）

本仓库**已无单测**；想验证**副作用行为**（读不读文件、走不走网络）等纯逻辑之外的行为时，用临时探针跑真实实现：

1. 把被验证模块及其依赖链复制到 `.agents/temp/`，批量改写导入：
   - `@shared/*` → 绝对 `file:///D:/Workspace/client/dsbox/src/shared/x.ts`；
   - 源码里的相对导入没有扩展名，而 Node 的类型剥离模式**要求显式 `.ts`**，所以要改成 `./stage-x.ts`；
   - `yaml` 这类包不用改 —— 从 `.agents/temp/` 向上能解析到工作区 `node_modules`。
2. 依赖链里若有 `import 'electron'`（如 `dsh/http.ts`），把**那一条**换成存根（`export async function httpFetch() { throw new Error('stub') }`）——
   探针环境没有 electron，整条链都加载不了。
3. 要数「读了几次文件」，**在 `await import()` 完成之后再** patch `fs.readFileSync`：
   否则 yaml 等依赖加载自己的源码会被算进业务读取（实测会多出 70+ 次假阳性）。
4. 例：`.agents/temp/verify-models-consent.mjs`（`consented=false` 断言 0 次读取 / 0 次请求，
   `consented=true` 断言读到 `.credentials.yaml` 且发起了余额查询）。
5. 造「dsh 未安装 / 无凭据 / 无配置」这几种环境时，**把 `installNodeModules` 传 null** 并用
   `process.env.DSH_HOME` 指向临时目录即可（`dshHomeDir()` 每次调用都读环境变量），不必动用户的真实目录。

