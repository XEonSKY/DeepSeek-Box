# 用户文档

DeepSeek Box 把 **DeepSeek Harness**（npm 包 `@deepseek-ai/dsh`，命令 `dsh`）装进一个桌面窗口：双击即可启动，不用命令行、不用手动配环境。本分类面向**日常使用者**。

::: tip
想改代码或了解内部实现，请转到[开发文档](/zh/dev/)。
:::

## 按功能查阅

<div class="card-grid">
  <a class="card" href="/zh/user/download">
    <h3>⬇️ 下载与系统要求</h3>
    <p>选择平台与架构，确认系统要求后安装。</p>
  </a>
  <a class="card" href="/zh/user/quickstart">
    <h3>🚀 快速开始</h3>
    <p>第一次启动：四步向导与主界面导览。</p>
  </a>
  <a class="card" href="/zh/user/usage">
    <h3>🖥 界面与操作</h3>
    <p>标签页、地址栏、多窗口、右键菜单、快捷键与托盘。</p>
  </a>
  <a class="card" href="/zh/user/settings">
    <h3>⚙️ 设置说明</h3>
    <p>常规、外观、网络、环境、DeepSeek Harness、模型、终端与关于。</p>
  </a>
  <a class="card" href="/zh/user/environment">
    <h3>🧰 环境管理（Node / npm）</h3>
    <p>三种来源、版本化安装与切换、下载器与缓存。</p>
  </a>
  <a class="card" href="/zh/user/dsh">
    <h3>🔄 DeepSeek Harness 管理</h3>
    <p>安装、更新、切换 / 回退版本与卸载。</p>
  </a>
  <a class="card" href="/zh/user/models">
    <h3>🧠 模型与余额</h3>
    <p>模型列表、供应商与余额查询；密钥不离开主进程。</p>
  </a>
  <a class="card" href="/zh/user/update">
    <h3>📦 应用更新与回退</h3>
    <p>后台更新、保留旧版与一键回退。</p>
  </a>
  <a class="card" href="/zh/user/faq">
    <h3>❓ 常见问题</h3>
    <p>启动、安装、下载与更新的排查与解决。</p>
  </a>
</div>

## 建议阅读顺序

1. [下载与系统要求](/zh/user/download) —— 选对安装包、确认系统支持；
2. [快速开始](/zh/user/quickstart) —— 第一次启动，跟着向导走完四步；
3. [界面与操作](/zh/user/usage) —— 标签页、多窗口、快捷键；
4. [设置说明](/zh/user/settings) —— 每个设置项到底管什么。

## 它和 DeepSeek Harness 的关系

本应用**不替代** DeepSeek Harness，而是它的**桌面入口 + 环境管家**：负责启动与守护 dsh 进程、把界面嵌进原生窗口、并可选地代管 Node、npm 与 DeepSeek Harness 版本。对话、工作区、会话等数据仍然属于 DeepSeek Harness 本身。
