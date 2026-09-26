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

- All agent-generated caches / temporary / intermediate files (logs, reports, drafts, script output) go to `.agents/temp/`; they may be kept across tasks (saving repeated downloads / clones) and cleaned up when needed;
- Never scatter them across the workspace root, `docs/`, or anywhere else;
- `.gitignore` only excludes `.agents/temp/`; **`.agents/skills/**` is under version control** (team-shared agent skills).

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
- `zh/hant.ts` — like `zh/{anime,wenyan}.ts` and `en/{pirate,shakespeare}.ts` — is a **diff-only overlay** deep-merged onto the base catalog by `shared/locales/ext.ts`;
- When adding a key, only **zh / en** need updating (hant needs nothing; uncovered keys fall back to the Simplified base); when **deleting** a key, remove it from **zh / en / hant together** — hant must stay a subset of zh, deleting only from zh leaves orphan keys;
- Strings are **part of the program** (`src/shared/locales/**` does not count as documentation) and may change together with the feature.

## Logging

All logging goes through **pino**; do not add bare `console.*` calls:

- **Main process**: `import { logger } from '../kernel/logger'`, `const log = logger('[Manager]')`, used as
  `log.error({ err }, 'message')` (structured fields first, message second);
- **Renderer**: `import { logger } from './lib/logger'`, same usage. The renderer uses pino's **browser
  build**, so output lands in devtools; **warn and above is reported to the main process** and written to
  the same log file;
- **On disk**: `<config dir>/logs/dsbox.log`, rotated by `pino-roll` at 5 MB with up to 5 historical files.
  Development console output is single-line color via `pino-pretty`; release output is JSON;
- **Messages are in English** (diagnostic text aimed at developers); the module tags
  `[Manager]` / `[Core]` / `[ext]` / `[shell]` land in the `tag` field via `logger(tag)`;
- Two places **intentionally keep `console.*`**: `dsh/watchdog.ts` (a standalone detached script) and the
  default fallback sink in `extensions/loader/registry.ts` (the loader injects a real sink at startup).

## Verification

This repository ships **no unit tests** (`tests/`, `scripts/`, `vitest.config.mjs` and the `vitest` dependency have all been removed, and `package.json` has no `test` script).

The only static gate is **typecheck + lint**:

```bash
npm run check        # = npm run typecheck && npm run lint
```

- CI (`.github/workflows/quality.yml`) runs the same set on `dev` and on PRs;
- This repository **enables no Git hooks**, so run it yourself before committing;
- Pure logic (shared utilities; version / path / normalization / migration decisions in main) has **no automated safety net** — verify it by hand after changing it. To check side-effecting behaviour, write a one-off probe script under `.agents/temp/` (see the verification recipe in [Main-process modules](/en/dev/modules)).

Runtime behaviour (window, tray, downloads, migrations, proxy, self-update, UI) is still verified manually.

## Known issues and TODOs

- `docs/public/home-page.png` is still an old-brand screenshot and is still referenced by the docs home page; it needs re-shooting;
- `Settings.funLocale` is a legacy field name; renaming it requires a persistence migration, so it stays for now.
