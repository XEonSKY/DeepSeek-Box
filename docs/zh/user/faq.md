# 常见问题

## 启动报错：`the value for "version" in ~/.dsh/.credentials.yaml must be a string`

这是 dsh 读取凭据配置失败，不是本应用的问题。通常是 `.credentials.yaml` **顶层** `version` 写成了数字。

修复：编辑 `C:\Users\<你>\.dsh\.credentials.yaml`（或对应主目录），把首行改成带引号的字符串：

```yaml [~/.dsh/.credentials.yaml]
version: "1"
```

保存后重新启动。内部的 `payload.version` 无需改动。

## 启动后一直转圈，进不去界面

应用通过 dsh 打印的 `dsh web: <url>` 解析地址。若长时间没有 URL：

- 打开「设置 → 终端」看 dsh 输出是否有报错（或按 `Ctrl` / `Cmd` + `T`）；
- 检查所选端口是否被占用（应用会自动上扫空闲端口）；
- 确认 DeepSeek Harness 已安装、工作目录存在且可读写。

## 提示无法启动：No locally deployed Node found

说明当前设置为**本地部署** Node，但在配置目录里找不到可用的 Node。处理：

- 打开「设置 → 环境」，在「本地部署」里下载一个 Node（建议 LTS），或改用「Electron 自带」；
- 如果你之前换过配置目录，确认当前目录下确实有 `node/<版本>/node.exe`。

## 下载很慢 / 安装卡住

- 「设置 → 网络」把 npm 镜像源切到 `npmmirror`；
- 网络不稳时把「下载并发数」调低；
- 安装过程可随时点「取消」，之后重试。

## 按 F12 控制台没反应

**开发模式默认隐藏**，得先解锁：打开「设置 → 关于」，**连点「应用版本号」5 次**（1.5 秒内连击），该页才会出现「开发模式」开关；把它打开后 `F12` 才会生效。默认关闭以避免误开。

## 为什么升级 / 卸载要「先停止 dsh」

Windows 下运行中的 dsh 会锁定 DeepSeek Harness 模块文件，导致替换 / 删除失败。应用会先停止再操作；若仍有进程占用会检测并提示你先关闭相关进程。

## 无法连接 / 检查更新失败

- 检查网络；必要时把 npm 镜像源切到 `npmmirror` 重试；
- 应用更新（GitHub）与 DeepSeek Harness 更新（npm）走不同通道，可分别排查。

## 想同时打开多个实例

默认是**单实例**：重复启动会唤起已有窗口并置前，而不是新开一个。

::: tip 注意区分「多实例」与「多窗口」
本应用**支持多窗口**——在标签上右键「在新窗口打开」即可开出副窗口（见[界面与操作](/zh/user/usage)）。这是同一个应用内的多个窗口。
:::

## 其它

若以上未解决，请带上「设置 → 终端」的日志与版本号（应用版本、DeepSeek Harness 版本）反馈到 [Issues](https://github.com/XEonSKY/DeepSeek-Box/issues)。