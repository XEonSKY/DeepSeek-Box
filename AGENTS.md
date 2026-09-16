# AGENTS.md

本工作区的 agent 开发规则入口。完整技能见 `.agents/skills/deepseek-box/SKILL.md`。

## 项目

DeepSeek Box —— DeepSeek Harness 的 Electron 桌面外壳（Electron 44 + Vue 3 + TypeScript + Element Plus）。

## 测试

可测单元是**纯逻辑**，测试环境为 node（`vitest.config.mjs`）：

- `src/shared/**` —— 三端共享工具（版本、i18n、快捷键、错误信息）；
- `src/main/**` —— 主进程的版本比较、路径助手、设置归一化等不依赖 Electron 的部分；
- 渲染层只测纯函数（如 `lib/format.ts`）；组件渲染行为由用户手动验证。

跳过 `import 'electron'` 的模块（如 `app/settings.ts` 里除归一化函数外的部分）——单测不加载 Electron 运行时。

**测试统一放在 `tests/` 下，按被测层分目录**，镜像被测源码的层级：

| 测试目录 | 对应源码 | 别名 |
|---|---|---|
| `tests/shared/` | `src/shared/` | `@shared/*` |
| `tests/main/` | `src/main/` | `@main/*` |
| `tests/renderer/` | `src/renderer/src/` | `@/*` |

文件名与被测模块同名（`src/main/dsh/semver.ts` → `tests/main/dsh/semver.test.ts`）。源码目录里**不允许**出现 `*.test.ts`，测试内用别名 import 而非跨目录相对路径。

## 必读

- `.agents/skills/deepseek-box/SKILL.md` —— 铁律、任务路由表、常用命令、交付前自检；
- `.agents/skills/deepseek-box/references/` —— 架构 / IPC / 主进程 / 渲染层 / 约定；
- `docs/zh/dev/` —— 人类可读的开发文档（发布时统一更新）。

## 关键红线

- IPC 契约唯一来源是 `src/shared/api.ts`；新增端点同步 `src/main/app/ipc.ts`，preload 不改。
- 主进程 HTTP 一律走 `httpFetch(scope, ...)`；推送走 `runtime.ts` 的发送函数。
- 密钥不出主进程；设置结构变更必须升 `settingsVersion` 且向后兼容。
- 新增文案 zh / en 两处对齐；hant 是差异覆盖目录，**无需同步补充**（新增键不必补繁体）；用户可见文案必须 i18n。
- UI 组件优先 `antdv-next`（`<a-*>`），禁止新增 `el-*`；按需引入由构建器自动注入，不要手动 import 组件或全量注册。
- 缩进 4 个空格，注释用简要中文。
- 纯逻辑（shared 工具、主进程的版本 / 路径 / 归一化 / 迁移判定）必须配 `*.test.ts` 单元测试；测试放 `tests/` 下按层分目录，源码目录里不得出现测试文件。
- agent 缓存 / 临时文件放 `.agents/temp/`，用完即删。
- 改动推送 `dev`，发行才推 `main`；推送远程前必须征得确认。
- 一个提交只做一件事；提交信息用 Conventional Commits。
- agent 只做 typecheck + lint，**不要主动跑测试**（不跑 `npm run check` / `npm run test`）；单元测试、`npm run check` 与运行时行为由用户运行验证。
- **可用时把多条命令堆叠进同一次调用**（`;` / `&&` 串联，或写成一段脚本一次跑完），不要拆成多次；互不依赖的只读命令也尽量合并。串联时用 `&&`（或检查 `$LASTEXITCODE`），别让后续命令掩盖前面的失败。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run check` | typecheck + lint + 单元测试（用户 / pre-commit 执行；agent 不主动跑） |
| `npm run test` | 只跑单元测试（用户执行；agent 不主动跑） |
| `npm run test:watch` | 单元测试 watch 模式（开发时用；agent 不主动跑） |
| `npm run test:coverage` | 带覆盖率报告（输出到 `.agents/temp/coverage`；agent 不主动跑） |
| `npm run dev` | 开发态（由用户运行，agent 不自行启动） |
| `npm run build` | 构建到 `out/` |
| `npm run docs:dev` / `docs:build` | 文档站 |

Git hooks 由 `npm install` 的 `prepare` 自动启用；若未生效，运行 `git config core.hooksPath .githooks`（必要时 `chmod +x .githooks/pre-commit`）。
