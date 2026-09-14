# DeepSeek Harness Management

DeepSeek Harness is the program that actually drives the dsh Web UI; its npm package is `@deepseek-ai/dsh` and its command is `dsh`. This page explains how to install, update, switch, and uninstall it. The related interface is under “Settings → DeepSeek Harness”.

## Source

| Source | Description |
|---|---|
| **Bundled** (default) | Installed by the app into `dsh/<version>/` under the configuration directory and run with the selected Node / npm; you can install, update, and switch versions inside the app. |
| **Global** | Uses the dsh you installed on your system with `npm install -g @deepseek-ai/dsh`; the app does not manage its version. |

When “Global” is selected, you need to specify the **launcher path** (pick it with the file chooser).

## Startup settings

The “Settings → DeepSeek Harness” page also has a whole **Startup** section:

- **Timeout** (`timeoutMs`): the number of milliseconds to wait for dsh to start and print its address, default 90000 ms;
- **Running state and button group**: shows whether dsh is “Running” or “Stopped”, with **Start / Stop / Restart**;
- **Apply now**: saves the current settings and applies them immediately (restarting dsh so they take effect).

## First-time installation

When DeepSeek Harness is not detected, the app pops up the **installation wizard**: choose the mirror, whether to include test builds, and the version to install, then click “Install DeepSeek Harness”. The app starts dsh automatically once installation completes.

## Check and update

- Under “Settings → DeepSeek Harness” you can check **Check at startup** and **Include test builds**;
- Click “Check / Update DeepSeek Harness” to compare the current and latest versions;
- **When already up to date, no dialog is shown**; the result is echoed on one line below the button (including the version number resolved remotely). When a newer version is found, a small red dot lights up on the status-bar version item.

## Switch / roll back versions

- Refresh the version list (affected by “Check for test builds” and the mirror);
- Select any historical version to install / switch (upgrade or rollback). The version list hides test builds by default; if only test builds exist remotely, they are shown automatically;
- Bundled versions are stored under `dsh/<version>/`, with **multiple versions coexisting**; in “Installed versions” you can **switch** among them (changing only the active pointer, no reinstall) or delete one.

## Uninstall

Clicking “Uninstall DeepSeek Harness” stops dsh first and then removes it, after which you return to the installation guide. If uninstalling fails, the app detects the reason the directory is in use (process reference, read-only, security software lock) and reports it.

::: warning When upgrading / switching / uninstalling
These operations **first safely stop all running dsh instances** (if one is running, a confirmation is shown first). On success the app restarts automatically to run the new version; on failure it tries to restore the previous running state and gives the reason.
:::

## Network and mirrors

Version lists, update checks, and install / uninstall all go through npm. The default official source is `registry.npmjs.org`; in China you can switch to `npmmirror`.

## Difference from “app self-update”

- **DeepSeek Harness update**: updates `@deepseek-ai/dsh` (via npm), managed on this page;
- **App self-update**: updates this shell app (via GitHub releases), managed on the [About page](/en/user/update).
