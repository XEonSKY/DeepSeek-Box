# 开发约定与验证

> 事实来源：`docs/zh/dev/conventions.md` + `eslint.config.mjs`。动手前先过一遍。

## 代码风格

- **缩进 4 个空格**（ESLint `@stylistic/indent` + `vue/html-indent`，`SwitchCase: 1`）；CSS / `<style>` 块、JSON 配置同样是 4 空格。
- **YAML 例外**：`.github/workflows/*.yml` 用 2 空格——YAML 的序列项子键必须与 `- name:` 对齐（`uses:` 不能再缩进一层），机械改成 4 空格会直接破坏工作流。改 YAML 后务必用 `node -e "require('yaml').parse(require('fs').readFileSync(f,'utf8'))"` 之类的方式验证可解析。
- TypeScript 严格模式；类型检查 `npm run typecheck`（node + web 两份），静态门禁 `npm run check`（typecheck + lint；本仓库无单测）。
- 提交前跑 `npm run lint`，要求 **0 error**（既有 warning 可忽略）。
- 别名：`@shared` → `src/shared`（三端都可用）；`@` → `src/renderer/src`（仅渲染层）。

## 注释

- 注释语言：**简要中文**。
- 函数 / 方法 / 导出 API 用**简短中文 JSDoc**（`/** ... */`），一句话讲清用途，必要时才补 `@param` / `@returns`。
- 行内注释从简：只在非显而易见处或踩坑点写，不逐行解释。

## 缓存与临时文件

- **所有 agent 产生的缓存 / 临时 / 中间文件（日志、报告、草稿、脚本产物）统一放 `.agents/temp/`**；**不必每次用完即删** —— 临时目录允许跨任务保留复用（省掉重复下载 / 克隆的开销），需要时再手动清理。
- 不要散落到工作区根、`docs/` 或其它目录。
- **常备上游参考仓库**：`.agents/temp/deepseek-harness/` 保留一份 `https://github.com/deepseek-ai/deepseek-harness.git` 的克隆（查上游 dsh 实现 / 契约用），**不要删除**；需要最新代码时 `git -C .agents/temp/deepseek-harness pull`，仅目录缺失才重新 clone。
  - 本机 `git clone` 直连 GitHub 时 schannel 会报 `SEC_E_NO_CREDENTIALS`，改用 openssl 后端：`git -c http.sslBackend=openssl clone ...`（该克隆已在仓库级 config 里固定 `http.sslBackend=openssl`，后续 `pull` 直接可用）。
- `.agents/skills/**` **纳入版本管理**（团队共享）；`.agents/temp/` 已 gitignore，只保留 `.gitkeep` 占位。

## i18n 文案

- 单一来源：`src/shared/locales/{zh,en}/index.ts`，中英**逐键对齐**（键名、顺序、`{占位符}` 都一致）。
- `zh/hant.ts` 与 `zh/{anime,wenyan}.ts`、`en/{pirate,shakespeare}.ts` 一样是**只写差异的覆盖层**，由 `shared/locales/ext.ts` 深合并到基础文案。
- **新增键时只需改 zh / en 两处**；hant **无需同步补充**，未覆盖的键自动回落到简体基座。
- **删除键时三处都要删**：hant 必须是 zh 的**子集**——只删 zh 会让 hant 留下孤儿键。
  本仓库已无单测守护这条，务必**人工核对**（新增两处、删除三处，方向不同）。
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
- **质量门禁**：`npm run check`（typecheck + lint；本仓库无单测）必须通过 —— 由用户或 CI（`.github/workflows/quality.yml`）执行；本仓库不启用 Git hooks，提交前请自行跑一次。

## 依赖 / 日志 / 安全

- 新增依赖允许，但**优先复用现有能力**，避免重复依赖与体积膨胀。
- **依赖分区规则**（本仓库约定，别装错）：
  - `devDependencies`：**所有前端 / 构建期依赖**。本项目连 `vue`、`pinia`、`vue-router`、`vue-i18n`、`element-plus`、`antdv-next`、`@vueuse/core`、`@xterm/*`、Vite 插件、resolver 都在这里——渲染层由 Vite 打包进产物，运行时不需要 node_modules。
  - `dependencies`：**只放主进程 / 预加载的运行时依赖**。`electron.vite.config.ts` 给 `main` 与 `preload` 设了 `externalizeDeps: true`，它们不打进 bundle，必须随包分发。目前有 `defu`、`electron-updater`、`pino`、`pino-roll`、`semver`、`write-file-atomic`、`yaml`。
    - 注意 `pino-pretty` 刻意**留在 `devDependencies`**：它是开发态控制台的格式化器，打包产物里不该有它（`kernel/logger` 只在 `NODE_ENV=development` 时才把它作为 transport 目标）。
  - 判断方法：`grep` 该包在 `src/main` / `src/preload` 是否有 import——有则 `dependencies`，只被 `src/renderer` 或构建配置使用则 `devDependencies`。
- 用户可见的日志与错误必须走现有日志入口与 i18n（主进程 `mt()`、渲染层 `t()`），禁止硬编码文案。
- **日志统一走 pino**（不要新增裸 `console.*`）：
  - 主进程：`import { logger } from '../kernel/logger'` → `const log = logger('[Manager]')`，然后 `log.error({ err }, 'msg')`（结构化字段放第一参，消息放第二参）。
  - 渲染层：`import { logger } from './lib/logger'`，用法一致。渲染层的 pino 是 **browser 构建**，输出只能进 devtools；**warn 及以上会自动上报主进程落盘**（`POST /logs/renderer`）。
  - 落盘位置：`<配置目录>/logs/dsbox.log`（pino-roll，5 MB 轮转、保留 5 个历史文件）。开发态控制台走 pino-pretty 单行彩色，发行态走 JSON。
  - **两个故意保留 `console.*` 的地方**：`dsh/watchdog.ts`（`WATCHDOG_CODE` 是脱离进程的独立脚本，不能依赖 pino）；`extensions/loader/registry.ts` 的默认兜底 sink（加载器启动时会注入真 sink 替换它）。
  - 日志消息用**英文**（诊断文本，面向开发者；`[Manager]` / `[Core]` / `[ext]` / `[shell]` 作为 `tag` 沿用）。
- 保持渲染层安全底线：`contextIsolation` 开启、渲染层无 Node、只经 `window.api`；放宽必须说明理由。

## 兼容性与回退

- `settings.json` 结构变更**必须向后兼容**：升 `settingsVersion` 并保留旧值迁移，用户数据不丢。
- 发布保持 A/B 版本槽 + 启动健康守卫自动回退（`app/appslots.ts`）能力。

## 技能维护

- `deepseek-box` 技能**攒一批再统一更新**；但影响开发方式的改动（新增约定、目录、命令、契约同步点）不要长期漏记。
- 技能 `metadata.version` 跟随应用版本（`package.json`）。

## 命令与工具调用

- **可用时把多条命令堆叠进同一次调用**（用 `;` / `&&` 串联，或写成一段脚本一次跑完），减少无谓的往返；互不依赖的只读命令也尽量合并到一次调用，而不是反复单独发起。
- 串联时让失败可见：用 `&&` 串联，或显式检查 `$LASTEXITCODE`；不要用 `;` 把前面命令的失败藏掉。

## 验证边界（本仓库无自动化测试）

- **本仓库不含单元测试**：`tests/`、`scripts/`、`vitest.config.mjs`、`.githooks/` 与 `vitest` 依赖均已移除，
  `package.json` 里也没有 `test` / `test:watch` / `test:coverage` 脚本。
- **质量门禁只有静态检查**：`npm run check` = `typecheck` + `lint`；CI（`.github/workflows/quality.yml`）
  在 `dev` 分支与 PR 上跑同一套。提交前请自行执行（本仓库不启用 Git hooks）。
- agent 可跑 `npm run check` / `typecheck` / `lint`（必要时 `npm run build`）。
- **纯逻辑改动没有单测兜底**（`src/shared/**` 的 version / i18n / hotkeys / errors，`src/main/**` 的
  版本比较 / 路径与文件助手 / 设置归一化等）。需要验证副作用行为时，写**一次性探针脚本**放 `.agents/temp/`
  （见 references/main-process.md 的「在无 electron 环境下验证主进程模块」），验证完保留即可，不必删。
- **不要新建 `tests/` 目录或 `*.test.ts` 文件**。
- **运行时行为（窗口、托盘、下载、迁移、代理、自更新、界面）仍由用户验证**：不要自行 `npm run dev`
  启动应用；交付说明里写清需要用户验证的步骤。

## 版本与发布

- **版本号规范：正式版 `X.Y.Z`，预发布 `X.Y.Z-{alpha|beta|rc}.N`** —— 主次修订三段 +（可选）预发布通道 + 通道内序号。
  - 三段数字**正常递增**（`0.1.6` 就是 `0.1.6`），不要用 `0.0.0` 之类的占位值——那会让「哪个版本更新」需要额外解释；
  - 通道只有 `alpha` / `beta` / `rc` 三种，序号从 `.0` 起递增（`0.1.6-alpha.2` → `0.1.6-alpha.3`）；
  - semver 的预发布比较是**字典序优先**，故 `alpha < beta < rc`，升级链天然正确；
  - 原来由 `tests/shared/version-convention.test.ts` 守护（含「四处版本号一致」）；**该测试已随 `tests/` 移除**，现须人工核对四处一致。
- 升版本要**同时改四处**（均由发布者手动指定，没有自动改版本的 hook）：`package.json` 的 `version`、`package-lock.json` 顶层的 `version` 与 `packages[""].version`、技能 `SKILL.md` 的 `metadata.version`（跟随应用版本）。
- 版本号一律**不带 `v` 前缀**（`v` 只出现在 Git tag 上）。
- CI 校验 **Git tag（`v` + 版本号）== package.json 版本**；是否预发布由版本号是否包含 `-` 决定 —— `build-release.yml` 据此选 `publish.releaseType`，应用内 `isPrerelease()` 是同一判据，三者必须一致。
- 工作流：`.github/workflows/build-release.yml`（tag 触发打包发布）、`deploy-docs.yml`（`main` 改动 `docs/**` 时部署文档站）。
- 本地打包：`npm run build` 后 `npm run dist:win`（另有 `dist:mac` / `dist:linux`）。

## 已知问题与待办

- `docs/public/home-page.png` 仍是旧品牌截图，文档首页仍在引用，待重截。
- `Settings.funLocale` 是历史字段名，改名需伴随一次持久化迁移，故暂时保留。
- `src/renderer/src/components/TitleBar.vue` 里 `.icon-btn` 的注释引用了一个仓库中并不存在的 `AGENT.md`，待清理。
