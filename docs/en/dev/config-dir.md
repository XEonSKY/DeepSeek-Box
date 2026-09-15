# Config directory & migration

The app's own data (settings, DeepSeek Harness, Node, npm, default workspace) lives in the **config directory**, not Electron's userData. This page describes the default location, the override mechanism and the two-phase migration.

## Default locations

| Scenario | Directory |
|---|---|
| Release | `~/.dsbox/release` |
| Development (dev) | `~/.dsbox/dev` |

Users can pick their own override under "Settings → General → Config folder".

## Override pointer

The chosen directory is recorded in `<userData>/config-dir` (decoupled from the config directory so it can be read before `settings.json`, avoiding the chicken-and-egg problem of "the config directory being decided by the config"). The logic is in `main/app/settings.ts`:

- `defaultConfigDir()` / `legacyDefaultConfigDirs()` / `configDir()`
- `configDirInfo()` / `setConfigDir()` / `revertConfigDir()`

## Automatic migration on upgrade

`ensureDefaultConfigMigration()` is called very early during startup: if the user has never chosen a directory and an old default directory (`~/.config/dsh_shell[_dev]`, and `~/dsbox/{release,dev}` used by intermediate versions) has content, a migration plan is registered.

## Two-phase migration

**Phase one (when setting)**: `setConfigDir()` does not move anything immediately; it only writes a migration plan (`<userData>/config-migration.json`). While a plan exists, `configDir()` still returns the **old directory**, so settings stay readable before the restart.

**Phase two (restart bootstrap)**: after creating the window, `main/index.ts` calls `await waitForConfigMigration()` before starting DeepSeek Harness and the watchers; the migration is executed by `main/app/configmigrate.ts`:

- First `scanTree` counts the files;
- `migrateTree` moves item by item: on the same drive a whole directory is `rename`-d; across drives, or when the target exists, it recursively copies + unlinks and records a journal;
- Each processed item broadcasts `configdir:migration` progress (a full-screen progress dialog in the renderer, cancellable);
- Only on success does the current directory point at the new location; **on cancellation `rollbackMoves` moves everything back in reverse order** and pins the old directory.

::: info
If the move fails (e.g. a file is in use), the source files are not deleted, avoiding data loss; see `mergeInto` in `configmigrate.ts`.
:::

## Temp directories

- Download temp files: `<working-dir>/temp/download`
- npm cache: `<working-dir>/temp/npm`

## Related

- [DeepSeek Harness & environment install pipeline](/en/dev/installs)
- [App self-update](/en/dev/app-update)
