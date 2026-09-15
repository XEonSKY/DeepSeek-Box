# Interface & Operations

The app is a frameless desktop shell: the upper part is a custom-drawn title bar (with a browser-style tab strip), and the lower part is the web content area. This page covers everyday operations.

## Title bar (from left to right)

| Area | Description |
|---|---|
| App icon + name | Shows DeepSeek Box |
| Pinned site icons | Shown only in the **core window**: DeepSeek UI / Web Chat / Usage & Top-up |
| Jump to core window | Shown only in **secondary windows**, to return to the window hosting DeepSeek UI |
| Tab strip | Dynamic tabs + `＋` to create (the three pinned sites are not here); drag the empty area to move the window, and use the wheel to scroll horizontally |
| Refresh | Shown only when the currently active tab is one of the three pinned sites |
| Settings | Opens the settings page (the terminal is also here: Settings → Terminal) |
| Minimize / Maximize / Close | Window controls |

::: tip
Settings is an **overlay**: the page underneath is not unloaded, and switching back still shows its original state.
:::

## Tabs

### Pinned site icons (core window only)

The three pinned sites are **icon buttons on the left of the title bar**; they always exist, **cannot be closed**, and are not in the tab strip:

1. **DeepSeek UI** — the embedded dsh main interface;
2. **Web Chat** — embedded [chat.deepseek.com](https://chat.deepseek.com/);
3. **Usage / Top-up** — embedded [platform.deepseek.com](https://platform.deepseek.com/).

### Dynamic tabs

- Origin: `target=_blank` / `window.open` from links inside pages, or clicking “＋” on the tab strip;
- No upper limit on the number;
- **Keep-alive policy**: the pages kept alive at the same time are “pinned sites + tabs you starred + the 3 most recent unstarred dynamic tabs”. Dynamic tabs beyond that range **remain on the tab strip**, but their pages are recycled and reloaded when you switch back;
- A tab actually loads its page only after it has been **opened** at least once.

### “＋” new tab

What opens is determined by “New Tab” in [Settings](/en/user/settings):

- **Built-in navigation page** (default) — search box, search engine switcher, common sites;
- **Custom URL** — opens the fixed URL you entered directly.

### Tab operations

| Operation | Effect |
|---|---|
| Single click | Switch to that tab |
| `Ctrl` / `Cmd` + click | Open the tab's URL in the **system default browser** |
| Middle click | Close the tab |
| Star (☆) | Pin for keep-alive: the page stays resident and **does not consume** one of the 3 most recent keep-alive slots |
| Drag tab | **Reorder** within the tab strip; drag onto another window's light-blue overlay to **move it into that window** |
| Right click | Copy / Close / Open in new window / Move to another window |

## Address bar

The address bar **is shown only when a dynamic tab is active** (pinned sites do not show it).

| Input | Behavior |
|---|---|
| `http(s):` / `about:` | Load inside the app |
| Other protocols (`mailto:`, `tel:`, custom protocols, etc.) | Hand off to the system default program |
| Content that is not a URL | Search using the configured **default search engine** |

To the left of the address bar there are also **Back / Forward / Refresh** (it becomes Stop while loading).

## Multiple windows

- Right-click a tab and choose “**Open in New Window**” to open a **full secondary window** (with its own tab strip);
- A secondary window does **not** have the three pinned sites; the title bar position shows “**Jump to Core Window**”;
- A secondary window's title is “current tab title - app name”;
- **After the core window is closed**, the earliest-opened secondary window automatically **takes over** as the new core window.

## Context menu

Right-clicking in an input box or on selected text shows **Cut / Copy / Paste / Select All**:

- All three items appear in an input box; when only text is selected (not editable), “Copy / Select All” is shown;
- When nothing is selected and the cursor is not in an input box, **no menu pops up** (the tab strip has its own separate context menu);
- Input boxes inside embedded pages are supported too.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl` / `Cmd` + `Alt` + `H` | **System-wide**: pressing it in any program brings you back to the main window |
| `Ctrl` / `Cmd` + `T` | Switch between the web view and “Settings · Terminal” |
| `F12` | Open / close DevTools (**only effective when “Developer Mode” is enabled**; that switch is hidden by default—click the app version number 5 times under “Settings → About” to unlock it) |

All three can be changed under [Settings → Shortcuts](/en/user/settings); “Clear” disables them.

## Tray

After closing to the tray:

- Single click: show / hide the window;
- Right-click menu: “Show / Hide Window”, “Quit (also terminates dsh)”.

::: info
Closing the window does not terminate dsh; on a real quit the app synchronously terminates the dsh process it manages, to avoid leaving anything behind. If no tray is available, closing the last window quits the app directly.
:::
