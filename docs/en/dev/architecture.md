# Architecture

## Tech stack

Electron 44 · electron-vite 6 · Vite 8 (rolldown core) · Vue 3 · TypeScript · Element Plus · Pinia · vue-i18n · @xterm/xterm.

## The three processes

| Process | Directory | Responsibility |
|---|---|---|
| **Main process** | `src/main/` | Create the window and tray, manage config, start / supervise dsh, download and install, app self-update |
| **Preload** | `src/preload/` | Expose `window.api` via `contextBridge` (a REST client; the contract `ApiRoutes` is defined in `shared/api.ts`) |
| **Renderer** | `src/renderer/` | Vue 3 UI: tab shell, settings page, install wizard, terminal |

Shared code (types, i18n, version utilities) lives in `src/shared/` and is available to all three.

## Main-process layering: a microkernel

Inside the main process, this is a **small kernel plus pluggable modules**:

- `src/main/kernel/` — the **stable mechanism layer**, which knows nothing about business concepts: `runtime` (runtime primitives), `router` (the only `ipcMain` sink), `module` (`defineModule` / `ModuleRegistry`), `operations` (progress registry + cancellation tokens), `treeops` (the single entry point for whole-directory deletion), `services` (service slot), `extroute` (the mount point for extension endpoints).
- `src/main/modules/` — the **feature-policy layer**: one file per feature, each declaring its own IPC routes with `defineModule` (endpoints are no longer registered centrally).
- `src/main/app/`, `src/main/dsh/` — concrete implementations, called by the modules.

**Dependencies always flow** `modules → kernel` and `modules → app/dsh`; **modules never import each other** —
cross-module actions go through the service slot in `kernel/services.ts` (a provider registers a capability in
its `onReady`, a consumer looks it up by name), so static cycles like
`modules/settings → dsh/dsh → app/settings` cannot form. `app/ipc.ts` is just the **assembler**.

## The extension layer

Next to the main process there is an **extension system**:

- The **framework** lives in `src/main/extensions/` (the loader `loader/`, plus the `system/` and `builtin/`
  registries); `modules/extensions.ts` is the only bridge between the kernel and extensions
  (the `GET /extensions` management endpoints);
- The **business code of built-in / system extensions** lives one directory per extension under the top-level
  `src/extensions/<id>/` (`main.ts` main-process entry + `manifest.ts` + optional `*.vue` renderer views).
  Present today: `xeonsky.download` (multi-threaded download / resume / rate limiting), `xeonsky.extm`
  (the Extensions settings page, the package manager for archive-form external extensions, and the bundled
  7-Zip archive core), plus the five system-capability extensions `system.fs` / `system.net` /
  `system.proc` / `system.app` / `system.ui`;
- **Extensions can only reach the kernel through the API surface**: the main-process side uses `ExtContext`
  (`main/extensions/loader/ctx.ts`) only, the renderer side uses `src/extensions/renderer-api.ts` only —
  importing shell internals (`@/lib/*`, `@/components/*`, `@/shell/*`) is not allowed; extend the API surface
  first when a new capability is needed;
- Extension endpoints use the fixed `/ext/...` prefix (`kernel/extroute.ts`, registered into the same Router);
  extensions call each other via capability names like `ext:xeonsky.download`.

## Startup flow

Main-process entry `src/main/index.ts`:

1. **dev/release isolation**: in development, point `userData` at `"<app> (dev)"` so it does not fight the installed build over the single-instance lock;
2. **Register the config-directory migration**: `ensureDefaultConfigMigration()` (must run before any settings are read);
3. **Read startup settings**: whether to ignore OS scaling and whether hardware acceleration is enabled;
4. **Single-instance lock**: quit immediately if the lock is not acquired; a second launch brings the existing window to the front;
5. **After app ready**: `registerIpc()` + `runModuleReady()` (assemble modules, run their `onReady`) → create the window → create the tray → register global shortcuts;
6. `await waitForConfigMigration()`: when a config-directory migration is pending, finish it first (with progress broadcasts), then continue;
7. `await migrateLegacyInstalls()`: migrate the old flat install directories into the versioned layout;
8. Start the config file watcher; if DeepSeek Harness already exists, `restart()` to start dsh;
9. Check for app updates according to settings.

## Lifecycle and quitting

- **Closing the window**: hides to the tray by default (can be changed in settings to quit directly); closing the window does **not** stop dsh.
- **Really quitting**: `before-quit` first calls `preventDefault()`, gracefully stops dsh asynchronously (`stopDshGracefully()`) → cleans up the remaining child processes → `runModuleQuit()` (module `onQuit` in reverse order) → releases the second `app.quit()`.
- **Safety net**: `process.on('exit')` kills the server and child processes once more to avoid orphans.

## Window and tab model

- The core window hosts three fixed sites (dsh Web UI / web chat / usage & top-up); the core-window registration and takeover logic lives in `app/windowreg.ts` and the renderer's `shell/tabs.ts`.
- Secondary windows are created by "Open in new window"; tabs can be dragged in / out, and after the core window closes the earliest secondary window takes over.
- Embedded pages use `<webview>`; the address bar is shown only for dynamic tabs, and protocol / search routing lives in the renderer.

## Data and configuration

- **App settings**: `settings.json` under the config directory (not Electron's userData);
- **dsh's own preferences**: stored in dsh's **Cordis patch layers** (`cordis.patch.yml`) — a profile layer
  (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`, where Box writes theme / language for the `web` profile)
  and a home layer (`$DSH_HOME/cordis.patch.yml`, higher priority, for machine-level overrides); the old
  `~/.dsh/settings.yaml` is imported once by dsh and renamed — Box no longer reads or writes it;
- **DeepSeek Harness / Node / npm**: stored per version under the config directory, see [DeepSeek Harness & environment install pipeline](/en/dev/installs).

## Settings and state propagation

- The single source of truth for app settings is `settings.json` in the config directory; `loadSettings()` performs a **one-off migration** on read, gated by `settingsVersion` (currently **5**) — only genuinely old configs get keys renamed / defaults upgraded, so values the user typed later are never rewritten. **Keep the `legacy` check** when touching that normalization logic.
  - v4 moved `webviewUserAgent` into the built-in `xeonsky.browser` extension's data file (`data/extensions/xeonsky.browser/config.json`);
  - v5 moved `searchEngine` / `shortcuts` there too (new-tab navigation became a tab view contributed by that extension), and dropped `newTabMode` / `newTabUrl` outright. Both steps live in `migrateBrowserPrefs`, which writes **per key** only when the target file lacks it — idempotent, and failures only warn.
- Saving from the renderer goes through `PUT /settings`: after writing to disk the main process **broadcasts `settings:changed` to every window**; the config-file watcher covers **external edits** only and deliberately stays silent about the app's own writes.
- So **every component whose state derives from settings must subscribe to `settings:changed`** — missing that subscription shows up as “the change only takes effect after a restart”. The window that initiated the save ignores the echo itself (the settings store's `lastSaveAt`).
- `PUT /settings` also performs a few idempotent extras: sync the dsh theme, write the launch-at-login entry, refresh the embedded pages' UA / proxy, and apply the app icon.

## Network exits and proxy

- **All HTTP in the main process goes through `httpFetch(scope, url, init)`** (`src/main/dsh/http.ts`) — do not call `fetch` directly; `scope` decides whether that request uses the proxy (with no proxy enabled it falls back to global `fetch`).
- `proxyScope` has six **independent** slots: `app` (the main process itself: models / balance + embedded pages), `update` (app self-update), `dsh` (the dsh child process), `npm` (installs / downloads), `node` (Node download & deploy), `registry` (version lists / update checks).
- They land in three places: `app` → `models.ts` + `app/webview.ts`, `app/appupdate.ts`; `dsh` → the proxy env vars injected by `dsh.ts`; `npm` / `node` / `registry` → `npmRunner.ts`, `nodeenv.ts`, `manage.ts`. All three share `proxyConfigFor()`.
- Those branches are reached only when the proxy is enabled, so changes need verification on a real machine.

## Related documents

- [Main-process modules](/en/dev/modules)
- [Renderer](/en/dev/renderer)
- [IPC contract](/en/dev/ipc)
