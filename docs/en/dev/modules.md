# Main-process modules

The main process is layered as a **microkernel**: `kernel/` is the stable mechanism layer (it knows nothing
about business concepts), `modules/` is the feature-policy layer (one file per feature, each declaring its own
IPC routes), and `app/` plus `dsh/` are the concrete implementations. Dependencies always flow
`modules → kernel` and `modules → app/dsh`; **modules never import each other** — cross-module actions go
through the service slot in `kernel/services.ts`.

## kernel/ (mechanism)

| Module | Responsibility | Key exports |
|---|---|---|
| `runtime.ts` | Runtime primitives (the only dependency-free base) | Tray / quit flag / `broadcast` / `sendToWindow` / `sendToWcId` / `sendCore` |
| `router.ts` | IPC route engine (**the only `ipcMain` sink**) | `Router`: Elysia-style chained routing, `:name` path params, literal-before-template matching |
| `module.ts` | Module contract and assembly | `defineModule` / `MainModule` / `ModuleRegistry` (`mountRoutes` / `runReady` / `runQuit`); duplicate routes throw at assembly time |
| `operations.ts` | "Operations in progress" registry + cancellation tokens (**pure logic**) | `beginOperation` / `pushProgress` / `operationsSnapshot` / `trackedOperation` / `beginCancelable` / `cancelActive` |
| `treeops.ts` | The single entry point for whole-directory deletion | Re-exports `dsh/fsutil`'s `removeTree` / `removeQuietly` / `removeQuietlySync` / `readPkgVersion` |
| `services.ts` | Service slot (breaks static cycles between modules) | `provideService` / `useService` / `hasService` / `SERVICE` |

## modules/ (feature policy)

Each module declares itself with `defineModule({ id, routes, onReady?, onQuit? })`; routes are grouped by
method (`GET` / `POST` / `PUT` / `PATCH` / `DELETE`) and paths must be `"<METHOD> <path>"` entries registered
in `ApiRoutes` (`src/shared/api.ts`) — a wrong path is a **compile-time error**.

| Module | Endpoints covered |
|---|---|
| `settings.ts` | `/settings*`, `/locale`, `/logs`, `/operations` |
| `dsh.ts` | `/dsh*` (start/stop / update / install / plugins) |
| `env.ts` | `/env`, `/node/*`, `/npm/*`, `/pnpm/*`, `/versions/*`, `/registries/speed`, `/installs/cancel` |
| `shell.ts` | `/shell/*`, `/windows/*`, `/dialog/*`, `/hotkeys/state`, `/webview/info` |
| `tabdrag.ts` | `/tab-drag*` (cross-window tab dragging) |
| `appupdate.ts` | `/app/meta`, `/app/update/*`, `/app/relaunch`, `/app/quit` |
| `configdir.ts` | `/config-dir*`, `/models/*`, `/icons*` |

`index.ts` aggregates `allModules()`; `app/ipc.ts` is the assembler (builds a `Router` +
`new ModuleRegistry(allModules())` + `mountRoutes`).

## app/ (app-specific implementations)

| Module | Responsibility | Key exports / notes |
|---|---|---|
| `index.ts` | App entry | Single-instance lock, dev userData isolation, whenReady startup order, quit cleanup |
| `settings.ts` | Settings and config directory | `configDir()` / `loadSettings()` / `saveSettings()`; config-directory migration orchestration; `tempDownloadDir()` / `tempNpmDir()`; file watcher |
| `configmigrate.ts` | Config-directory migration implementation | Plan persistence, `scanTree` / `migrateTree`, `rollbackMoves` (**all async**, yields the event loop per directory) |
| `models.ts` | Models and balances | `readModelsInfo()` / `readCurrentBalance()`; reads dsh's cordis patch layers / `.credentials.yaml`, merges providers by token, and queries model catalogues and balances over the network; **does not depend on electron, keys stay in the main process** |
| `ipc.ts` | **Assembler** | Builds `Router` + `ModuleRegistry(allModules())`; exports `registerIpc` / `runModuleReady` / `runModuleQuit`. **No longer registers endpoints** |
| `ui.ts` | Windows / tray / shortcuts | `createShellWindow` / `createTray` / `syncGlobalHotkey` |
| `appupdate.ts` | App self-update | Resolves GitHub Releases, background download, event broadcasts; the boot guard is async |
| `appslots.ts` | A/B version slots | Archives the old version, generates the rollback script, startup health guard (file ops fully async) |
| `webview.ts` | Renderer parameters & embed policy | Hardware acceleration, webview UserAgent, proxy, `installWebviewPermissionPolicy()` |
| `windowreg.ts` | Window registry | Core / secondary window roles and takeover |
| `contextmenu.ts` | Context menu | Cut / copy / paste / select all |
| `appicon.ts` | App icon | `appLogoPath`, reading/writing the icon |

## dsh/

| Module | Responsibility | Key exports |
|---|---|---|
| `dsh.ts` | dsh start/stop / port / logs | `restart` / `stopDshGracefully` / `killAllChildren` / `isDshRunning`; watchdog child process |
| `watchdog.ts` | Watchdog code | `WATCHDOG_CODE` (detaches from this process to supervise dsh) |
| `manage.ts` | DeepSeek Harness install / update / uninstall | `resolveInstall` / `dshInstalled` / `performUpdateCheck` / `listVersions` / `installDsh` / `updateDsh` / `uninstallDsh` / `listInstalledDshVersions` / `useDshVersion` / `removeInstalledDshVersion` |
| `nodeenv.ts` | Node download & deployment | `deployLocalNode` / `listNodeVersions` / `nodeStatus` / version management |
| `npmRunner.ts` | npm detection / execution / cache | `ensureBundledNpmReady` / `runNpm` / `listNpmVersions` / `npmCacheEnv` |
| `pnpmRunner.ts` | pnpm acquisition / execution (two sources: system / bundled) | `pnpmStatus` / `updatePnpm` / `systemPnpmPath` / `pnpmShimEnv`; entry resolution in `pnpmEntry.ts` |
| `downloader.ts` | Multi-threaded downloader | `downloadFile` (HTTP Range segmentation, deduplication, cancellation) |
| `installs.ts` | Versioned directories | `installRoot` / `versionDir` / `activeVersion` / `setActiveVersion` / `resolveActive` / `isVersionComplete` / `listInstalled` / `removeVersion` / `migrateLegacyInstalls`; `InstallKind` is `node` / `npm` / `pnpm` / `dsh` |
| `tools.ts` | Path resolution | `localNodeExecPath` / `nodeRuntimeFor` / `resolveDshModule` / `findSystemNode` |
| `semver.ts` | Version utilities | `sortVersionsDesc` / `filterByPrerelease` / `compareVersions` / `pickLatest` |
| `net.ts` | Proxy | Proxy-related helpers |

::: tip
For per-module details see the corresponding developer docs: the install pipeline in [DeepSeek Harness & environment install pipeline](/en/dev/installs), the config directory in [Config directory](/en/dev/config-dir), and updates in [App self-update](/en/dev/app-update).
:::
