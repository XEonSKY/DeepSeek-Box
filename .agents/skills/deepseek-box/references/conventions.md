# 开发约定与验证

> 事实来源：`docs/zh/dev/conventions.md` + `eslint.config.mjs`。动手前先过一遍。

## 代码风格

- **缩进 4 个空格**（ESLint `@stylistic/indent` + `vue/html-indent`，`SwitchCase: 1`）；CSS / `<style>` 块、JSON 配置同样是 4 空格。
- **YAML 例外**：`.github/workflows/*.yml` 用 2 空格——YAML 的序列项子键必须与 `- name:` 对齐（`uses:` 不能再缩进一层），机械改成 4 空格会直接破坏工作流。改 YAML 后务必用 `node -e "require('yaml').parse(require('fs').readFileSync(f,'utf8'))"` 之类的方式验证可解析。
- TypeScript 严格模式；类型检查 `npm run typecheck`（node + web 两份），单元测试 `npm run test`。
- 提交前跑 `npm run lint`，要求 **0 error**（既有 warning 可忽略）。
- 别名：`@shared` → `src/shared`（三端都可用）；`@` → `src/renderer/src`（仅渲染层）。

## 注释

- 注释语言：**简要中文**。
- 函数 / 方法 / 导出 API 用**简短中文 JSDoc**（`/** ... */`），一句话讲清用途，必要时才补 `@param` / `@returns`。
- 行内注释从简：只在非显而易见处或踩坑点写，不逐行解释。

## 缓存与临时文件

- **所有 agent 产生的缓存 / 临时 / 中间文件（日志、报告、草稿、脚本产物）统一放 `.agents/temp/`**，用完即删。
- 不要散落到工作区根、`docs/` 或其它目录。
- `.agents/skills/**` **纳入版本管理**（团队共享）；`.agents/temp/` 已 gitignore，只保留 `.gitkeep` 占位。

## i18n 文案

- 单一来源：`src/shared/locales/{zh,en}/index.ts`，中英**逐键对齐**（键名、顺序、`{占位符}` 都一致）。
- `zh/hant.ts` 是**全量繁体覆盖**；`zh/{anime,wenyan}.ts`、`en/{pirate,shakespeare}.ts` 是**只写差异的覆盖层**，由 `shared/locales/ext.ts` 深合并到基础文案。
- **新增键时 zh / en / hant 三处一起加**，否则繁体用户会看到简体或原始 key。
- 文案是程序的一部分（`src/shared/locales/` 不算文档），可随功能一起改。

## 文档

- **同步节奏**：开发期只维护技能；`docs/` 中英在**发布时**统一更新，并同时整理技能。
- 站内链接带语言前缀（`/zh/...` 或 `/en/...`），并按分类加 `/user/` 或 `/dev/`。
- 中英页面**成对**存在：改 `docs/zh/...` 就要同步 `docs/en/...`。
- 新增页面后要同步 `.vitepress/config.mts` 的 nav / sidebar。
- 路径用相对路径描述工作区内文件；**交付前不要求**跑 `npm run docs:build`（轻量改动跳过；改 nav / sidebar 时自行确认）。

## 分支 / 提交 / 推送

- **改动推送至 `dev`**；**发行时才把 `dev` 合并并推送到 `main`**。
- 本地操作（`add` / `commit` / `branch` / `merge` / `checkout`）可直接进行。
- **一个提交只做一件事**，禁止顺手改无关文件；提交信息用 **Conventional Commits**（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:` 等）。
- 不维护 `CHANGELOG.md`，变更记录以 GitHub Release notes 为准。
- **推送远程前必须请求确认**：任何 `git push`（普通、`--force`、`--tags`、删除远程分支 / 标签、移动标签）都要先说明目标（哪个分支、是否强推）并征得同意，不得自动推送。
- 破坏性远程操作尤其要先确认。
- **质量门禁**：`npm run check`（typecheck + lint + 单测）必须通过；仓库自带 `.githooks/pre-commit`（由 `npm install` 的 `prepare` 自动启用 `core.hooksPath`），CI 见 `.github/workflows/quality.yml`（`dev` push 与 PR，跑的是同一条命令）。

## 依赖 / 日志 / 安全

- 新增依赖允许，但**优先复用现有能力**，避免重复依赖与体积膨胀。
- **依赖分区规则**（本仓库约定，别装错）：
  - `devDependencies`：**所有前端 / 构建期依赖**。本项目连 `vue`、`pinia`、`vue-router`、`vue-i18n`、`element-plus`、`antdv-next`、`@vueuse/core`、`@xterm/*`、Vite 插件、resolver 都在这里——渲染层由 Vite 打包进产物，运行时不需要 node_modules。
  - `dependencies`：**只放主进程 / 预加载的运行时依赖**。`electron.vite.config.ts` 给 `main` 与 `preload` 设了 `externalizeDeps: true`，它们不打进 bundle，必须随包分发。目前只有 `electron-updater`、`semver`、`yaml`。
  - 判断方法：`grep` 该包在 `src/main` / `src/preload` 是否有 import——有则 `dependencies`，只被 `src/renderer` 或构建配置使用则 `devDependencies`。
- 用户可见的日志与错误必须走现有日志入口与 i18n（主进程 `mt()`、渲染层 `t()`），禁止硬编码文案。
- 保持渲染层安全底线：`contextIsolation` 开启、渲染层无 Node、只经 `window.api`；放宽必须说明理由。

## 兼容性与回退

- `settings.json` 结构变更**必须向后兼容**：升 `settingsVersion` 并保留旧值迁移，用户数据不丢。
- 发布保持 A/B 版本槽 + 启动健康守卫自动回退（`app/appslots.ts`）能力。

## 技能维护

- `deepseek-box` 技能**攒一批再统一更新**；但影响开发方式的改动（新增约定、目录、命令、契约同步点）不要长期漏记。
- 技能 `metadata.version` 跟随应用版本（`package.json`）。

## 自动化测试与验证边界

- 单元测试用 **Vitest**，配置 `vitest.config.mjs`（注意是 **.mjs 不是 .ts**：配置里没有需要类型检查的内容，纯 JS 可省掉 Vite 加载配置时的一次 esbuild 转译）。
- 测试环境是 **node**，不加载 Electron 运行时。**可测的是纯逻辑**：
  - `src/shared/**` —— 三端共享工具（version / i18n / hotkeys / errors）；
  - `src/main/**` —— 不 import `electron` 的部分（semver 比较、fsutil、设置归一化函数）；
  - 渲染层只测纯函数（如 `lib/format.ts`）。
- **测试文件与源码同目录**（`foo.ts` → `foo.test.ts`），不要另建 `test/` 目录。
- 命令：`npm run test`（跑一次）、`test:watch`、`test:coverage`（输出到 `.agents/temp/coverage`）。
- **新写的纯逻辑必须带测试**；修 bug 时优先补一条能复现该 bug 的用例。
- 常见陷阱：
  - 模块顶层 `import { app } from 'electron'` 会让整条测试链路去加载 Electron，**别测这类模块**（例如 `app/settings.ts` 只测其中不依赖 Electron 的归一化函数，测试里按名导入即可）；
  - 打包时别把 `electron` 卷进来 —— 一旦卷进来，CI 上会触发 Electron 二进制下载。
- agent 的验证边界：`npm run check`（= typecheck + lint + 单测）是**能自动验证的全部**（必要时再 `npm run build`）。
- **运行时行为（窗口、托盘、下载、迁移、代理、自更新）仍由用户验证**：不要自行 `npm run dev` 启动应用；交付说明里写清需要用户验证的步骤。

## 版本与发布

- **版本号规范：`X.Y.Z-{alpha|beta|rc}.N`** —— 主次修订三段 + 预发布通道 + 通道内序号。
  - 三段数字**正常递增**（`0.1.6` 就是 `0.1.6`），不要用 `0.0.0` 之类的占位值——那会让「哪个版本更新」需要额外解释；
  - 通道只有 `alpha` / `beta` / `rc` 三种，序号从 `.0` 起递增（`0.1.6-alpha.2` → `0.1.6-alpha.3`）；
  - semver 的预发布比较是**字典序优先**，故 `alpha < beta < rc`，升级链天然正确；
  - 该规范由 `src/shared/version-convention.test.ts` 守护（同时校验四处版本号一致），改规范要同步改测试。
- 升版本要**同时改三处**：`package.json` 的 `version`、`package-lock.json` 顶层的 `version` 与 `packages[""].version`、技能 `SKILL.md` 的 `metadata.version`（跟随应用版本）。
- 版本号一律**不带 `v` 前缀**（`v` 只出现在 Git tag 上）。
- CI 校验 **Git tag（`v` + 版本号）== package.json 版本**；是否预发布由版本号是否包含 `-` 决定（当前规范下**始终**是 prerelease）。
- 工作流：`.github/workflows/build-release.yml`（tag 触发打包发布）、`deploy-docs.yml`（`main` 改动 `docs/**` 时部署文档站）。
- 本地打包：`npm run build` 后 `npm run dist:win`（另有 `dist:mac` / `dist:linux`）。

## 已知问题与待办

- `docs/public/home-page.png` 仍是旧品牌截图，文档首页仍在引用，待重截。
- `Settings.funLocale` 是历史字段名，改名需伴随一次持久化迁移，故暂时保留。
- `src/renderer/src/components/TitleBar.vue` 里 `.icon-btn` 的注释引用了一个仓库中并不存在的 `AGENT.md`，待清理。
