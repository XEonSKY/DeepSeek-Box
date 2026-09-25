# DeepSeek Harness 与环境安装链路

本页说明 DeepSeek Harness、Node、npm 的下载与安装：版本化目录、下载器、取消、解压阶段与 npm 缓存。

## 版本化安装目录

Node、npm 与 DeepSeek Harness 都按版本分开存放，多版本并存：

```text [配置目录布局]
<配置目录>/
├─ node/<版本>/           Node 运行时（含自带的 npm）
├─ npm/<版本>/package/    应用代管的内置 npm
└─ dsh/<版本>/            内置 DeepSeek Harness（node_modules/@deepseek-ai/dsh）
```

每个根目录下的 `.active` 记录当前生效版本。核心 API 在 `main/dsh/installs.ts`（`InstallKind` 取 `node` / `npm` / `dsh`）：

| 函数 | 作用 |
|---|---|
| `installRoot(kind)` / `versionDir(kind, v)` | 拼路径 |
| `resolveActive(kind)` | 取生效版本；无指针时回退到最新**完整**版本并写回 |
| `isVersionComplete(kind, v)` | 关键文件是否就位（node 要 `node.exe`，npm 要 `package/bin/npm-cli.js`，dsh 要 dsh 的 `package.json`） |
| `activeVersion` / `setActiveVersion` | 读取 / 写入 `.active` 指针 |
| `listInstalled` / `prepareVersionDir` / `removeVersion` | 列表 / 准备 / 删除 |
| `migrateLegacyInstalls` | 把旧的平铺目录迁进版本目录 |

::: warning 完整性很关键
搬迁时被占用的文件（典型是正在运行的 `node.exe`）可能没搬进来。残缺目录一律当作不存在，读取侧会回退到平铺旧布局；`moveFlatInto` 也会在关键文件未落位时拒绝写 `.active`。
:::

## 下载器（多线程）

`main/dsh/downloader.ts` 的 `downloadFile`：

- 用 HTTP Range 分段并发下载（默认 4，可在设置里调，最多 16）；小于 1MB 或服务端不支持 Range 时退化为单流；
- 带重试、临时文件清理；临时文件落在工作目录的 `temp/download`，完成后再搬到目标（跨盘用拷贝兜底）；
- **同一目标文件去重**：`inFlightDownloads` 按小写化后的最终路径合并，后到的调用订阅同一任务，进度广播给全部订阅者；对外提供 `isFileDownloading()`；
- 支持 `signal` 取消。

## 取消安装

`main/kernel/operations.ts` 提供单活动令牌：`beginCancelable()` / `cancelActive()` / `CANCELED_MESSAGE`（原 `dsh/cancel.ts` 已并入内核）。

下载与解压都挂到该令牌上；路由 `POST /installs/cancel` 触发。取消后清理临时文件并返回 `{ ok:false, canceled:true }`，渲染层不把它当错误。

## 解压阶段

Node 的 zip / tar 与内置 npm 的 tgz 解压是独立阶段，进度广播携带 `phase: 'download' | 'extract'`；解压时渲染层切换为不确定动画（不再显示百分比）。

## 进度与「切页不失联」

进度由**主进程**记录，不是渲染层自己的状态：`main/kernel/operations.ts` 按 `kind`
（`node` / `npm` / `pnpm` / `dsh-plugin`）登记进行中的操作。渲染层任意时刻可 `GET /operations`
取快照，操作结束时主进程清空对应条目。这样切换页面（面板卸载）再回来，或者从初始化页跳到设置页，
正在跑的下载依然看得见 —— 以前进度只活在面板的 `ref` 里，切一次就再也看不到了。

`kind` 同时也解决串台：npm 与 pnpm 的下载此前共用一个广播通道，下 pnpm 会同时点亮 npm 的进度条。

进度还会**节流**（`MIN_INTERVAL_MS = 80`）：下载是每个数据块回调一次，全转发会给渲染层灌几千条
IPC。同一操作在窗口内的重复进度只保留最后一条，但**阶段变化**（下载 → 解压）与进度前进一定送出，
否则进度条会停在半路。

## 长耗时的文件操作不要同步

一个版本目录动辄几万个小文件，同步删除 / 拷贝会把主进程独占到界面完全没响应。
`fsutil.removeTree` / `removeQuietly`、`installs.prepareVersionDir` / `removeVersion`、
`fs.promises.cp` 都是 async；进程终止走 `logbus.killTree()`（同为 async，Windows 上
`taskkill /T` 常要几百毫秒）。`removeQuietlySync` 只留给启动期无法 await 的同步迁移。

## npm 缓存

`settings.tempNpmDir()` = `<工作目录>/temp/npm`；`npmRunner.npmCacheEnv()` 把 `npm_config_cache` 注入所有 npm 子进程（系统 npm、内置 npm、本地 Node 自带 npm、版本探测），不写 `~/.npm`。

## 安装流程概览

- **Node**：`nodeenv.deployLocalNode` 从 nodejs.org 下载对应平台包 → 解压 → 逐项搬进 `node/<版本>/` → 写 `.active`；
- **npm**：`npmRunner.ensureBundledNpmReady` 从 registry 下载 tgz → 解压到 `npm/<版本>/`；
- **DeepSeek Harness**：`manage.installDsh` 用选定 npm 通过 `--prefix` 装进 `dsh/<版本>/`，再写 `.active`；
- 三者都支持「按版本安装、运行时切换、删除」。

## 相关

- [配置目录](/zh/dev/config-dir)
- [IPC 契约](/zh/dev/ipc)
