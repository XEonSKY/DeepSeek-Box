# 构建与发布

## 版本号

- 版本号以 `package.json` 为准，同时同步到 `package-lock.json`；
- CI 会校验 **Git tag == package.json 版本**；
- 是否预发布由版本号是否包含 `-` 动态决定（如 `0.1.5-beta-1` 属预发布）。

## CI 工作流

| 工作流 | 触发 | 作用 |
|---|---|---|
| `.github/workflows/build-release.yml` | push 版本 tag（`v*`） | 构建各平台安装包并发布 GitHub Release |
| `.github/workflows/deploy-docs.yml` | push 到 `main` 且改动涉及 `docs/**` / `.vitepress/**` / 依赖 | 构建 VitePress 并部署到 GitHub Pages |

## 本地打包

```bash [本地打包]
npm run build        # 构建 out/
npm run dist:win     # 打包 Windows（另有 dist:mac / dist:linux）
```

## 发布流程

1. 修改 `package.json` 与 `package-lock.json` 的版本号；
2. 提交并推送到 `main`（推远程前需确认）；
3. 打 tag（如 `v0.1.5-rc-1`）并推送，触发 `Build & Release`；
4. 文档改动若推到 `main`，会另行触发 Pages 部署。

::: warning
推送远程前必须先说明目标（分支 / 标签、是否强推）并征得确认，见[开发约定](/zh/dev/conventions)。
:::

## 文档站

- 内容在 `docs/`，按语言（`zh/`、`en/`）与分类（`user/`、`dev/`）组织；
- 逻辑（nav / sidebar / 语言）在 `.vitepress/config.mts`；
- 新增页面后要同步 nav / sidebar，且中英成对；
- 构建：`npm run docs:build`，产物 `.vitepress/dist`（已忽略）。

站点维护说明见仓库中的 `docs/README.md`（该文件不进站点）。

## 相关

- [开发约定](/zh/dev/conventions)
- [开发环境与命令](/zh/dev/setup)