# IPC contract

Communication between the main process and the renderer is modelled as a **REST service**: the renderer sends requests, the main process routes them by method + path, and the main process separately pushes one-way events. The contract (route table + event table) is the single source of truth and lives in `src/shared/api.ts`.

## Transport

| Direction | Channel | Envelope |
|---|---|---|
| renderer → main (request) | `ipc:request` (`ipcRenderer.invoke`) | `IpcRequest = { method, path, query?, body? }` |
| main → renderer (push) | `ipc:event` (`webContents.send`) | `IpcEvent = { event, payload }` |

- Only `src/main/app/router.ts` touches `ipcMain`, and only `src/preload/index.ts` touches `ipcRenderer`.
- The method is always one of five HTTP verbs: `GET` (read), `POST` (create / action), `PUT` (full update), `PATCH` (partial update), `DELETE` (remove).
- A request envelope is isomorphic to an HTTP request; `:name` in a path denotes a path parameter.

## Single source of truth: `ApiRoutes`

`ApiRoutes` in `src/shared/api.ts` declares every endpoint: the key is `"<METHOD> <path>"` and the value is `{ query?, body?, result }`.

```ts [src/shared/api.ts]
export interface ApiRoutes {
    'GET /settings': { result: Settings }
    'PUT /settings': { body: Settings; result: Settings }
    'GET /versions/:kind': { result: InstalledVersions }
    'POST /versions/:kind/active': { body: { version: string }; result: ToolActionResult }
    'DELETE /versions/:kind/:version': { result: ToolActionResult }
    // …
}
```

Both the main-process handlers and the renderer calls **derive their types from it**, so any mismatch in path / verb / body / result is a compile error.

## Renderer client

The preload turns `ApiRoutes` into a REST client on `window.api`:

```ts [renderer calls]
window.api.get('/settings')
window.api.put('/settings', { body: settings })
window.api.get('/versions/:kind', { params: { kind: 'node' } })
window.api.post('/node/deploy', { body: { version } })
window.api.delete('/icons/:id', { params: { id: 'user/a.png' } })
```

- The five verbs map to same-named methods: `get` / `post` / `put` / `patch` / `delete`.
- The second argument is an optional object `{ params?, query?, body? }`: path parameters are required where a route declares them, `query` / `body` follow the route declaration.
- Path-parameter values are `encodeURIComponent`-ed into the path (`user/a.png` → `user%2Fa.png`) and decoded on the main-process side.
- Event subscription is always `window.api.on(event, cb)` (returns an unsubscribe function); event names and payload types live in `AppEvents` in the same file.
- `window.api` also carries the local constants `platform` / `versions`, which do not go over IPC.

## Main-process router (Elysia style)

`registerIpc()` in `src/main/app/ipc.ts` registers every endpoint as a chain; handlers receive `{ event, params, query, body }`:

```ts [src/main/app/ipc.ts]
router
    .get('/settings', () => ({ ...DEFAULT_SETTINGS, ...readDiskSettings() }))
    .put('/settings', async ({ body }) => { /* persist + broadcast settings:changed */ })
    .delete('/versions/:kind/:version', ({ params }) => removeVersion(params.kind, params.version))
```

- `Router` (`src/main/app/router.ts`) does the matching: **literal segments first, `:name` templates second**, so `/icons/current` is never stolen by `/icons/:id`; path parameters are decoded there.
- A handler may be sync or async; its return value is the response. A throw rejects the renderer's promise.
- Window-level operations (zoom / minimize / close / dialogs) resolve "the shell window that made this request" from `ctx.event.sender` — do **not** use the global main window.

## Events (main → renderer)

Event names are still `domain:action` (`settings:changed`, `configdir:migration`, `win:maximized`, …) but all travel over the single `ipc:event` channel, typed in `AppEvents`. The main process sends them through `broadcast` / `sendToWindow` / `sendToWcId` / `sendCore` in `runtime.ts` — **never call `webContents.send` directly**, or the envelope is bypassed and the renderer will not receive it.

## Adding an endpoint: two places

1. **`src/shared/api.ts`**: add a row to `ApiRoutes` (and, for pushes, an entry to `AppEvents`).
2. **`src/main/app/ipc.ts`**: implement the handler in the `registerIpc()` chain (the types force agreement with step 1).

**The preload does not change** — it only forwards (`ipc:request` → router, `ipc:event` → `on`). The renderer just calls the new path; a wrong path is caught by the type checker.

## Endpoint groups

| Group | Examples | Description |
|---|---|---|
| Settings / language | `GET` / `PUT /settings`, `POST /settings/apply`, `/settings/reset`, `GET` / `PUT /locale` | Read and write app settings and UI language |
| Config directory | `GET` / `PUT /config-dir`, `POST /config-dir/revert`, `/config-dir/migration`, `DELETE /config-dir/migration` | Query / change / migrate / cancel |
| DeepSeek Harness | `GET /dsh/*`, `POST /dsh/start`, `/stop`, `/restart`, `/update`, `/install`, `DELETE /dsh`, `/versions/:kind` | Install / update / uninstall / run state / version management |
| Environment | `GET /env`, `/node/*`, `/npm/*`, `POST /node/deploy` | Node / npm deployment, status, versions |
| Models & balances | `GET /models/info`, `GET /models/balance` | Keys never leave the main process |
| App update | `GET /app/meta`, `/app/update/state`, `/slots`, `POST /app/update/check`, `/rollback`, `/restart` | Check / trigger / version slots / rollback |
| App icon | `GET /icons`, `/icons/current`, `POST /icons`, `DELETE /icons/:id` | Preset / upload / delete |
| Shell windows | `GET /shell/meta`, `POST /shell/open-url`, `/focus-core`, `/move-tab`, `PUT /shell/title` | Multi-window and tab transfer |
| Window controls | `PUT /windows/zoom`, `GET /windows/maximized`, `POST /windows/minimize`, `/maximize-toggle`, `/close` | Frameless title-bar buttons |
| Tab drag | `POST /tab-drag`, `PATCH /tab-drag`, `DELETE /tab-drag`, `POST /tab-drag/drop` | Driven by the source window; screen coordinates pick the drop target |

::: tip
The full list is governed by `ApiRoutes` in `src/shared/api.ts`; the route engine is `src/main/app/router.ts`.
:::
