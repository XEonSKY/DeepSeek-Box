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

## Downloading: extension capability with a kernel fallback

The download capability lives in the built-in extension **`xeonsky.download`** (`src/extensions/xeonsky.download/`): segmented concurrency, cross-session resume, token-bucket rate limiting, retries and size validation, with the task queue persisted as `tasks.json` in the extension data directory. The network stack stays in the kernel — the engine only issues requests through the injected `OpenStream` (the `stream` action of `system.net`), so **Settings → Network → Proxy** still applies.

Kernel callers (the Node distribution, bundled npm / pnpm) do not import the extension directly; they go through the **facade** `main/dsh/download.ts`, which looks up the capability slot `ext:xeonsky.download` by convention name and only falls back to the `downloadFile` of `main/dsh/downloader.ts` when it is missing (extension disabled / safe mode):

- Concurrent segmented downloads over HTTP Range (default 4, configurable in settings, max 16); it degrades to a single stream below 1 MB or when the server does not support Range;
- Retries and temp-file cleanup; temp files land in `temp/download` under the working directory and are moved to the target on completion (copying as a fallback across drives);
- **Deduplication for the same target file**: `inFlightDownloads` merges by the lower-cased final path; a later call subscribes to the same task, and progress is broadcast to all subscribers; `isFileDownloading()` is exposed;
- Supports cancellation via `signal`.

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
