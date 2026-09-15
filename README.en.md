<div align="center">

<img src="docs/public/logo.png" alt="DeepSeek Box" width="112" />

# DeepSeek Box

**DeepSeek Harness in a desktop window: double-click to use it — no command line, no manual environment setup.**

[简体中文](README.md) · English

[![Electron](https://img.shields.io/badge/Electron-^44-47848F?logo=electron&logoColor=white&style=flat-square)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white&style=flat-square)](https://vuejs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-eee?style=flat-square)](#)

</div>

![DeepSeek Box main window](docs/public/home-page.png)

> That is what it looks like once open: browser-style tabs on top, workspaces and sessions on the left, and a chat area in the middle.

**Contents**: [What is this](#what-is-this) · [Get started](#get-started) · [Features](#features) · [Interface tour](#interface-tour) · [FAQ](#faq) · [Run from source](#run-from-source) · [Links](#links)

---

## What is this

dsh (npm package `@deepseek-ai/dsh`) is normally started from a command line and then opened in a browser. For users who are not comfortable with a terminal, just getting Node and dsh installed and remembering the start command is a lot of work.

**DeepSeek Box is its desktop entry point**: it starts dsh for you in the background and embeds the interface in a native window. Double-click the icon and it takes care of the rest.

It does **not replace** dsh; it turns "start dsh" into a button. Conversations, workspaces and sessions still belong to DeepSeek Harness itself.

### Glossary

If these words are unfamiliar, start here:

| Term | Plain meaning |
| --- | --- |
| **DeepSeek Harness (dsh)** | The AI program that does the real work (`@deepseek-ai/dsh`) — think of it as the engine |
| **Node / npm** | The parts the engine needs in order to run; this app can download them for you |
| **Config directory** | Where the app keeps its own data; defaults to `~/.dsbox/release` (`~/.dsbox/dev` in dev builds) |
| **Workspace** | The folder dsh reads and writes files in |
| **Global install** | A dsh installed system-wide; if you already have one, the app can use it directly |

---

## Get started

### Step 1: Download and install

Open the [Releases](../../releases) page and download the installer for your system:

| System | What to download |
| --- | --- |
| Windows | `...-win-x64-setup.exe` (use `arm64` on ARM machines) |
| macOS | `...-mac-arm64.dmg` or `...-mac-x64.dmg` |
| Linux | `...-linux-x64.AppImage` |

Double-click to install or open. If the system warns about an unknown publisher, allow it (open-source apps usually have no paid code signing).

### Step 2: First launch, follow the wizard

On first launch the **setup wizard** opens automatically. It has four steps; click "Run and next" on each:

| Step | What you see | Not sure what to pick |
| --- | --- | --- |
| 1. Registry / config directory | Official registry or the npmmirror mirror; choose or reset the config directory | Pick **npmmirror** for faster downloads in mainland China; keep the default config directory |
| 2. Node environment | Bundled with Electron / system / local deployment | If Node is not installed, pick **Local deployment** or **Bundled with Electron** |
| 3. npm environment | Bundled / system / from your Node | **Bundled** is the easiest |
| 4. Install DeepSeek Harness | Version dropdown + install button | Keep the default version and click install |

Downloads and extraction can be cancelled at any time. To install another version, pick it from the dropdown. The app starts automatically once installation finishes — if you see the main window, you are done.

### Step 3: Start using it

1. Choose or open a folder under **Workspaces** on the left;
2. Click **New session** and describe what you want in the input box;
3. Everything runs locally (the server listens on `127.0.0.1` only).

---

## Features

- **One-click run**: locate / install / start / stop / restart dsh automatically; the window and the process live and die together, with no leftover background process.
- **Versioned installs and switching**: Node, npm and dsh are stored per version and can coexist, be switched or removed; if you pick the wrong one you can roll back, from **Settings → Environment / DeepSeek Harness**.
- **Self-contained environment**: optional bundled Node and npm, so the app runs even if nothing is installed system-wide; it can also detect an existing system Node (requires ≥ 20).
- **Multi-threaded downloads**: live speed and size, no duplicate downloads of the same file, and cancellable download and extraction.
- **Browser-style tabs and multiple windows**: the three pinned sites (dsh Web UI / web chat / usage and top-up) stay in the title bar as icon buttons; new links become dynamic tabs you can star and drag to reorder, or open in a new window.
- **Models and balances**: **Settings → Models** lists models and balances per provider (the first visit asks for consent to read local credentials; no key is ever shown). The current balance also stays in the status bar, refreshing every 5 minutes in the foreground, and you can click it to refresh.
- **Quiet update notice**: the status bar shows the app version and the dsh version; click it to check for updates. A new version only adds a small red dot instead of interrupting you.
- **App self-update**: new versions download in the background, the previous one is kept for one-click rollback, and a build that fails to start repeatedly rolls back automatically.
- **Movable config directory**: change the directory in Settings and it migrates on restart, showing progress and the current file.
- **Adjustable interface**: theme / dark mode, UI scaling, Chinese and English, plus extra translations.

---

## Interface tour

- **Title bar**: on the left are the app name and three pinned-site icon buttons (**DeepSeek UI** (the DeepSeek Harness interface), web chat, top-up platform); next to them is the tab strip with dynamic tabs and the `+` button; on the right are refresh, settings and minimize / maximize / close.
- **Main area (DeepSeek Harness interface)**: the left column holds the dsh mark, the **New session** button and the workspace list; the centre holds the welcome text, the workspace / mode pickers, the input box and the model picker; **Settings** sits at the bottom left.
- **Settings** opens as an overlay on top of the page, so switching back keeps your previous state; the terminal also lives in Settings and toggles with `Ctrl/Cmd + T`.

For the full walkthrough see [Interface & usage](docs/en/user/usage.md) ([简体中文](docs/zh/user/usage.md)).

---

## FAQ

<details>
<summary><b>I do not have Node installed. Can I still use it?</b></summary>

Yes. In the wizard pick **Local deployment** or **Bundled with Electron** for the Node environment and **Bundled** for npm; the app downloads what it needs.

</details>

<details>
<summary><b>The install is stuck or downloads are slow</b></summary>

Open **Settings → Network** and switch the npm registry to `npmmirror`; configure a proxy if needed (scopes include app, app update, DSH, npm install, Node download and version lookup). The concurrency setting defaults to **Auto** and can also be set manually on the same page.

</details>

<details>
<summary><b>I want to use my own globally installed dsh</b></summary>

Go to **Settings → DeepSeek Harness → DeepSeek Harness source**, choose **Global**, then pick the launcher path with the file picker.

</details>

<details>
<summary><b>I want a different look or language</b></summary>

Change the theme and colours under **Settings → Appearance**. The **Language** dropdown also offers extra translations; they only change this app, never your dsh data.

</details>

<details>
<summary><b>Does dsh keep running after I close the window?</b></summary>

The window hides to the system tray by default; quitting the app also stops the dsh it manages, leaving no leftover process.

</details>

<details>
<summary><b>Will updating lose the previous version?</b></summary>

The self-updater archives the current version first, so **Settings → About** can roll back with one click; a build that fails to start repeatedly also rolls back automatically.

</details>

More answers are in the [FAQ](docs/en/user/faq.md) ([简体中文](docs/zh/user/faq.md)).

---

## Run from source

For people who want to change the code. Requires Node ≥ 20:

```bash
git clone https://github.com/XEonSKY/DeepSeek-Box.git
cd DeepSeek-Box
npm install
npm run dev
```

Common commands: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run docs:dev`.

See the [Developer guide](docs/en/dev/) ([简体中文](docs/zh/dev/)) for details.

---

## Links

- Online docs: [简体中文](https://dsbox.xeonsky.com/zh/) · [English](https://dsbox.xeonsky.com/en/)
- Docs source: user guide [`docs/en/user/`](docs/en/user/) · developer guide [`docs/en/dev/`](docs/en/dev/) (Chinese under `docs/zh/`)
- Download: [latest release](../../releases/latest) · [latest pre-release](../../releases)
- Something broken? [Issues](../../issues)

---

<div align="center">

**If this project helps you, a Star is appreciated; open an Issue if something breaks.**

</div>
