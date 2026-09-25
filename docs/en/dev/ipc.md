# IPC contract

Communication between the main process and the renderer is modelled as a **REST service**: the renderer sends requests, the main process routes them by method + path, and the main process separately pushes one-way events. The contract (route table + event table) is the single source of truth and lives in `src/shared/api.ts`.

## Transport

| Direction | Channel | Envelope |
|---|---|---|
| renderer → main (request) | `ipc:request` (`ipcRenderer.invoke`) | `IpcRequest = { method, path, query?, body? }` |
| main → renderer (push) | `ipc:event` (`webContents.send`) | `IpcEvent = { event, payload }` |

- Only `src/main/kernel/router.ts` touches `ipcMain`, and only `src/preload/index.ts` touches `ipcRenderer`.
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

## Main-process routing: module declaration + kernel assembly

Endpoints are **no longer registered centrally**; they are spread across `src/main/modules/*.ts`, where each
feature module declares its own routes with `defineModule`. `src/main/app/ipc.ts` has shrunk into an
**assembler** — it builds a `Router` → `new ModuleRegistry(allModules())` → `mountRoutes`; handlers receive
`{ event, params, query, body }`:

```ts [src/main/modules/settings.ts]
export default defineModule({
    id: 'settings',
    routes: {
        GET: { '/settings': () => loadSettings() },
        PUT: {
            '/settings': async ({ body }) => {
                persistSettings(body)
                broadcast('settings:changed', body)
                return body
            }
        }
    }
})
```

- Routes are grouped by **method** (`GET` / `POST` / `PUT` / `PATCH` / `DELETE`), and paths must be
  `"<METHOD> <path>"` entries registered in `ApiRoutes` — a wrong path or result type is a **compile error**.
- `ModuleRegistry` (`src/main/kernel/module.ts`) **throws on duplicate routes** at assembly time, so two
  modules claiming the same path surface immediately.
- `Router` (`src/main/kernel/router.ts`) does the matching: **literal segments first, `:name` templates second**, so `/icons/current` is never stolen by `/icons/:id`; path parameters are decoded there.
- A handler may be sync or async; its return value is the response. A throw rejects the renderer's promise.
- Window-level operations (zoom / minimize / close / dialogs) resolve "the shell window that made this request" from `ctx.event.sender` — do **not** use the global main window.
- Modules must **not import each other**: to trigger another module's action, go through the service slot in
  `kernel/services.ts` (e.g. `modules/settings` calls `useService(SERVICE.RESTART_DSH)` to restart dsh).

## Events (main → renderer)

Event names are still `domain:action` (`settings:changed`, `configdir:migration`, `win:maximized`, …) but all travel over the single `ipc:event` channel, typed in `AppEvents`. The main process sends them through `broadcast` / `sendToWindow` / `sendToWcId` / `sendCore` in `kernel/runtime.ts` — **never call `webContents.send` directly**, or the envelope is bypassed and the renderer will not receive it.

## Adding an endpoint: two places

1. **`src/shared/api.ts`**: add a row to `ApiRoutes` (and, for pushes, an entry to `AppEvents`).
2. **Pick the module**: add the handler to the right method table in `src/main/modules/<feature>.ts` (the
   types force agreement with step 1); for a brand-new feature, create a module file and hook it into
   `allModules()` in `modules/index.ts`.

**The preload does not change** — it only forwards (`ipc:request` → router, `ipc:event` → `on`). The renderer just calls the new path; a wrong path is caught by the type checker.

## Owning module per group

| Module | Endpoints covered | Description |
|---|---|---|
| `settings.ts` | `GET` / `PUT /settings`, `POST /settings/apply`, `/settings/reset`, `GET` / `PUT /locale`, `/logs`, `/operations` | App settings, UI language, logs and the in-progress operations snapshot |
| `configdir.ts` | `GET` / `PUT /config-dir`, `POST /config-dir/revert`, `/config-dir/migration`, `DELETE /config-dir/migration`, `/models/*`, `/icons*` | Config-dir change / migration / cancel, models & balances, app icon |
| `dsh.ts` | `GET /dsh/*`, `POST /dsh/start`, `/stop`, `/restart`, `/update`, `/install`, `/reload`, `DELETE /dsh` | Install / update / uninstall / run state / version management / plugins |
| `env.ts` | `GET /env`, `/node/*`, `/npm/*`, `/pnpm/*`, `POST /node/deploy`, `PUT /versions/:kind/active` | Node / npm / pnpm deployment, status, versions |
| `appupdate.ts` | `GET /app/meta`, `/app/update/state`, `/slots`, `POST /app/update/check`, `/rollback`, `/restart`, `/app/relaunch`, `/app/quit` | Check / trigger / version slots / rollback / restart-quit |
| `shell.ts` | `GET /shell/meta`, `POST /shell/open-url`, `/focus-core`, `/move-tab`, `PUT /shell/title`, `/windows/*`, `/dialog/*` | Multi-window and tab transfer, window controls, dialogs |
| `tabdrag.ts` | `POST` / `PATCH` / `DELETE /tab-drag`, `POST /tab-drag/drop` | Driven by the source window; screen coordinates pick the drop target |

::: tip
The full list is governed by `ApiRoutes` in `src/shared/api.ts`; the module contract is
`src/main/kernel/module.ts` and the route engine is `src/main/kernel/router.ts`.
:::
