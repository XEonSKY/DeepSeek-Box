# 开发环境与命令

## 环境要求

| 项 | 要求 |
|---|---|
| Node | ≥ 20（DeepSeek Harness 运行时也要求 ≥ 20） |
| 包管理器 | npm（仓库自带 `package-lock.json`） |
| 平台 | Windows / macOS / Linux 均可开发；打包脚本按平台区分 |

## 常用命令

在仓库根执行：

| 命令 | 作用 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 启动开发态（electron-vite） |
| `npm run typecheck` | 类型检查（node + web 两份） |
| `npm run lint` | ESLint 检查（4 空格风格） |
| `npm run lint:fix` | 自动修复 |
| `npm run build` | 构建到 `out/` |
| `npm run dist:win` | 打包（另有 `dist:mac` / `dist:linux`） |
| `npm run docs:dev` | 文档站本地预览 |
| `npm run docs:build` | 构建文档站到 `.vitepress/dist` |

::: info
本仓库没有测试套件，验证主要靠 `typecheck` / `lint` / `build`。
:::

## 目录结构

```text [项目结构]
.
├─ src/
│  ├─ main/            主进程（窗口、DeepSeek Harness、配置、更新）
│  │  ├─ app/           settings / configmigrate / models / ipc / ui / appupdate / appslots …
│  │  └─ dsh/           dsh / manage / nodeenv / npmRunner / downloader / installs …
│  ├─ preload/         window.api 桥接与类型
│  ├─ renderer/        Vue 3 界面
│  │  ├─ src/views/    页面与设置面板
│  │  ├─ src/components/
│  │  └─ src/lib/      工具（主题、标签、格式化、更新提示…）
│  └─ shared/          跨进程类型 / i18n / 版本工具
├─ docs/               文档站内容（zh / en，本文件所在处）
├─ .vitepress/         文档站配置
└─ package.json
```

## 运行时的数据位置

- **应用设置与本地安装**：配置目录，默认 `~/.dsbox/release`（打包）/ `~/.dsbox/dev`（开发），含 `settings.json`、`node/`、`npm/`、`dsh/`、`workspace/`。
- **配置目录覆盖指针**：`<userData>/config-dir`；迁移计划 `<userData>/config-migration.json`。
- **临时下载 / npm 缓存**：工作目录下 `temp/download` 与 `temp/npm`。

详见[配置目录](/zh/dev/config-dir)与[DeepSeek Harness 与环境安装链路](/zh/dev/installs)。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_NODE` | 指定运行 dsh 的 Node 可执行文件，覆盖设置里的「Node 来源」 |

## 常见问题

- **文档站本地预览端口**：默认 `http://localhost:5173`。
- **改了主进程代码**：`npm run dev` 会自动重启 Electron；渲染层改动热更新。
- **改了文档站配置**：重启 `npm run docs:dev` 生效。