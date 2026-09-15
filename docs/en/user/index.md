# User guide

DeepSeek Box puts **DeepSeek Harness** (npm package `@deepseek-ai/dsh`, command `dsh`) into a desktop window: double-click to launch, no command line, no manual environment setup. This section is for **everyday users**.

::: tip
To modify the code or learn about the internals, see the [Developer guide](/en/dev/).
:::

## Browse by task

<div class="card-grid">
  <a class="card" href="/en/user/download">
    <h3>⬇️ Download & requirements</h3>
    <p>Pick your platform and architecture, then install.</p>
  </a>
  <a class="card" href="/en/user/quickstart">
    <h3>🚀 Quick start</h3>
    <p>First launch: the four-step wizard and a tour of the UI.</p>
  </a>
  <a class="card" href="/en/user/usage">
    <h3>🖥 Interface & usage</h3>
    <p>Tabs, address bar, multiple windows, context menu, shortcuts and tray.</p>
  </a>
  <a class="card" href="/en/user/settings">
    <h3>⚙️ Settings</h3>
    <p>General, appearance, network, environment, DeepSeek Harness, models, terminal and about.</p>
  </a>
  <a class="card" href="/en/user/environment">
    <h3>🧰 Environment (Node / npm)</h3>
    <p>Three sources, versioned installs and switching, downloader and cache.</p>
  </a>
  <a class="card" href="/en/user/dsh">
    <h3>🔄 DeepSeek Harness management</h3>
    <p>Install, update, switch / roll back versions and uninstall.</p>
  </a>
  <a class="card" href="/en/user/models">
    <h3>🧠 Models & balances</h3>
    <p>Model list, providers and balance queries; keys never leave the main process.</p>
  </a>
  <a class="card" href="/en/user/update">
    <h3>📦 App updates & rollback</h3>
    <p>Background updates, keeping one previous version and one-click rollback.</p>
  </a>
  <a class="card" href="/en/user/faq">
    <h3>❓ FAQ</h3>
    <p>Troubleshooting launch, install, download and update issues.</p>
  </a>
</div>

## Suggested reading order

1. [Download & requirements](/en/user/download) — choose the right installer and confirm system support;
2. [Quick start](/en/user/quickstart) — first launch; follow the wizard through its four steps;
3. [Interface & usage](/en/user/usage) — tabs, multiple windows, shortcuts;
4. [Settings](/en/user/settings) — what each setting actually controls.

## Its relationship to DeepSeek Harness

This app does **not replace** DeepSeek Harness; it is its **desktop entry point + environment manager**: it starts and supervises the dsh process, embeds the interface in a native window, and can optionally manage Node, npm, and DeepSeek Harness versions on your behalf. Conversations, workspaces, sessions, and other data still belong to DeepSeek Harness itself.
