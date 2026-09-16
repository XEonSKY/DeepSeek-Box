# Setup & commands

## Requirements

| Item | Requirement |
|---|---|
| Node | ≥ 20 (the DeepSeek Harness runtime also requires ≥ 20) |
| Package manager | npm (the repository ships a `package-lock.json`) |
| Platform | Windows / macOS / Linux can all be used for development; the packaging scripts differ per platform |

## Common commands

Run these in the repo root:

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start development mode (electron-vite) |
| `npm run typecheck` | Type-check (both the node and web projects) |
| `npm run lint` | ESLint check (4-space style) |
| `npm run lint:fix` | Auto-fix |
| `npm run test` | Unit tests (Vitest, single run) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run check` | typecheck + lint + unit tests (must pass before committing) |
| `npm run build` | Build into `out/` |
| `npm run dist:win` | Package (also `dist:mac` / `dist:linux`) |
| `npm run docs:dev` | Preview the docs site locally |
| `npm run docs:build` | Build the docs site into `.vitepress/dist` |

::: info
Verification happens on two levels: **static checks** (`npm run check` = typecheck + lint + unit tests),
run by developers / CI, and **runtime behaviour** (window, tray, downloads, migrations, proxy,
self-update), which must be verified manually.
:::

Unit tests use **Vitest** (`vitest.config.mjs`) and run in the node environment; they cover
**pure logic only**:

- Tests live under **`tests/`**, split by the layer under test (`tests/{shared,main,renderer}/`),
  with the file named after the module (`src/main/dsh/semver.ts` → `tests/main/dsh/semver.test.ts`);
- Tests import through the `@shared` / `@main` / `@` aliases rather than cross-directory relative paths;
- No `*.test.ts` appears inside `src/` (enforced by `tests/shared/version-convention.test.ts`);
- The Electron runtime is not loaded, so modules with a top-level `import 'electron'` are skipped
  (e.g. only the normalizers of `app/settings.ts` are tested).

## Directory structure

```text [Project layout]
.
├─ src/
│  ├─ main/            main process (windows, DeepSeek Harness, config, updates)
│  │  ├─ app/           settings / configmigrate / models / ipc / ui / appupdate / appslots …
│  │  └─ dsh/           dsh / manage / nodeenv / npmRunner / downloader / installs …
│  ├─ preload/         window.api bridge and types
│  ├─ renderer/        Vue 3 UI
│  │  ├─ src/views/    pages and settings panels
│  │  ├─ src/components/
│  │  └─ src/lib/      utilities (theme, tabs, formatting, update prompts…)
│  └─ shared/          cross-process types / i18n / version utilities
├─ docs/               docs site content (zh / en, where this file lives)
├─ .vitepress/         docs site config
└─ package.json
```

## Runtime data locations

- **App settings & local installs**: the config directory, defaulting to `~/.dsbox/release` (release) / `~/.dsbox/dev` (dev), containing `settings.json`, `node/`, `npm/`, `dsh/`, `workspace/`.
- **Config-directory override pointer**: `<userData>/config-dir`; the migration plan is `<userData>/config-migration.json`.
- **Temporary downloads / npm cache**: `temp/download` and `temp/npm` under the working directory.

See [Config directory](/en/dev/config-dir) and [DeepSeek Harness & environment install pipeline](/en/dev/installs).

## Environment variables

| Variable | Purpose |
|---|---|
| `DSH_NODE` | Specifies the Node executable used to run dsh, overriding the "Node source" in settings |

## FAQ

- **Docs site local preview port**: defaults to `http://localhost:5173`.
- **You changed main-process code**: `npm run dev` restarts Electron automatically; renderer changes hot-reload.
- **You changed docs site config**: restart `npm run docs:dev` for it to take effect.
