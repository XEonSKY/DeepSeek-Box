# Download & System Requirements

DeepSeek Box is a cross-platform desktop application; installers are published on GitHub Releases.

## System requirements

| Item | Requirement |
|---|---|
| Operating system | Windows 10/11 (x64 / arm64), macOS, mainstream Linux (x64 / arm64) |
| Runtime | **No pre-installed Node.js required**: you can use the Node bundled with Electron, let the app download and deploy a local Node, or use the system Node (≥ 20) |
| Network | An internet connection is required on first run to download DeepSeek Harness and the (optional) Node / npm; afterwards only the local loopback address is used |
| Disk | Installer + DeepSeek Harness and runtime (roughly tens to hundreds of MB each time, depending on the chosen source) |

::: info
DeepSeek Harness `@deepseek-ai/dsh` is detected automatically by the app; when it is missing, an installation wizard pops up where you can choose the official `registry.npmjs.org` or the `npmmirror` mirror.
:::

## Where to download

Use these fixed entry points — there is no version to pick by hand:

- **Latest stable release (recommended)**: <https://github.com/XEonSKY/DeepSeek-Box/releases/latest>
  - The stable build for everyday use; this URL redirects to the newest stable release page.
- **Latest pre-release**: <https://github.com/XEonSKY/DeepSeek-Box/releases?q=prerelease%3Atrue&expanded=true>
  - Test builds such as `-alpha` / `-beta` / `-rc`; they **may be unstable** — use them only to try new features or help test.
- **All releases (including older versions)**: <https://github.com/XEonSKY/DeepSeek-Box/releases>

Once the page is open, pick the artifact for your system and architecture. Artifacts are named like:

```text
DeepSeek-Box-<version>-<platform>-<arch>.<extension>
```

| System | Artifact |
|---|---|
| Windows | `...-win-x64-setup.exe` / `...-win-arm64-setup.exe` |
| macOS | `...-mac-x64.dmg` / `...-mac-arm64.dmg` (a `.zip` is also provided for auto-update) |
| Linux | `...-linux-x64.AppImage` / `...-linux-arm64.AppImage` |

## Which architecture to choose

Match the architecture of **the process you run**: ARM machines download the `arm64` build, Intel / AMD download the `x64` build. If unsure, on macOS check the chip under “About This Mac”, and on Windows check the system type under “Settings → System → About”.

## Installation

- **Windows**: run `*-setup.exe`; if you see an “Unknown publisher” prompt, follow the system prompts to allow it (open-source apps typically do not have a paid signature).
- **macOS**: open the `*.dmg` and drag the app into “Applications”; if it is blocked on first launch, go to “System Settings → Privacy & Security” and choose to open it anyway.
- **Linux**: AppImage requires executable permission first: `chmod +x *.AppImage`, then run it directly.

## Verification & security

- Download only from the official Releases; the app's self-update also goes through GitHub releases.
- If your network is slow to reach GitHub, or a proxy is required, enable the proxy under “Settings → General → Network” and tick **app updates**.
- By default this app listens only on `127.0.0.1` and does not expose ports externally.

## Next steps

Once installation is complete, continue with [Quick Start](/en/user/quickstart).
