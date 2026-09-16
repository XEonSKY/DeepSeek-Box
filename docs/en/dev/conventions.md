# Development conventions

Before changing code or documentation, please follow these conventions.

## Code style

- **4-space indentation** (ESLint `@stylistic/indent` + `vue/html-indent`);
- Run `npm run lint` before committing (0 errors; existing warnings can be ignored);
- TypeScript strict mode; type-check with `npm run typecheck`.

## Comments

- Comment language: **concise Chinese**;
- Functions / methods / exported APIs: use **short Chinese JSDoc** (`/** ... */`), one sentence saying what it does, adding `@param` / `@returns` only when necessary;
- Inline comments **keep it brief**: only where something is non-obvious or a known pitfall, never line-by-line explanations.

## Files and directories

- All agent-generated caches / temporary / intermediate files (logs, reports, drafts, script output) go to `.agents/temp/` and are deleted once used;
- Never scatter them across the workspace root, `docs/`, or anywhere else;
- `.agents/` (including `.agents/temp/`) is gitignored and not under version control.

## Git and remotes

- Local operations (`add` / `commit` / `branch` / `merge` / `checkout`) can be performed directly;
- **Pushing to the remote always requires confirmation**: any `git push` (regular, `--force`, `--tags`, deleting a remote branch / tag, moving a tag) must first state the target and get approval; never push automatically;
- Destructive remote operations (force-push, deleting a remote branch / tag) especially require confirmation first.

## Documentation

- In-site links carry a language prefix (`/zh/...` or `/en/...`) and a category (`/user/` or `/dev/`);
- Chinese and English pages exist **in pairs**;
- Describe files in the workspace with relative paths.

## i18n strings

- The single source of truth for UI strings is `src/shared/locales/{zh,en}/index.ts`; the two are **key-for-key aligned** (same names, order and `{placeholders}`);
- `zh/hant.ts` is a **full Traditional Chinese override**; `zh/{anime,wenyan}.ts` and `en/{pirate,shakespeare}.ts` are **diff-only overlays** deep-merged onto the base catalog by `shared/locales/ext.ts`;
- When adding a key, add it to **zh / en / hant together**, otherwise Traditional Chinese users see Simplified text or the raw key;
- Strings are **part of the program** (`src/shared/locales/**` does not count as documentation) and may change together with the feature.

## Tests

Unit tests use **Vitest** (`vitest.config.mjs`, **`.mjs` rather than `.ts`**: the config contains nothing that needs type checking, and plain JS avoids an extra esbuild transpile when loading it), running in the node environment.

**Tests are independent of the source tree and all live under `tests/`**, mirroring the layers of the code under test:

| Test directory | Source | Alias |
|---|---|---|
| `tests/shared/` | `src/shared/` | `@shared/*` |
| `tests/main/` | `src/main/` | `@main/*` |
| `tests/renderer/` | `src/renderer/src/` | `@/*` |

- The file is named after the module, and the structure inside `tests/` mirrors the source, so **moving a test never means rewriting relative paths**;
- Tests always import through aliases; `@main` is configured **only for tests and `tsconfig.node.json`** — main-process source keeps using relative paths;
- **No `*.test.ts` may appear inside `src/`** — enforced by `tests/shared/version-convention.test.ts`;
- What is testable is **pure logic** (shared utilities; version / path / normalization / migration decisions in main; pure functions in the renderer). A module-level `import { app } from 'electron'` drags the whole chain into loading Electron, so do not test such modules wholesale — import the pure functions from them by name instead;
- Commands: `npm run test` / `test:watch` / `test:coverage` (output to `.agents/temp/coverage`);
- **New pure logic must come with tests**; when fixing a bug, add a case that reproduces it first.

Runtime behaviour (window, tray, downloads, migrations, proxy, self-update) is still verified manually.

## Known issues and TODOs

- `docs/public/home-page.png` is still an old-brand screenshot and is still referenced by the docs home page; it needs re-shooting;
- `Settings.funLocale` is a legacy field name; renaming it requires a persistence migration, so it stays for now;
- In `src/renderer/src/components/TitleBar.vue` the `.icon-btn` comment references an `AGENT.md` that does not exist in the repository; it should be cleaned up.
