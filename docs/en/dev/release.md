# Build & release

## Version number

- The version number is governed by `package.json` and is also synced to two places in `package-lock.json` (top level and `packages[""]`) and to `metadata.version` in the skill `.agents/skills/deepseek-box/SKILL.md` — four places in total, the easiest thing to miss by hand;
- CI verifies that **the Git tag == the package.json version**;
- Whether a release is a pre-release is decided dynamically by whether the version contains `-` (e.g. `0.1.5-beta-1` is a pre-release).

## CI workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `.github/workflows/build-release.yml` | Push a version tag (`v*`) | Build installers for each platform and publish a GitHub Release |
| `.github/workflows/deploy-docs.yml` | Push to `main` when the change touches `docs/**` / `.vitepress/**` / dependencies | Build VitePress and deploy to GitHub Pages |

## Local packaging

```bash [Local packaging]
npm run build        # build into out/
npm run dist:win     # package Windows (also dist:mac / dist:linux)
```

## Release process

1. Update the version in `package.json` and `package-lock.json`;
2. Commit and push to `main` (confirm before pushing to the remote);
3. Tag (e.g. `v0.1.5-rc-1`) and push to trigger `Build & Release`;
4. If docs changes are pushed to `main`, a Pages deployment is triggered separately.

::: warning
Before pushing to the remote you must state the target (branch / tag, whether it is a force push) and get confirmation, see [Development conventions](/en/dev/conventions).
:::

## Docs site

- Content lives in `docs/`, organized by language (`zh/`, `en/`) and category (`user/`, `dev/`);
- The logic (nav / sidebar / languages) is in `.vitepress/config.mts`;
- After adding a page, update nav / sidebar, and keep the Chinese and English versions in pairs;
- Build: `npm run docs:build`, output to `.vitepress/dist` (ignored).

See [Docs site maintenance](#) or the workspace index for details.

## Related

- [Development conventions](/en/dev/conventions)
- [Setup & commands](/en/dev/setup)
