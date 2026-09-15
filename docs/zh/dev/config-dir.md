# 配置目录与迁移

应用自身的数据（设置、DeepSeek Harness、Node、npm、默认工作区）都放在**配置目录**，而不是 Electron 的 userData。本页说明默认位置、覆盖机制与两阶段迁移。

## 默认位置

| 场景 | 目录 |
|---|---|
| 打包（release） | `~/.dsbox/release` |
| 开发（dev） | `~/.dsbox/dev` |

用户可在「设置 → 常规 → 配置文件夹」自选覆盖。

## 覆盖指针

自选目录记录在 `<userData>/config-dir`（与配置目录解耦，保证能先于 `settings.json` 读取，避免「配置目录本身由配置决定」的鸡生蛋问题）。逻辑在 `main/app/settings.ts`：

- `defaultConfigDir()` / `legacyDefaultConfigDirs()` / `configDir()`
- `configDirInfo()` / `setConfigDir()` / `revertConfigDir()`

## 升级时的自动迁移

`ensureDefaultConfigMigration()` 在启动最早期调用：如果用户从未自选目录，且旧默认目录（`~/.config/dsh_shell[_dev]`、中间版本用过的 `~/dsbox/{release,dev}`）有内容，就登记一份迁移计划。

## 两阶段迁移

**第一阶段（设置时）**：`setConfigDir()` 不立即搬迁，只写迁移计划（`<userData>/config-migration.json`）。存在计划时 `configDir()` 仍返回**旧目录**，保证重启前设置可读。

**第二阶段（重启引导）**：`main/index.ts` 建窗后 `await waitForConfigMigration()` 才启动 DeepSeek Harness 与监听；搬迁由 `main/app/configmigrate.ts` 执行：

- 先 `scanTree` 统计文件数；
- `migrateTree` 逐项搬迁：同盘整目录 `rename`，跨盘或目标存在则递归 copy + unlink，并记录 journal；
- 每处理一项广播 `configdir:migration` 进度（渲染层全屏进度框，可取消）；
- 成功才把当前目录指向新位置；**取消则 `rollbackMoves` 逆序搬回**并固定回旧目录。

::: info
搬迁失败（如文件被占用）时不会删除源文件，避免丢数据；详见 `configmigrate.ts` 的 `mergeInto`。
:::

## 临时目录

- 下载临时文件：`<工作目录>/temp/download`
- npm 缓存：`<工作目录>/temp/npm`

## 相关

- [DeepSeek Harness 与环境安装链路](/zh/dev/installs)
- [应用自更新](/zh/dev/app-update)