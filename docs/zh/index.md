---
layout: home

hero:
  name: DeepSeek Box
  text: 桌面外壳 · 内嵌 DeepSeek Harness
  tagline: 用 Electron 拉起 DeepSeek Harness，把 dsh Web UI、网页版对话与充值平台装进一个桌面窗口。双击即用，无需命令行。
  image:
    src: /home-page.png
    alt: DeepSeek Box 主界面
  actions:
    - theme: brand
      text: 用户文档
      link: /zh/user/
    - theme: alt
      text: 开发文档
      link: /zh/dev/

features:
  - icon: 🧩
    title: 浏览器式标签页
    details: dsh Web UI / 网页对话 / 用量充值三个固定站以标题栏图标按钮常驻，页面里打开的新链接自动成为动态标签，可星标保活、拖动排序。
  - icon: 🪟
    title: 多窗口
    details: 右键「在新窗口打开」拆出副窗口，标签可在窗口间拖动迁移；核心窗口关闭后由最早的副窗口自动接管。
  - icon: 🧰
    title: 自管理环境
    details: 可选内置 Node + 内置 npm，也可用系统 Node；版本化安装、随时切换与回退，无需命令行。
  - icon: 🔄
    title: 自管理 DeepSeek Harness
    details: 自动下载 / 升级 / 切换 / 卸载 @deepseek-ai/dsh，操作前自动安全停止运行中的服务。
  - icon: ⬇️
    title: 多线程下载
    details: HTTP Range 分段并发，显示实时速度与文件大小，同一文件不重复下载，下载与解压都可取消。
  - icon: 🌓
    title: 主题与隐私
    details: 主题跟随系统 / 浅色 / 深色，可关闭到系统托盘；仅使用本地 127.0.0.1。
---

## 它是什么

DeepSeek Box 是 **DeepSeek Harness**（命令 `dsh`，npm 包 `@deepseek-ai/dsh`）的桌面入口与环境管家：在后台启动并守护 dsh 进程，把 Web UI 嵌进原生窗口，还可以代管 Node、npm 与 dsh 的版本。

它**不替代** dsh —— 对话、工作区、会话等数据仍然属于 DeepSeek Harness 本身；默认只监听本机 `127.0.0.1`。

## 快速导航

<div class="card-grid">
  <a class="card" href="/zh/user/download">
    <h3>⬇️ 下载与安装</h3>
    <p>选择适合你系统的安装包，几分钟完成安装。</p>
  </a>
  <a class="card" href="/zh/user/quickstart">
    <h3>🚀 快速开始</h3>
    <p>第一次启动：四步向导，跟着点即可用起来。</p>
  </a>
  <a class="card" href="/zh/user/usage">
    <h3>🖥 界面与操作</h3>
    <p>标签页、地址栏、多窗口、右键菜单与快捷键。</p>
  </a>
  <a class="card" href="/zh/user/settings">
    <h3>⚙️ 设置说明</h3>
    <p>主题、语言、镜像源、代理、下载与 DeepSeek Harness 选项。</p>
  </a>
  <a class="card" href="/zh/user/faq">
    <h3>❓ 常见问题</h3>
    <p>启动、安装、下载与更新的排查与解决。</p>
  </a>
  <a class="card" href="/zh/dev/">
    <h3>🧑💻 开发文档</h3>
    <p>架构、模块、IPC、安装链路与构建发布。</p>
  </a>
</div>

## 三步上手

<div class="steps">
  <div class="step">
    <span class="step__no">1</span>
    <h3>下载安装</h3>
    <p>从 Releases 下载对应平台的安装包并安装。</p>
  </div>
  <div class="step">
    <span class="step__no">2</span>
    <h3>跟着向导</h3>
    <p>镜像源 → Node → npm → 安装 DeepSeek Harness，四步完成初始化。</p>
  </div>
  <div class="step">
    <span class="step__no">3</span>
    <h3>开始对话</h3>
    <p>选择工作区、新建会话，直接描述你的需求。</p>
  </div>
</div>

## 该从哪里看起

| 你的情况 | 建议从这开始 |
| --- | --- |
| 第一次使用 | [下载与系统要求](/zh/user/download) → [快速开始](/zh/user/quickstart) |
| 想弄清每个设置项 | [设置说明](/zh/user/settings) |
| 想换主题、语言或缩放 | [设置说明](/zh/user/settings) |
| 想改代码 | [开发文档](/zh/dev/) |
| 遇到问题 | [常见问题](/zh/user/faq) |

::: tip 英文站
右上角的 **English** 可切换到英文文档；也可以在仓库根目录查看 [README](https://github.com/XEonSKY/DeepSeek-Box#readme)。
:::
