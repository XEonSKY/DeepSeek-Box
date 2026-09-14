# App self-update (A/B rollback)

App updates go through GitHub Releases and are implemented by `main/app/appupdate.ts` and `main/app/appslots.ts`; the core is "background download + keep one version + health guard".

## Release resolution

`appupdate.ts` resolves the target tag with the GitHub Releases API (whether pre-releases are included is controlled by the `appCheckPrerelease` setting), pins the generic source for that tag, and lets the updater download in the background. Downloads use the proxy configured for the "app updates" scope (electron-updater's dedicated `electron-updater` session, which does not touch the webviews).

## Version slots (A/B)

Before installing a new version, `appslots.ts` archives the current install directory as `<userData>/app-slots/<version>.tar.gz` (keeping only one) and registers the pending install.

## Startup health guard

After the new version first starts, a startup guard confirms it is healthy (the `HEALTHY_MS` window); consecutive startup failures **automatically roll back** to the archived old version. Users can also manually "Roll back to previous version" under "Settings → About".

## Install target

Decided per platform: on Windows / macOS the application directory, on Linux the single AppImage file.

## Events and IPC

- Events: `appupdate:*` (download progress, ready, errors);
- IPC: `appupdate:check` / `appupdate:trigger` / `appupdate:slots` / `appupdate:rollback`.

## Difference from DeepSeek Harness updates

| | Target | Channel |
|---|---|---|
| App self-update | The shell app | GitHub Releases |
| DeepSeek Harness update | `@deepseek-ai/dsh` | npm registry |

The two are independent; look at them separately when troubleshooting.
