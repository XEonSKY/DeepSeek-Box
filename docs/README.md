# 文档站维护说明

基于 [VitePress](https://vitepress.dev/) 的中英双语站点。**内容**在本目录（`docs/`），**构建逻辑**在仓库根（`.vitepress/config.mts`）。

## 目录结构

站点分「用户文档」与「开发文档」两类，各自再分中英；URL 前缀与目录一一对应。

```text
.
├─ .vitepress/config.mts   # 站点配置（srcDir: 'docs'，输出 .vitepress/dist）
└─ docs/
   ├─ index.md             # 根路径跳转（meta refresh → /zh/，另附中英入口表作兜底）
   ├─ zh/
   │  ├─ index.md          # 中文首页（hero + 分流到 user / dev）
   │  ├─ user/             # 用户文档：index / download / quickstart / usage / settings / environment / dsh / models / update / faq
   │  └─ dev/              # 开发文档：index / setup / architecture / modules / renderer / ipc / installs / config-dir / app-update / release / conventions
   ├─ en/                  # 英文页面，与 zh/ 一一对应
   ├─ public/              # CNAME / .nojekyll / logo.png / home-page.png
   └─ README.md            # 本文件（srcExclude，不发布）
```

仓库根的 `README.md` / `README.en.md` 是面向用户的项目说明，中英互为语言版本，不属于站点内容。

## URL 与链接约定

| 文档 | 中文 URL | 英文 URL |
|---|---|---|
| 用户文档 | `/zh/user/...` | `/en/user/...` |
| 开发文档 | `/zh/dev/...` | `/en/dev/...` |

- 站内链接必须带语言前缀与分类前缀；
- 中英页面**成对存在**，新增页面要同步 `.vitepress/config.mts` 的 nav / sidebar（两份语言都改）。

## 命令（在仓库根执行）

```bash
npm run docs:dev       # 本地预览（默认 http://localhost:5173）
npm run docs:build     # 构建到 .vitepress/dist
npm run docs:preview   # 预览构建产物
```

## 发布

- 推送到 `main` 且改动涉及 `docs/**`、`.vitepress/**` 或依赖清单时，`.github/workflows/deploy-docs.yml` 会自动构建并部署到 GitHub Pages；
- 发布到 GitHub Pages / 自定义域名时，请在 `config.mts` 设置 `base` 后重新构建部署；
- `public/` 作为静态资源目录，产物默认输出 `.vitepress/dist`（已 gitignore）。
