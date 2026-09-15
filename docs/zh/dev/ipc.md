# IPC 契约

主进程与渲染进程之间的通信被建模成一个 **REST 服务**：渲染层发请求、主进程按「方法 + 路径」路由；主进程另有单向事件推送。契约（路由表 + 事件表）是唯一事实来源，位于 `src/shared/api.ts`。

## 传输层

| 方向 | 通道 | 信封 |
|---|---|---|
| 渲染 → 主（请求） | `ipc:request`（`ipcRenderer.invoke`） | `IpcRequest = { method, path, query?, body? }` |
| 主 → 渲染（推送） | `ipc:event`（`webContents.send`） | `IpcEvent = { event, payload }` |

- 全项目只有 `src/main/app/router.ts` 直接碰 `ipcMain`，只有 `src/preload/index.ts` 直接碰 `ipcRenderer`。
- 方法只有五个 HTTP 动词：`GET`（只读）、`POST`（创建 / 动作）、`PUT`（整体更新）、`PATCH`（局部更新）、`DELETE`（删除）。
- 请求信封与一个 HTTP 请求同构：路径里用 `:name` 表示路径参数。

## 唯一事实来源：`ApiRoutes`

`src/shared/api.ts` 的 `ApiRoutes` 逐条登记端点：键是 `"<METHOD> <path>"`，值是 `{ query?, body?, result }`。

```ts [src/shared/api.ts]
export interface ApiRoutes {
    'GET /settings': { result: Settings }
    'PUT /settings': { body: Settings; result: Settings }
    'GET /versions/:kind': { result: InstalledVersions }
    'POST /versions/:kind/active': { body: { version: string }; result: ToolActionResult }
    'DELETE /versions/:kind/:version': { result: ToolActionResult }
    // …
}
```

主进程的处理函数与渲染层的调用**都从它推导类型**，因此路径 / 动词 / body / 返回值任何一处对不上都会在编译期报错。

## 渲染层客户端

preload 把 `ApiRoutes` 变成一个 REST 客户端挂在 `window.api` 上：

```ts [渲染层调用]
window.api.get('/settings')
window.api.put('/settings', { body: settings })
window.api.get('/versions/:kind', { params: { kind: 'node' } })
window.api.post('/node/deploy', { body: { version } })
window.api.delete('/icons/:id', { params: { id: 'user/a.png' } })
```

- 五个动词对应同名方法：`get` / `post` / `put` / `patch` / `delete`。
- 第二个参数是可选对象 `{ params?, query?, body? }`：路径参数按需必填，`query` / `body` 按路由声明。
- 路径参数值会 `encodeURIComponent` 后再拼进路径（`user/a.png` → `user%2Fa.png`），主进程侧解码。
- 事件订阅统一为 `window.api.on(event, cb)`（返回退订函数），事件名与载荷类型见同文件的 `AppEvents`。
- `window.api` 上另有本地常量 `platform` / `versions`（不经 IPC）。

## 主进程路由（Elysia 风格）

`src/main/app/ipc.ts` 的 `registerIpc()` 用链式写法登记全部端点，处理函数收到 `{ event, params, query, body }`：

```ts [src/main/app/ipc.ts]
router
    .get('/settings', () => ({ ...DEFAULT_SETTINGS, ...readDiskSettings() }))
    .put('/settings', async ({ body }) => { /* 落盘 + 广播 settings:changed */ })
    .delete('/versions/:kind/:version', ({ params }) => removeVersion(params.kind, params.version))
```

- `Router`（`src/main/app/router.ts`）负责匹配：**先比全字面量、再比带 `:name` 的模板**，避免 `/icons/current` 被 `/icons/:id` 抢走；路径参数在这里解码。
- 处理函数可同步可异步，返回值即响应；抛错则渲染层的 Promise reject。
- 窗口级操作（缩放 / 最小化 / 关闭 / 对话框）从 `ctx.event.sender` 反查「发起这次请求的那个壳窗口」，**不要**用全局主窗口。

## 事件（主 → 渲染）

事件名仍是 `domain:action`（如 `settings:changed`、`configdir:migration`、`win:maximized`），但统一走 `ipc:event` 通道，类型登记在 `AppEvents`。主进程一侧用 `runtime.ts` 的 `broadcast` / `sendToWindow` / `sendToWcId` / `sendCore` 发送——**别直接 `webContents.send`**，否则绕过信封，渲染层收不到。

## 新增一个端点：两处同步

1. **`src/shared/api.ts`**：往 `ApiRoutes` 加一行；若涉及推送，再往 `AppEvents` 加一条事件。
2. **`src/main/app/ipc.ts`**：在 `registerIpc()` 的链上实现处理函数（类型会强制它与第 1 步一致）。

**preload 不需要改**——它只做通用转发（`ipc:request` → 路由，`ipc:event` → `on`）。渲染层按需调用新路径即可，写错路径会被类型检查拦下。

## 端点分组

| 分组 | 例子 | 说明 |
|---|---|---|
| 设置 / 语言 | `GET` / `PUT /settings`、`POST /settings/apply`、`/settings/reset`、`GET` / `PUT /locale` | 读写应用设置与界面语言 |
| 配置目录 | `GET` / `PUT /config-dir`、`POST /config-dir/revert`、`/config-dir/migration`、`DELETE /config-dir/migration` | 查询 / 更改 / 迁移 / 取消 |
| DeepSeek Harness | `GET /dsh/*`、`POST /dsh/start`、`/stop`、`/restart`、`/update`、`/install`、`DELETE /dsh`、`/versions/:kind` | 安装 / 更新 / 卸载 / 运行状态 / 版本管理 |
| 环境 | `GET /env`、`/node/*`、`/npm/*`、`POST /node/deploy` | Node / npm 部署、状态、版本 |
| 模型与余额 | `GET /models/info`、`GET /models/balance` | 密钥明文绝不离开主进程 |
| 应用更新 | `GET /app/meta`、`/app/update/state`、`/slots`、`POST /app/update/check`、`/rollback`、`/restart` | 检查 / 触发 / 版本槽 / 回退 |
| 程序图标 | `GET /icons`、`/icons/current`、`POST /icons`、`DELETE /icons/:id` | 预制 / 上传 / 删除 |
| 外壳窗口 | `GET /shell/meta`、`POST /shell/open-url`、`/focus-core`、`/move-tab`、`PUT /shell/title` | 多窗口与标签转移 |
| 窗口控制 | `PUT /windows/zoom`、`GET /windows/maximized`、`POST /windows/minimize`、`/maximize-toggle`、`/close` | 无边框标题栏按钮 |
| 跨窗口拖标签 | `POST /tab-drag`、`PATCH /tab-drag`、`DELETE /tab-drag`、`POST /tab-drag/drop` | 源窗口驱动，屏幕坐标决定落点 |

::: tip
完整列表以 `src/shared/api.ts` 的 `ApiRoutes` 为准；路由引擎见 `src/main/app/router.ts`。
:::
