# DeepSeek Harness & environment install pipeline

This page describes the download and installation of DeepSeek Harness, Node and npm: the versioned directories, the downloader, cancellation, the extraction phase and the npm cache.

## Versioned install directories

Node, npm and DeepSeek Harness are all stored per version, with multiple versions coexisting:

```text [Config directory layout]
<config-dir>/
├─ node/<version>/        Node runtime (with bundled npm)
├─ npm/<version>/package/ App-managed bundled npm
└─ dsh/<version>/         Bundled DeepSeek Harness (node_modules/@deepseek-ai/dsh)
```

Each root directory's `.active` records the currently active version. The core API is in `main/dsh/installs.ts` (`InstallKind` is `node` / `npm` / `dsh`):

| Function | Purpose |
|---|---|
| `installRoot(kind)` / `versionDir(kind, v)` | Build paths |
| `resolveActive(kind)` | Get the active version; with no pointer, fall back to the latest **complete** version and write it back |
| `isVersionComplete(kind, v)` | Whether the key files are in place (node needs `node.exe`, npm needs `package/bin/npm-cli.js`, dsh needs dsh's `package.json`) |
| `activeVersion` / `setActiveVersion` | Read / write the `.active` pointer |
| `listInstalled` / `prepareVersionDir` / `removeVersion` | List / prepare / remove |
| `migrateLegacyInstalls` | Migrate the old flat directories into versioned directories |

::: warning Completeness matters
Files that were occupied during the move (typically a running `node.exe`) may not have been migrated. An incomplete directory is treated as nonexistent, and the read side falls back to the old flat layout; `moveFlatInto` also refuses to write `.active` when the key files are not in place.
:::

## Downloading: a kernel module

The download capability is a kernel module, **`src/main/download/`** (formerly the built-in extension `xeonsky.download`, now sunk into the kernel): `engine.ts` handles concurrent segmented downloads over HTTP Range (thread count is auto by default, adapting to the CPU core count), cross-session resume, token-bucket rate limiting, retries and size validation; `index.ts` is the task layer, with the queue persisted as `tasks.json` under `<configDir>/data/download/`. The network stack stays in the kernel — the engine calls `httpFetch` directly, so the proxy from **Settings → General → Network** still applies.

Two entry points:

- **The renderer** uses the IPC endpoints (`modules/download.ts`: `GET /download`, `POST /download/tasks`, `POST /download/tasks/:id/{start,pause,resume,cancel}`, `DELETE /download/tasks/:id`, `PUT /download/config`), consumed by the "Download" settings panel, with progress pushed via the `download:progress` event;
- **Kernel callers** (the Node distribution, bundled npm / pnpm) go through the **facade** `main/dsh/download.ts` whose `downloadFile` only performs **deduplication for the same target file**: `inFlightDownloads` merges by the lower-cased final path; a later call subscribes to the same task, and progress is broadcast to all subscribers; cancellation via `signal` is supported.

The authoritative record for resume state is the `.part.json` sidecar next to the `.part` file (total / etag / lastModified / per-segment offsets); any change re-downloads the whole file, avoiding a corrupt half-old-half-new result.

## Cancelling an install

`main/kernel/operations.ts` provides a single active token: `beginCancelable()` / `cancelActive()` / `CANCELED_MESSAGE` (the former `dsh/cancel.ts` was merged into the kernel).

Both download and extraction are bound to that token; the route `POST /installs/cancel` triggers it. After cancellation the temp files are cleaned up and `{ ok:false, canceled:true }` is returned; the renderer does not treat it as an error.

## Extraction phase

Unzipping Node's zip / tar and the bundled npm's tgz is a separate phase, and progress broadcasts carry `phase: 'download' | 'extract'`; during extraction the renderer switches to an indeterminate animation (no percentage).

## npm cache

`settings.tempNpmDir()` = `<working-dir>/temp/npm`; `npmRunner.npmCacheEnv()` injects `npm_config_cache` into every npm child process (system npm, bundled npm, the npm bundled with local Node, version detection), so nothing is written to `~/.npm`.

## Install flow overview

- **Node**: `nodeenv.deployLocalNode` downloads the matching platform package from nodejs.org → extracts → moves each item into `node/<version>/` → writes `.active`;
- **npm**: `npmRunner.ensureBundledNpmReady` downloads the tgz from the registry → extracts it into `npm/<version>/`;
- **DeepSeek Harness**: `manage.installDsh` uses the selected npm with `--prefix` to install into `dsh/<version>/`, then writes `.active`;
- All three support "install a specific version, switch at runtime, remove".

## Related

- [Config directory](/en/dev/config-dir)
- [IPC contract](/en/dev/ipc)
