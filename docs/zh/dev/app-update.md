# 应用自更新（A/B 版本回退）

应用更新走 GitHub Releases，由 `main/app/appupdate.ts` 与 `main/app/appslots.ts` 实现，核心是「后台下载 + 保留一版 + 健康守卫」。

## 发布解析

`appupdate.ts` 用 GitHub Releases API 解析目标 tag（是否含预发布由设置 `appCheckPrerelease` 控制），钉到该 tag 的 generic 源，再由 updater 后台下载。下载走「程序更新」范围的代理（electron-updater 的专属 session `electron-updater`，不波及 webview）。

## 版本槽（A/B）

`appslots.ts` 在安装新版前，把当前安装目录归档为 `<userData>/app-slots/<版本>.tar.gz`（只保留一个），并登记待安装信息。

## 启动健康守卫

新版首次启动后由启动守卫确认健康（`HEALTHY_MS` 时间窗）；连续启动失败会**自动回退**到归档的旧版本。用户也可以在「设置 → 关于」手动「回退到上一版」。

## 安装目标

按平台决定：Windows / macOS 取应用目录，Linux 为 AppImage 单文件。

## 事件与 IPC

- 事件：`appupdate:*`（下载进度、就绪、错误）；
- IPC：`appupdate:check` / `appupdate:trigger` / `appupdate:slots` / `appupdate:rollback`。

## 与 DeepSeek Harness 更新的区别

| | 对象 | 通道 |
|---|---|---|
| 应用自更新 | 外壳应用 | GitHub Releases |
| DeepSeek Harness 更新 | `@deepseek-ai/dsh` | npm registry |

两者互不影响，排查时分开看。