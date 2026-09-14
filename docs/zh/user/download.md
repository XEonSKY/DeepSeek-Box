# 下载与系统要求

DeepSeek Box 是跨平台桌面应用，安装包发布在 GitHub Releases。

## 系统要求

| 项 | 要求 |
|---|---|
| 操作系统 | Windows 10/11（x64 / arm64）、macOS、主流 Linux（x64 / arm64） |
| 运行时 | **无需预装 Node.js**：可用 Electron 自带 Node、让应用下载部署本地 Node，或使用系统 Node（≥ 20） |
| 网络 | 首次需联网以下载 DeepSeek Harness 与（可选的）Node / npm；之后只使用本机回环地址 |
| 磁盘 | 安装包 + DeepSeek Harness 与运行时（每次约几十到几百 MB，取决于所选来源） |

> DeepSeek Harness `@deepseek-ai/dsh` 由应用自动检测；缺失时会弹出安装向导，可选官方 `registry.npmjs.org` 或 `npmmirror` 镜像。

## 从哪里下载

打开 [Releases](https://github.com/XEonSKY/DeepSeek-Box/releases) 页面，选择最新版本。产物命名形如：

```text
DeepSeek-Box-<版本>-<平台>-<架构>.<后缀>
```

| 系统 | 产物 |
|---|---|
| Windows | `...-win-x64-setup.exe` / `...-win-arm64-setup.exe` |
| macOS | `...-mac-x64.dmg` / `...-mac-arm64.dmg`（另有 `.zip` 供自动更新使用） |
| Linux | `...-linux-x64.AppImage` / `...-linux-arm64.AppImage` |

## 选择哪个架构

按你**运行的进程架构**匹配：ARM 机器下载 `arm64` 版，Intel / AMD 下载 `x64` 版。不确定时，macOS 可在「关于本机」查看芯片，Windows 可在「设置 → 系统 → 关于」查看系统类型。

## 安装

- **Windows**：运行 `*-setup.exe`，如提示「未知发行者」，按系统引导放行（开源应用通常没有付费签名）。
- **macOS**：打开 `*.dmg` 并把应用拖进「应用程序」；首次打开若被拦截，到「系统设置 → 隐私与安全性」选择仍要打开。
- **Linux**：AppImage 需要先赋予可执行权限：`chmod +x *.AppImage`，然后直接运行。

## 验证与安全

- 请只从官方 Releases 下载；应用自更新同样走 GitHub 发布。
- 如果所在网络访问 GitHub 较慢或必须走代理，可在「设置 → 网络」启用代理并勾上**程序更新**。
- 本应用默认只监听 `127.0.0.1`，不对外暴露端口。

## 下一步

安装完成后，从[快速开始](/zh/user/quickstart)继续。