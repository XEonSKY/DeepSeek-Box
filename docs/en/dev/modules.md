# Main-process modules

The main process has two halves: `app/` handles the app itself (windows, config, models, updates, IPC), and `dsh/` handles DeepSeek Harness and the runtime environment.

## app/

| Module | Responsibility | Key exports / notes |
|---|---|---|
| `index.ts` | App entry | Single-instance lock, dev userData isolation, whenReady startup order, quit cleanup |
| `settings.ts` | Settings and config directory | `configDir()` / `loadSettings()` / `saveSettings()`; config-directory migration orchestration; `tempDownloadDir()` / `tempNpmDir()`; file watcher |
| `configmigrate.ts` | Config-directory migration implementation | Plan persistence, `scanTree` / `migrateTree`, `rollbackMoves` |
| `models.ts` | Models and balances | `readModelsInfo()` / `readCurrentBalance()`; reads dsh's `settings.yaml` / `.credentials.yaml`, merges providers by token, and queries model catalogues and balances over the network; **does not depend on electron, keys stay in the main process** |
| `ipc.ts` | All IPC endpoints | Registers REST routes with `Router`; windows / settings / dsh / environment / models / icons, etc. |
| `router.ts` | IPC route engine | Elysia-style chained routing: `:name` path parameters, `query` / `body`, dispatched on the single `ipc:request` channel |
| `ui.ts` | Windows / tray / shortcuts | `createShellWindow` / `createTray` / `syncGlobalHotkey` |
| `appupdate.ts` | App self-update | Resolves GitHub Releases, background download, event broadcasts |
| `appslots.ts` | A/B version slots | Archives the old version, generates the rollback script, startup health guard |
| `webview.ts` | Renderer parameters | Hardware acceleration, webview UserAgent |
| `windowreg.ts` | Window registry | Core / secondary window roles and takeover |
| `contextmenu.ts` | Context menu | Cut / copy / paste / select all |
| `runtime.ts` | Runtime state | Tray, quit flag, broadcasts |
| `const.ts` | Constants | — |

## dsh/

| Module | Responsibility | Key exports |
|---|---|---|
| `dsh.ts` | dsh start/stop / port / logs | `restart` / `stopDshGracefully` / `killAllChildren` / `isDshRunning`; watchdog child process |
| `watchdog.ts` | Watchdog code | `WATCHDOG_CODE` (detaches from this process to supervise dsh) |
| `manage.ts` | DeepSeek Harness install / update / uninstall | `resolveInstall` / `dshInstalled` / `performUpdateCheck` / `listVersions` / `installDsh` / `updateDsh` / `uninstallDsh` / `listInstalledDshVersions` / `useDshVersion` / `removeInstalledDshVersion` |
| `nodeenv.ts` | Node download & deployment | `deployLocalNode` / `listNodeVersions` / `nodeStatus` / version management |
| `npmRunner.ts` | npm detection / execution / cache | `ensureBundledNpmReady` / `runNpm` / `listNpmVersions` / `npmCacheEnv` |
| `downloader.ts` | Multi-threaded downloader | `downloadFile` (HTTP Range segmentation, deduplication, cancellation) |
| `cancel.ts` | Cancellation tokens | `beginCancelable` / `cancelActive` / `CANCELED_MESSAGE` |
| `installs.ts` | Versioned directories | `installRoot` / `versionDir` / `activeVersion` / `setActiveVersion` / `resolveActive` / `isVersionComplete` / `listInstalled` / `removeVersion` / `migrateLegacyInstalls`; `InstallKind` is `node` / `npm` / `dsh` |
| `tools.ts` | Path resolution | `localNodeExecPath` / `nodeRuntimeFor` / `resolveDshModule` / `findSystemNode` |
| `semver.ts` | Version utilities | `sortVersionsDesc` / `filterByPrerelease` / `compareVersions` / `pickLatest` |
| `net.ts` | Proxy | Proxy-related helpers |

::: tip
For per-module details see the corresponding developer docs: the install pipeline in [DeepSeek Harness & environment install pipeline](/en/dev/installs), the config directory in [Config directory](/en/dev/config-dir), and updates in [App self-update](/en/dev/app-update).
:::
