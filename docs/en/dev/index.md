# Developer guide

For developers who want to understand the internals, fix bugs, or contribute code. The app is an Electron + Vue 3 + TypeScript desktop shell that runs **DeepSeek Harness** (npm package `@deepseek-ai/dsh`, command `dsh`).

::: tip
Just want to use the app? See the [User guide](/en/user/).
:::

## Dive in by topic

<div class="card-grid">
  <a class="card" href="/en/dev/setup">
    <h3>🧑🔧 Setup & commands</h3>
    <p>Get it running, common scripts, project layout and data locations.</p>
  </a>
  <a class="card" href="/en/dev/architecture">
    <h3>🏗 Architecture</h3>
    <p>Three-process model, startup sequence, lifecycle and window / tab model.</p>
  </a>
  <a class="card" href="/en/dev/modules">
    <h3>📦 Main-process modules</h3>
    <p>What each module under app/ and dsh/ is responsible for.</p>
  </a>
  <a class="card" href="/en/dev/renderer">
    <h3>🎨 Renderer</h3>
    <p>Vue structure, views and components, state, theme and i18n.</p>
  </a>
  <a class="card" href="/en/dev/ipc">
    <h3>🔌 IPC contract</h3>
    <p>REST routes and events, main groups and the two-place sync for a new endpoint.</p>
  </a>
  <a class="card" href="/en/dev/installs">
    <h3>⬇️ Install pipeline</h3>
    <p>Versioned layout, multi-threaded downloader, cancellation, extraction and npm cache.</p>
  </a>
  <a class="card" href="/en/dev/config-dir">
    <h3>📁 Config directory</h3>
    <p>Defaults, override pointer and the two-phase migration.</p>
  </a>
  <a class="card" href="/en/dev/app-update">
    <h3>🔄 App self-update</h3>
    <p>A/B version slots, health guard and rollback.</p>
  </a>
  <a class="card" href="/en/dev/release">
    <h3>🚢 Build & release</h3>
    <p>Version sync, CI workflows, packaging and docs deployment.</p>
  </a>
  <a class="card" href="/en/dev/conventions">
    <h3>📐 Conventions</h3>
    <p>Code style, comments, temp files and Git rules.</p>
  </a>
</div>

## Suggested reading order

1. [Setup & commands](/en/dev/setup) — get it running, common scripts, project layout;
2. [Architecture](/en/dev/architecture) — the three-process model, startup sequence, lifecycle;
3. [Main-process modules](/en/dev/modules) — what each module does;
4. [Renderer](/en/dev/renderer) — Vue structure, state, theme and i18n;
5. [IPC contract](/en/dev/ipc) — the main ↔ renderer REST contract and how to add an endpoint.

## Repository at a glance

- The repo root (also the workspace root) holds both the app and the docs site; the version lives in `package.json`.
- Main process `src/main/`, preload `src/preload/`, renderer `src/renderer/`, shared code and types `src/shared/`.
- Docs content `docs/`, site logic `.vitepress/config.mts`.

::: info
The AI development guide lives in `.agents/skills/deepseek-box/SKILL.md`.
:::
