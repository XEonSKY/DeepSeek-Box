# FAQ

## Startup error: `the value for "version" in ~/.dsh/.credentials.yaml must be a string`

This is dsh failing to read its credentials configuration, not a problem with this app. It is usually because the **top-level** `version` in `.credentials.yaml` was written as a number.

Fix: edit `C:\Users\<you>\.dsh\.credentials.yaml` (or the corresponding home directory) and change the first line to a quoted string:

```yaml [~/.dsh/.credentials.yaml]
version: "1"
```

Save and restart. The inner `payload.version` does not need to be changed.

## It spins forever after launch and never reaches the interface

The app parses the address from the `dsh web: <url>` line printed by dsh. If there is no URL for a long time:

- Open “Settings → Terminal” to see whether the dsh output contains errors (or press `Ctrl` / `Cmd` + `T`);
- Check whether the chosen port is occupied (the app automatically scans upward for a free port);
- Confirm that DeepSeek Harness is installed and that the working directory exists and is readable / writable.

## “No locally deployed Node found” when starting

This means the current setting is **Locally deployed** Node, but no usable Node can be found in the configuration directory. To handle it:

- Open “Settings → Environment” and download a Node under “Locally deployed” (LTS recommended), or switch to “Electron bundled”;
- If you previously changed the configuration directory, confirm that `node/<version>/node.exe` really exists under the current directory.

## Downloads are very slow / installation gets stuck

- Switch the npm mirror to `npmmirror` under “Settings → General → Network”;
- Downloads support resume; retrying after an interruption continues from where it left off;
- The installation can be canceled at any time with “Cancel” and then retried.

## Pressing F12 does nothing in the console

**Developer Mode is hidden by default**, so unlock it first: open “Settings → About” and click the **app version number** 5 times (within 1.5 seconds); only then does the “Developer Mode” switch appear on that page. Turn it on and `F12` takes effect. It is off by default to avoid accidental opening.

## Why do upgrades / uninstalls “stop dsh first”

On Windows, a running dsh locks the DeepSeek Harness module files, causing replacement / deletion to fail. The app stops it before operating; if a process still holds it, the app detects this and prompts you to close the relevant process.

## Cannot connect / update check fails

- Check your network; if necessary switch the npm mirror to `npmmirror` and retry;
- App updates (GitHub) and DeepSeek Harness updates (npm) use different channels and can be troubleshot separately.

## Want to open multiple instances at once

It is **single-instance** by default: launching it again brings the existing window to the front instead of opening a new one.

::: tip Note the distinction between “multiple instances” and “multiple windows”
This app **supports multiple windows**—right-click a tab and choose “Open in New Window” to open a secondary window (see [Interface & Operations](/en/user/usage)). This is multiple windows within the same app.
:::

## Other

If the above does not solve it, please report the log from “Settings → Terminal” together with the version numbers (app version, DeepSeek Harness version) to [Issues](https://github.com/XEonSKY/DeepSeek-Box/issues).
