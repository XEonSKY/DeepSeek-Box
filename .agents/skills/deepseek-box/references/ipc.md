# IPC 契约与新增端点

> 事实来源：`src/shared/api.ts`。改路由 / 事件前先读本页。

## 模型：把 IPC 当 REST 服务

| 方向 | 通道 | 信封 |
|---|---|---|
| 渲染 → 主（请求） | `ipc:request`（`ipcRenderer.invoke`） | `IpcRequest = { method, path, query?, body? }` |
| 主 → 渲染（推送） | `ipc:event`（`webContents.send`） | `IpcEvent = { event, payload }` |

- 方法只有五个：`GET`（只读）/ `POST`（创建、动作）/ `PUT`（整体更新）/ `PATCH`（局部更新）/ `DELETE`（删除）。
- 路径用 `:name` 表示路径参数（如 `/versions/:kind/:version`）。
- **只有** `src/main/app/router.ts` 直接使用 `ipcMain`；**只有** `src/preload/index.ts` 直接使用 `ipcRenderer`。不要在别处新开通道。

## 唯一事实来源：ApiRoutes

`src/shared/api.ts` 逐条登记端点：键是 `"<METHOD> <path>"`，值为 `{ query?, body?, result }`。

```ts
export interface ApiRoutes {
    'GET /settings': { result: Settings }
    'PUT /settings': { body: Settings; result: Settings }
    'GET /versions/:kind': { result: InstalledVersions }
    'POST /versions/:kind/active': { body: { version: string }; result: ToolActionResult }
    'DELETE /versions/:kind/:version': { result: ToolActionResult }
}
```

主进程处理函数与渲染层调用**都从它推导类型**：路径 / 动词 / body / 返回值任何一处对不上都会在编译期报错。

## 渲染层客户端（preload 生成的 window.api）

```ts
window.api.get('/settings')
window.api.put('/settings', { body: settings })
window.api.get('/versions/:kind', { params: { kind: 'node' } })
window.api.post('/node/deploy', { body: { version } })
window.api.delete('/icons/:id', { params: { id: 'user/a.png' } })

const off = window.api.on('settings:changed', (s) => { /* ... */ })
```

- 五个动词对应同名方法；第二个参数可选 `{ params?, query?, body? }`。
- 路径参数值会 `encodeURIComponent` 后拼进路径（`user/a.png` → `user%2Fa.png`），主进程侧解码。
- 事件订阅统一为 `window.api.on(event, cb)`，返回退订函数；事件名与载荷见 `AppEvents`。
- `window.api` 上另有本地常量 `platform` / `versions`（不经 IPC）。

## 主进程路由（Elysia 风格链式）

`src/main/app/ipc.ts` 的 `registerIpc()` 链式登记，处理函数收到 `{ event, params, query, body }`：

```ts
router
    .get('/settings', () => ({ ...DEFAULT_SETTINGS, ...readDiskSettings() }))
    .put('/settings', async ({ body }) => { /* 落盘 + 广播 settings:changed */ })
    .delete('/versions/:kind/:version', ({ params }) => removeVersion(params.kind, params.version))
```

- `Router`（`src/main/app/router.ts`）匹配顺序：**先全字面量、再 `:name` 模板**，避免 `/icons/current` 被 `/icons/:id` 抢走。
- 处理函数可同步可异步，返回值即响应；抛错则渲染层 Promise reject。
- **窗口级操作**（缩放 / 最小化 / 关闭 / 对话框）从 `ctx.event.sender` 反查发起请求的壳窗口，不要用全局主窗口。

## 事件（主 → 渲染）

事件名 `domain:action` 形式，如 `settings:changed`、`configdir:migration`、`win:maximized`。类型登记在 `AppEvents`。

主进程发送一律用 `src/main/app/runtime.ts` 的：

- `broadcast(...)` —— 发给所有窗口；
- `sendToWindow(...)` / `sendToWcId(...)` —— 发给指定窗口；
- `sendCore(...)` —— 发给核心窗口。

**不要直接 `webContents.send`**：会绕过 `ipc:event` 信封，渲染层收不到。

## 新增一个端点：标准动作

1. **`src/shared/api.ts`**：往 `ApiRoutes` 加一行；若涉及推送，再往 `AppEvents` 加一条。
2. **`src/main/app/ipc.ts`**：在 `registerIpc()` 链上实现处理函数（类型会强制与第 1 步一致）。
3. **preload 不改**——它只做通用转发。
4. 渲染层按需调用新路径；写错路径会被类型检查拦下。
5. 跑 `npm run typecheck` 确认两侧一致。

## 端点分组速查

| 分组 | 例子 |
|---|---|
| 设置 / 语言 | `GET` / `PUT /settings`、`POST /settings/apply`、`/settings/reset`、`GET` / `PUT /locale` |
| 配置目录 | `GET` / `PUT /config-dir`、`/config-dir/revert`、`/config-dir/migration` |
| DeepSeek Harness | `GET /dsh/*`、`POST /dsh/start|stop|restart|update|install`、`DELETE /dsh` |
| 环境 | `GET /env`、`/node/*`、`/npm/*`、`POST /node/deploy` |
| 模型与余额 | `GET /models/info`、`GET /models/balance`（密钥明文绝不离开主进程） |
| 应用更新 | `GET /app/meta`、`/app/update/state`、`POST /app/update/check|rollback|restart` |
| 程序图标 | `GET /icons`、`/icons/current`、`POST /icons`、`DELETE /icons/:id` |
| 外壳窗口 | `GET /shell/meta`、`POST /shell/open-url|focus-core|move-tab`、`PUT /shell/title` |
| 窗口控制 | `PUT /windows/zoom`、`GET /windows/maximized`、`POST /windows/minimize|maximize-toggle|close` |
| 跨窗口拖标签 | `POST|PATCH|DELETE /tab-drag`、`POST /tab-drag/drop` |

完整列表以 `src/shared/api.ts` 为准。
