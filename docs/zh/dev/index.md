# 开发文档

面向想理解内部实现、修 bug 或贡献代码的开发者。应用是 Electron + Vue 3 + TypeScript 的桌面外壳，运行 **DeepSeek Harness**（npm 包 `@deepseek-ai/dsh`，命令 `dsh`）。

::: tip
只想把应用用起来？请看[用户文档](/zh/user/)。
:::

## 按主题深入

<div class="card-grid">
  <a class="card" href="/zh/dev/setup">
    <h3>🧑🔧 开发环境与命令</h3>
    <p>跑起来、常用脚本、目录结构与数据位置。</p>
  </a>
  <a class="card" href="/zh/dev/architecture">
    <h3>🏗 架构总览</h3>
    <p>三进程模型、启动流程、生命周期与窗口 / 标签模型。</p>
  </a>
  <a class="card" href="/zh/dev/modules">
    <h3>📦 主进程模块</h3>
    <p>app/ 与 dsh/ 下每个模块的职责与导出。</p>
  </a>
  <a class="card" href="/zh/dev/renderer">
    <h3>🎨 渲染进程</h3>
    <p>Vue 结构、视图与组件、状态、主题与 i18n。</p>
  </a>
  <a class="card" href="/zh/dev/ipc">
    <h3>🔌 IPC 契约</h3>
    <p>REST 路由与事件、主要分组与新增端点的两处同步。</p>
  </a>
  <a class="card" href="/zh/dev/installs">
    <h3>⬇️ 安装链路</h3>
    <p>版本化目录、多线程下载器、取消、解压与 npm 缓存。</p>
  </a>
  <a class="card" href="/zh/dev/config-dir">
    <h3>📁 配置目录</h3>
    <p>默认位置、覆盖指针与两阶段迁移。</p>
  </a>
  <a class="card" href="/zh/dev/app-update">
    <h3>🔄 应用自更新</h3>
    <p>A/B 版本槽、健康守卫与回退。</p>
  </a>
  <a class="card" href="/zh/dev/release">
    <h3>🚢 构建与发布</h3>
    <p>版本同步、CI 工作流、打包与文档站部署。</p>
  </a>
  <a class="card" href="/zh/dev/conventions">
    <h3>📐 开发约定</h3>
    <p>代码风格、注释、临时文件与 Git 约定。</p>
  </a>
</div>

## 建议阅读顺序

1. [开发环境与命令](/zh/dev/setup) —— 跑起来、常用脚本、目录结构；
2. [架构总览](/zh/dev/architecture) —— 三进程模型、启动流程、生命周期；
3. [主进程模块](/zh/dev/modules) —— 每个模块负责什么；
4. [渲染进程](/zh/dev/renderer) —— Vue 结构、状态、主题与 i18n；
5. [IPC 契约](/zh/dev/ipc) —— main ↔ renderer 的 REST 契约与新增流程。

## 仓库速览

- 仓库根（= 本工作区根）同时承载应用与文档站；版本号在 `package.json`。
- 主进程源码 `src/main/`，预加载 `src/preload/`，渲染层 `src/renderer/`，共享代码与类型 `src/shared/`。
- 文档站内容 `docs/`，逻辑 `.vitepress/config.mts`。

::: info
AI 工作规则见 `.dsh/README.md`；文档站导航见其中的「文档站导航」表。
:::
