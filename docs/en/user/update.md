# App Update & Rollback

This app supports **background auto-update** and keeps one previous version for **one-click rollback**. The related interface is under “Settings → About”.

## How auto-update works

1. **Check**: once enabled, it silently checks for a new version at startup (whether pre-releases are included is controlled by “Check for test builds”);
2. **Background download**: when a new version exists, it downloads in the background without interrupting your work; progress can be seen on the About page;
3. **Silent notice**: when the download finishes no notification pops up, only a small red dot appears on the status-bar version item. Clicking it lets you “Restart and install”, or it installs automatically when you quit later;
4. **Keep the old version**: before installing, the current version is **compressed and archived** (only the most recent one is kept) as the rollback source;
5. **Health guard**: if the new version fails repeatedly after starting, it automatically rolls back to the previous version.

## Manual update and rollback

- Under “Settings → About” you can manually trigger a check / update;
- You can also click the “app version · dsh version” item on the right of the status bar and check for updates in the popover;
- “Roll back to previous version” immediately returns to the archived old version, suitable as an emergency measure when a new version has problems.

## Difference from DeepSeek Harness updates

| | Update target | Channel | Managed where |
|---|---|---|---|
| **App self-update** | This desktop shell | GitHub Releases | Settings → About |
| **DeepSeek Harness update** | `@deepseek-ai/dsh` | npm registry | Settings → DeepSeek Harness |

The two do not affect each other: when GitHub is unreachable, app self-update may fail while DeepSeek Harness updates still work, and vice versa.

## If an update gets stuck

- Check your network; if a proxy is required, enable it under “Settings → General → Network” and tick **app updates** (self-update) and **version lookups** (DeepSeek Harness);
- App updates and DeepSeek Harness updates use different channels and can be troubleshot separately;
- For more detailed troubleshooting see [FAQ](/en/user/faq).
