# Environment Management (Node / npm)

To run dsh, this app needs a **Node** and an **npm**. This page explains the sources of both, versioned installation and switching, and download behavior. The related interface is under “Settings → Environment”.

## Node runtime: three sources

Click a tab to switch; **changes take effect only after restarting dsh** (there is an “Apply Now” at the bottom of the page).

| Source | Description |
|---|---|
| **Bundled with the program** | Uses the Node bundled with Electron; it upgrades together with the app and cannot be updated separately. The most hassle-free. |
| **System** | Uses the Node you installed yourself; shows the current version and the latest LTS, and offers “Go to download” when behind. The app does **not** modify the system installation directory. |
| **Locally deployed** | Downloaded and managed by the app, installed into `<config dir>/node/<version>/`, with **multiple versions coexisting**. |

Running DeepSeek Harness requires **Node ≥ 20**; selecting an older major version shows a warning.

### Locally deployed: install and switch

- Open the version dropdown to select any version (check “Include non-LTS (Current)” to show non-LTS versions);
- After clicking download, progress and speed are shown; **both the download and the extraction can be canceled**; the extraction phase has its own animation;
- The “Installed versions” list below shows all versions; you can **switch** the active version (changes only the pointer, no reinstall) or **delete** one;
- If dsh is currently running on the version you want to overwrite, you are prompted to stop it first.

> “Latest LTS” is taken from the nodejs.org release index and cached by the main process for 10 minutes; when offline or when the proxy is unreachable it shows “Unable to get the latest version”.

## npm source: three sources

Likewise, click a tab to switch.

| Source | Description |
|---|---|
| **Bundled with the program** | Downloaded and extracted to `<config dir>/npm/<version>/` on first use and managed by the app; multiple versions coexist and can be switched / deleted. |
| **System** | Uses the system npm; updating performs a **global install**, which genuinely modifies the system global npm. |
| **Bundled with local Node** | Uses the npm bundled with the “Locally deployed” Node; updates are installed into that Node under the configuration directory. |

Each tab shows the **current version** and the **latest version on the registry**; when behind or not ready, “Download npm / Update npm” appears. Below, a shared **version selector** (with an “Include pre-releases” checkbox) lets you install any historical version, applying to the source selected above.

### Fallback when the version list is empty

Pre-releases / test builds are hidden by default; if **only** pre-release versions exist remotely, the list automatically falls back to showing them, avoiding an empty list.

## Downloader

- File downloads for Node / npm / app updates are **multi-threaded and segmented by default** (concurrent HTTP Range requests); the concurrency is adjusted under “Settings → Network → Download” and defaults to **Auto** (2–8, derived from this machine's CPU core count), or you can pin it manually between 1 and 16 (1 = single-threaded);
- The progress bar shows **downloaded / total size** and the **real-time speed**;
- Unfinished temporary files are all placed in **`temp/download` under the working directory** and are moved to the target location once complete;
- Duplicate requests for the **same target file** are merged into a single in-flight task; later callers share the result and progress, with no duplicate downloads.

## npm cache

The cache directory for all npm calls (DeepSeek Harness installation, npm self-update, npm of the bundled / local Node) points uniformly to **`temp/npm` under the working directory**, and is not written to `~/.npm` in the user's home directory.

## Related settings

- Mirror and proxy: [Settings → Network](/en/user/settings)
- Download concurrency: [Settings → Network](/en/user/settings)
