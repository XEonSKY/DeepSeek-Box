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

| Convention | Location |
|---|---|
| Temporary / intermediate files (logs, reports, drafts) | `.dsh/temp/`, deleted once used |
| AI-assistance files (index, onboarding docs) | `.dsh/` at the workspace root |
| Do not scatter temp files | No temp artifacts elsewhere in the workspace root or in `docs/` |

`.dsh/` (including `.dsh/temp/`) is gitignored as a whole and is not under version control.

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

## No test suite

This repository has no automated tests; verification is based on `typecheck` / `lint` / `build`; for runtime behavior, verify manually or with a script and explain how.

## Known issues and TODOs

- `docs/public/home-page.png` is still an old-brand screenshot and is still referenced by the docs home page; it needs re-shooting;
- `Settings.funLocale` is a legacy field name; renaming it requires a persistence migration, so it stays for now;
- In `src/renderer/src/components/TitleBar.vue` the `.icon-btn` comment references an `AGENT.md` that does not exist in the repository; it should be cleaned up.
