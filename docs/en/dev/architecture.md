# Architecture

## Tech stack

Electron 44 · electron-vite 5 · Vite 7 · Vue 3 · TypeScript · Element Plus · Pinia · vue-i18n · @xterm/xterm.

## The three processes

| Process | Directory | Responsibility |
|---|---|---|
| **Main process** | `src/main/` | Create the window and tray, manage config, start / supervise dsh, download and install, app self-update |
| **Preload** | `src/preload/` | Expose `window.api` via `contextBridge` (the type `RendererApi` is defined in `shared/types.ts`) |
| **Renderer** | `src/renderer/` | Vue 3 UI: tab shell, settings page, install wizard, terminal |

Shared code (types, i18n, version utilities) lives in `src/shared/` and is available to all three.

## Startup flow

Main-process entry `src/main/index.ts`:

1. **dev/release isolation**: in development, point `userData` at `"<app> (dev)"` so it does not fight the installed build over the single-instance lock;
2. **Register the config-directory migration**: `ensureDefaultConfigMigration()` (must run before any settings are read);
3. **Read startup settings**: whether to ignore OS scaling and whether hardware acceleration is enabled;
4. **Single-instance lock**: quit immediately if the lock is not acquired; a second launch brings the existing window to the front;
5. **After app ready**: register IPC → create the window → create the tray → register global shortcuts;
6. `await waitForConfigMigration()`: when a config-directory migration is pending, finish it first (with progress broadcasts), then continue;
7. `await migrateLegacyInstalls()`: migrate the old flat install directories into the versioned layout;
8. Start the config file watcher; if DeepSeek Harness already exists, `restart()` to start dsh;
9. Check for app updates according to settings.

## Lifecycle and quitting

- **Closing the window**: hides to the tray by default (can be changed in settings to quit directly); closing the window does **not** stop dsh.
- **Really quitting**: `before-quit` first calls `preventDefault()`, gracefully stops dsh asynchronously (`stopDshGracefully()`) → cleans up the remaining child processes → releases the second `app.quit()`.
- **Safety net**: `process.on('exit')` kills the server and child processes once more to avoid orphans.

## Window and tab model

- The core window hosts three fixed sites (dsh Web UI / web chat / usage & top-up); the core-window registration and takeover logic lives in `app/windowreg.ts` and the renderer's `shell/tabs.ts`.
- Secondary windows are created by "Open in new window"; tabs can be dragged in / out, and after the core window closes the earliest secondary window takes over.
- Embedded pages use `<webview>`; the address bar is shown only for dynamic tabs, and protocol / search routing lives in the renderer.

## Data and configuration

- **App settings**: `settings.json` under the config directory (not Electron's userData);
- **dsh's own settings**: `~/.dsh/settings.yaml`; the app syncs theme / language there;
- **DeepSeek Harness / Node / npm**: stored per version under the config directory, see [DeepSeek Harness & environment install pipeline](/en/dev/installs).

## Related documents

- [Main-process modules](/en/dev/modules)
- [Renderer](/en/dev/renderer)
- [IPC contract](/en/dev/ipc)
