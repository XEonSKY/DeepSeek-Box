# AGENTS.md

本工作区的 agent 开发规则入口。完整技能见 `.agents/skills/deepseek-box/SKILL.md`。

## 项目

DeepSeek Box —— DeepSeek Harness 的 Electron 桌面外壳（Electron 44 + Vue 3 + TypeScript + Element Plus）。

## 质量门禁

本仓库**不含单元测试**（`tests/` 与 `scripts/` 已移除），质量门禁只有静态检查：

- `npm run typecheck` —— 主进程 / preload / shared（`tsconfig.node.json`）与渲染层（`tsconfig.web.json`）；
- `npm run lint` —— ESLint（0 error 为通过）。

`npm run check` 跑的就是这两条。CI（`.github/workflows/quality.yml`）同样只跑 typecheck + lint。
运行时行为（窗口 / 托盘 / 下载 / 迁移 / 自更新 / 界面）一律由用户手动验证。

**改动纯逻辑（shared 工具、主进程的版本 / 路径 / 归一化 / 迁移判定）后，靠 typecheck 与人工验证把关**；
不要假设存在单测兜底。

## 分支与发布

- 开发改动推 `dev`；**发行才推 `main`**，且任何 `git push` 都要先说明目标并征得同意。
- **版本号由发布者主动指定**：推 `main` 前自己按版本号规范把四处改齐（`package.json`、`package-lock.json` 的
  顶层与 `packages[""]`、技能 `metadata.version`），**没有任何 hook 会自动改版本号**，也不需要事后重推。
  推送 `v*` 标签、删除远程分支不额外加门禁。

## 必读

- `.agents/skills/deepseek-box/SKILL.md` —— 铁律、任务路由表、常用命令、交付前自检；
- `.agents/skills/deepseek-box/references/` —— 架构 / IPC / 主进程 / 渲染层 / 约定；
- `docs/zh/dev/` —— 人类可读的开发文档（发布时统一更新）。

## 关键红线

- IPC 契约唯一来源是 `src/shared/api.ts`；新增端点写进对应的 `src/main/modules/<功能>.ts`（新功能挂进 `modules/index.ts`），preload 不改。
- 主进程 HTTP 一律走 `httpFetch(scope, ...)`；推送走 `runtime.ts` 的发送函数。
- 密钥不出主进程；设置结构变更必须升 `settingsVersion` 且向后兼容。
- 新增文案 zh / en 两处对齐；hant 是差异覆盖目录，**无需同步补充**（新增键不必补繁体）；用户可见文案必须 i18n。
- UI 组件优先 `antdv-next`（`<a-*>`），禁止新增 `el-*`；按需引入由构建器自动注入，不要手动 import 组件或全量注册。
- 缩进 4 个空格，注释用简要中文。
- agent 缓存 / 临时文件一律放 `.agents/temp/`；**临时目录不必每次清理**，允许跨任务保留复用（避免重复下载 / 克隆），需要时再手动清。
- `.agents/temp/deepseek-harness/` 常备一份 `https://github.com/deepseek-ai/deepseek-harness.git` 的克隆（查上游 dsh 实现 / 契约用），**不要删除**；需要最新代码时 `git -C .agents/temp/deepseek-harness pull`，仅目录缺失才重新 clone。
- 改动推送 `dev`，发行才推 `main`；推送远程前必须征得确认。
- 一个提交只做一件事；提交信息用 Conventional Commits。
- agent 只做 typecheck + lint；运行时行为由用户验证。
- **可用时把多条命令堆叠进同一次调用**（`;` / `&&` 串联，或写成一段脚本一次跑完），不要拆成多次；互不依赖的只读命令也尽量合并。串联时用 `&&`（或检查 `$LASTEXITCODE`），别让后续命令掩盖前面的失败。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run check` | typecheck + lint（agent 与用户都可跑） |
| `npm run typecheck` | 类型检查（node + web 两份） |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run dev` | 开发态（由用户运行，agent 不自行启动） |
| `npm run build` | 构建到 `out/` |
| `npm run docs:dev` / `docs:build` | 文档站 |

本仓库不启用 Git hooks（原 `.githooks/` 与安装脚本已移除）；提交前请自行跑 `npm run check`，CI 也会在 `dev` 分支与 PR 上跑同一套静态检查。
