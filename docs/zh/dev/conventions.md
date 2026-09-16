# 开发约定

改动代码或文档前，请先遵守以下约定。

## 代码风格

- **缩进 4 个空格**（ESLint `@stylistic/indent` + `vue/html-indent`）；
- 提交前跑 `npm run lint`（0 error；既有 warning 可忽略）；
- TypeScript 严格模式，类型检查 `npm run typecheck`。

## 注释

- 注释语言：**简要中文**；
- 函数 / 方法 / 导出 API：用**简短中文 JSDoc**（`/** ... */`），一句话讲清用途，必要时才补 `@param` / `@returns`；
- 行内注释**从简**：只在非显而易见处或踩坑点写，不逐行解释。

## 文件与目录

- 所有 agent 产生的缓存 / 临时 / 中间文件（日志、报告、草稿、脚本产物）统一放 `.agents/temp/`，用完即删；
- 不要散落到工作区根、`docs/` 或其它目录；
- `.agents/`（含 `.agents/temp/`）已被 gitignore，不参与版本管理。

## Git 与远程

- 本地操作（`add` / `commit` / `branch` / `merge` / `checkout`）可直接进行；
- **推送远程前必须请求确认**：任何 `git push`（普通、`--force`、`--tags`、删除远程分支 / 标签、移动标签）都要先说明目标并征得同意，不得自动推送；
- 破坏性远程操作（强推、删除远程分支 / 标签）尤其要先确认。

## 文档

- 站内链接带语言前缀（`/zh/...` 或 `/en/...`），并按分类加 `/user/` 或 `/dev/`；
- 中英页面**成对**存在；
- 路径用相对路径描述工作区内文件。

## i18n 文案

- 界面文案的单一来源是 `src/shared/locales/{zh,en}/index.ts`，中英**逐键对齐**（键名、顺序、`{占位符}` 都一致）；
- `zh/hant.ts` 是**全量繁体覆盖**；`zh/{anime,wenyan}.ts`、`en/{pirate,shakespeare}.ts` 是**只写差异的覆盖层**，由 `shared/locales/ext.ts` 深合并到基础文案之上；
- 新增键时 **zh / en / hant 三处一起加**，否则繁体用户会看到简体或原始 key；
- 文案是**程序的一部分**（`src/shared/locales/**` 不算文档），可随功能一起改。

## 测试

单元测试用 **Vitest**（`vitest.config.mjs`，**`.mjs` 而非 `.ts`**：配置里没有需要类型检查的内容，纯 JS 可省掉加载配置时的一次 esbuild 转译），跑在 node 环境。

**测试独立于源码，统一收在 `tests/` 下**，目录镜像被测源码的层级：

| 测试目录 | 对应源码 | 别名 |
|---|---|---|
| `tests/shared/` | `src/shared/` | `@shared/*` |
| `tests/main/` | `src/main/` | `@main/*` |
| `tests/renderer/` | `src/renderer/src/` | `@/*` |

- 文件名与被测模块同名，`tests/` 内的层级也镜像源码，因此**搬运测试不需要改相对路径**；
- 测试内一律用别名 import；`@main` **只在测试与 `tsconfig.node.json` 中配置**，主进程源码自身仍用相对路径；
- **源码目录里不得出现 `*.test.ts`** —— 由 `tests/shared/version-convention.test.ts` 守护；
- 可测的是**纯逻辑**（shared 工具、主进程的版本 / 路径 / 归一化 / 迁移判定、渲染层纯函数）；
  模块顶层 `import { app } from 'electron'` 会让整条链路去加载 Electron，这类模块不要整体测（按名导入其中的纯函数即可）；
- 命令：`npm run test` / `test:watch` / `test:coverage`（输出到 `.agents/temp/coverage`）；
- **新写的纯逻辑必须带测试**；修 bug 时优先补一条能复现该 bug 的用例。

运行时行为（窗口、托盘、下载、迁移、代理、自更新）仍以手动验证为准。

## 已知问题与待办

- `docs/public/home-page.png` 仍是旧品牌截图，文档首页仍在引用，待重截；
- `Settings.funLocale` 是历史字段名，改名需要伴随一次持久化迁移，故暂时保留；
- `src/renderer/src/components/TitleBar.vue` 里 `.icon-btn` 的注释引用了一个仓库中并不存在的 `AGENT.md`，待清理。