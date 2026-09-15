# Renderer

The renderer is a Vue 3 application responsible for the tab shell, settings page, install wizard, status bar and terminal. Its source lives in `src/renderer/src/`.

## Directory

| Path | Description |
|---|---|
| `App.vue` | Root component: title bar, webview container, settings overlay, status bar, global toasts and the migration progress dialog |
| `views/` | Pages: `WebHost.vue` (dsh Web UI / web), `NewTab.vue` (built-in navigation page), `LogView.vue` (terminal) |
| `views/settings/` | Settings panels: General / Appearance / Network / Env / Dsh / Models / Log / Hotkeys / Webview / About |
| `views/settings/ModelsPanel.vue` | The “Models” page: consent flow + the model / provider / balance columns and “Refresh all” |
| `views/settings/actions/` | Settings actions: `dshActions.ts` (start-stop / install wizard), `dshManageActions.ts` (DeepSeek Harness version management) |
| `components/` | `DshWizard.vue` (four-step install wizard), `StatusBar.vue` (bottom status bar: balance and version badge), `TitleBar.vue`, etc. |
| `lib/` | Theme, formatting, update state, locale and similar utilities (tab logic lives in `shell/`) |
| `lib/update.ts` | The version-update state hub: `versionStatus` / `checkDsh` / `checkAllUpdates` / `applyAppUpdateEvent` / `hasUpdate` |
| `views/settings/useSettingsStore.ts` / `views/settings/settingsStore.ts` | Pinia state and settings mirror |

## State management

- The Pinia store holds a mirror of the settings, and `useSettingsStore.ts` reads from and writes back to the main process;
- Changes in the settings panels are saved through the main process (some settings need “Apply now” to restart dsh before they take effect).

## Tabs and windows

The creation, keep-alive and drag-migration logic for tabs lives in `shell/tabs.ts` and elsewhere; the roles of the core window and secondary windows are decided jointly by the main process `windowreg.ts` and the renderer.

## Status bar

The bottom status bar is rendered by `components/StatusBar.vue`, right-aligning a group of read-only items:

- **Current provider balance**: once authorized it reads from `GET /models/balance` the balance of the provider behind the current default model, refreshing automatically every 5 minutes while in the foreground and manually on click; before authorization it shows “Click to authorize” and jumps to “Settings → Models”;
- **App version · dsh version**: the actual versions come from `GET /app/meta` and `GET /dsh/version`; clicking opens a popover that calls `checkAllUpdates()`, and the result appears as a small red dot on the version item (a silent notice, no toast). The source of truth is `versionStatus` in `lib/update.ts`.

## Theme and language

- Theme: follow system / light / dark; the color scheme decides the accent color and the base background; in dark mode the app icon switches to its dark variant;
- i18n: `vue-i18n`, with locale files in `src/shared/locales/` (zh / en plus extended translations); extended translations are text overlays;
- Theme and language are synced to dsh's own configuration.

## Communicating with the main process

All main-process capabilities are called through `window.api` (a REST client exposed by the preload); the contract is `ApiRoutes` in `src/shared/api.ts`: `window.api.get('/settings')`, `window.api.on('settings:changed', …)`. New endpoints are kept in sync in two places, see [IPC contract](/en/dev/ipc).
