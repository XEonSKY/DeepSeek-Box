# Quick Start

Once installation is complete, just launch the app for the first time and it is ready to use.

![DeepSeek Box main interface](/home-page.png)

## Step 1: Launch the app

Double-click the desktop icon or the Start menu shortcut. The app first checks whether DeepSeek Harness is ready:

- Ready: it starts dsh directly and embeds the main interface;
- DeepSeek Harness not detected: it shows the full-screen **installation wizard** (see Step 2).

## Step 2: Follow the wizard to finish initialization

The wizard has four steps in total; on each one click “Run and Next”:

| Step | What you see | Not sure how to choose? |
|---|---|---|
| 1. Mirror / config directory | Official source / npmmirror mirror; the config directory can be “Choose…” or “Restore Default” | In China choose **npmmirror**, it is faster; keep the default config directory |
| 2. Node environment | Electron bundled / System bundled / Locally deployed | No Node installed on this machine: choose **Locally deployed**; don't want extra downloads: choose **Electron bundled** |
| 3. npm environment | Bundled with the program / System bundled / Bundled with local Node | **Bundled with the program** is the most hassle-free |
| 4. Install DeepSeek Harness | Version dropdown + install button | Just use the default version and click “Install DeepSeek Harness” |

A few notes:

- When you choose “Locally deploy Node” or “npm bundled with the program”, the app **downloads the corresponding runtime automatically first** (showing progress) and only proceeds to the next step when it completes;
- Each step lets you pick a **specific version**: for Node you can check “Include non-LTS (Current)”, and for npm you can check “Include pre-releases”; if only pre-release versions exist remotely, the list automatically shows them instead of being empty;
- Both the download and extraction processes can be **canceled**; the extraction phase has its own animation;
- Only one loading animation is shown at any moment.

Once installation completes, the app starts dsh automatically; the Web UI appearing means it is ready.

## Step 3: Get to know the main interface

After launch, the interface consists of three parts:

1. **Top title bar**: the app name and **three pinned-site icon buttons** (DeepSeek UI / Web Chat / Usage & Top-up) on the left; next to them is the browser-style tab strip, carrying dynamic tabs and the `＋` on the right to open a new tab; on the far right are refresh, settings, and minimize / maximize / close.
2. **Main area**: the left vertical column has the DeepSeek Harness logo, “New Session”, and the “Workspaces” list; in the middle are the welcome message, workspace / mode selection, the input box, and the model selector.
3. **“Settings” in the lower-left corner**: opens the settings page (an overlay that does not interrupt the current page).

For the complete description see [Interface & Operations](/en/user/usage).

## Step 4: Start using it

- Select or open a folder under “Workspaces”;
- Click “New Session” and describe what you want to do in the input box;
- Everything runs locally and, by default, listens only on `127.0.0.1`.

## Next steps

- Adjust language, theme, mirror, or proxy: [Settings Guide](/en/user/settings)
- Manage the Node / npm source and version: [Environment Management](/en/user/environment)
- Manage the DeepSeek Harness version: [DeepSeek Harness management](/en/user/dsh)
- View models and balances: [Models & balances](/en/user/models)
- Running into problems: [FAQ](/en/user/faq)
