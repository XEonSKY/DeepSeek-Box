---
layout: home

hero:
  name: DeepSeek Box
  text: Desktop shell around DeepSeek Harness
  tagline: Launch DeepSeek Harness with Electron and put the dsh Web UI, web chat and the top-up platform into one desktop window. Double-click to run — no command line.
  image:
    src: /home-page.png
    alt: DeepSeek Box main window
  actions:
    - theme: brand
      text: User guide
      link: /en/user/
    - theme: alt
      text: Developer guide
      link: /en/dev/

features:
  - icon: 🧩
    title: Browser-style tabs
    details: The three pinned sites (dsh Web UI / web chat / usage & top-up) sit as icon buttons in the title bar; links opened from a page become dynamic tabs you can star to keep alive and drag to reorder.
  - icon: 🪟
    title: Multiple windows
    details: Right-click "Open in new window" to tear off a secondary window; tabs can be dragged between windows, and the earliest secondary window takes over once the core window closes.
  - icon: 🧰
    title: Self-managed environment
    details: Use the bundled Node + npm, or your system Node; versioned installs you can switch and roll back without touching a terminal.
  - icon: 🔄
    title: Self-managed DeepSeek Harness
    details: Install / upgrade / switch / uninstall @deepseek-ai/dsh, safely stopping a running server first.
  - icon: ⬇️
    title: Multi-threaded downloads
    details: Concurrent HTTP range requests with live speed and size, no duplicate downloads for the same file, and cancellable download / extraction.
  - icon: 🌓
    title: Theme and privacy
    details: Follow system / light / dark theme, hide to the system tray, and stay on local 127.0.0.1 only.
---

## What this is

DeepSeek Box is the desktop entry point and environment manager for **DeepSeek Harness** (command `dsh`, npm package `@deepseek-ai/dsh`): it starts and supervises the dsh process in the background, embeds the Web UI in a native window, and can manage Node, npm and dsh versions on your behalf.

It does **not replace** dsh — conversations, workspaces and sessions still belong to DeepSeek Harness itself, and the server listens on local `127.0.0.1` only.

## Quick links

<div class="card-grid">
  <a class="card" href="/en/user/download">
    <h3>⬇️ Download & install</h3>
    <p>Pick the installer for your system and install in minutes.</p>
  </a>
  <a class="card" href="/en/user/quickstart">
    <h3>🚀 Quick start</h3>
    <p>First launch: a four-step wizard gets you running.</p>
  </a>
  <a class="card" href="/en/user/usage">
    <h3>🖥 Interface & usage</h3>
    <p>Tabs, address bar, multiple windows, menus and shortcuts.</p>
  </a>
  <a class="card" href="/en/user/settings">
    <h3>⚙️ Settings</h3>
    <p>Theme, language, registry, proxy, downloads and DeepSeek Harness options.</p>
  </a>
  <a class="card" href="/en/user/faq">
    <h3>❓ FAQ</h3>
    <p>Troubleshooting launch, install, download and update issues.</p>
  </a>
  <a class="card" href="/en/dev/">
    <h3>🧑‍💻 Developer guide</h3>
    <p>Architecture, modules, IPC, install pipeline and releases.</p>
  </a>
</div>

## Up and running in three steps

<div class="steps">
  <div class="step">
    <span class="step__no">1</span>
    <h3>Download</h3>
    <p>Get the installer for your platform from Releases.</p>
  </div>
  <div class="step">
    <span class="step__no">2</span>
    <h3>Follow the wizard</h3>
    <p>Registry → Node → npm → install DeepSeek Harness: four steps to finish setup.</p>
  </div>
  <div class="step">
    <span class="step__no">3</span>
    <h3>Start chatting</h3>
    <p>Pick a workspace, start a new session and describe what you need.</p>
  </div>
</div>

## Where to start

| Your situation | Start here |
| --- | --- |
| First time using it | [Download & requirements](/en/user/download) → [Quick start](/en/user/quickstart) |
| Want to understand every setting | [Settings](/en/user/settings) |
| Want another theme, language or zoom | [Settings](/en/user/settings) |
| Want to change the code | [Developer guide](/en/dev/) |
| Something is broken | [FAQ](/en/user/faq) |

::: tip Chinese site
Use the **简体中文** switch in the top-right for the Chinese docs, or read the [README](https://github.com/XEonSKY/DeepSeek-Box#readme) at the repository root.
:::
