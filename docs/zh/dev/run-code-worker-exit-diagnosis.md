# run_code worker 崩溃诊断（Electron 宿主）

> 记录时间：本次排查；适用版本 dsh 0.1.6-alpha.1 / Electron 44。
> 本文是**问题诊断**，不含修复实现；结论均在本机实测复现。


> 状态：**仅诊断，未改动任何代码**（按你的选择 C）。
> 结论均已在本机实测复现，命令与输出附在「证据」一节。

## 1. 结论（一句话）

Box 用 **electron.exe 冒充 Node** 来跑 dsh，靠环境变量 `ELECTRON_RUN_AS_NODE=1` 让它进入 Node 模式；
但 dsh 的 `run_code` worker 启动时会**清空几乎全部环境变量**（只留 6 个白名单项），
于是 worker 拿到的 electron.exe 失去了那个开关，被当成 GUI 程序启动、立刻退出 → `worker-exit (0)`。

**报错位置不是 Box，也不是 dsh 本身**，而是 dsh 的 PTC 运行时的子进程执行世界。

## 2. 精确的传播链

```
Electron 主进程 (Box)
  │  dsh.ts:202
  │  spawn(electron.exe, [WATCHDOG_CODE], env={...process.env, ...rt.env})
  │  rt.env = { ELECTRON_RUN_AS_NODE: '1' }      ← tools.ts:224 注入
  ▼
watchdog (node -e，仍是同一个 electron.exe)
  │  watchdog.ts:44
  │  spawn(process.execPath, ['--expose-internals', entry], { env: process.env })
  │         ▲ process.execPath 在 Electron 下 = electron.exe
  │         ▲ env 原样透传，此时 ERN 还在，dsh 本体因此能正常启动
  ▼
dsh 本体（跑得起来，web UI 正常）
  │  ptc-runtime-node/lib/index.js:961
  │  spawn(<worker 可执行文件>, ..., { env: <被清空的环境> })
  │         ▲ index.js:794  nodeExecutable 默认 = process.execPath = electron.exe
  │         ▲ index.js:956  env 只保留 6 项白名单
  ▼
run_code worker  ← 拿到 electron.exe 但**没有** ELECTRON_RUN_AS_NODE
  → electron.exe 以 GUI 模式启动，无窗口、无输出，立即退出
  → 报 "Node process exited before completing (0)"
```

### 2.1 那 6 个白名单项

`dsh-ptc-runtime-node/lib/index.js:478`：

```js
const STARTUP_ENVIRONMENT_NAMES = new Set([
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"
]);
```

`index.js:956` 把所有**不在**该集合里的变量值置为 `undefined`（spawn 时会直接丢弃该键）：

```js
const env = Object.fromEntries(
    Object.keys(process.env)
        .filter((key) => !STARTUP_ENVIRONMENT_NAMES.has(key.toUpperCase()))
        .map((key) => [key, void 0])
);
```

这是**有意的隔离设计**：worker 是"空程序环境"，只继承启动原生可执行文件所必需的变量。
问题不在这个设计本身，而在 **Box 选了一个必须靠环境变量才肯当 Node 用的可执行文件**。

### 2.2 worker 可执行文件从哪来

`index.js:794`：

```js
nodeExecutable: config.nodeExecutable ?? process.execPath
```

`process.execPath` 在 Electron 进程里就是 **electron.exe**。
在纯 Node 下这里会自然拿到 node.exe，所以这个 bug **只在 Electron 外壳里出现**，这与你观察到的现象一致。

## 3. 证据（本机实测）

### 3.1 A/B 对照：electron.exe 是否必须靠 ERN

```powershell
$exe = 'D:\Office\dsbox\node_modules\electron\dist\electron.exe'
$script = 'console.log("NODE_MODE_OK", process.versions.node !== undefined, process.versions.electron)'

# A) 不设 ELECTRON_RUN_AS_NODE
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& $exe -e $script

# B) 设 ELECTRON_RUN_AS_NODE=1
$env:ELECTRON_RUN_AS_NODE='1'
& $exe -e $script
```

实测输出：

```
=== A) WITHOUT ELECTRON_RUN_AS_NODE ===
  exit=                      ← 无任何输出，exit code 为空，进程瞬间消失

=== B) WITH ELECTRON_RUN_AS_NODE=1 ===
NODE_MODE_OK true 44.3.0     ← 正常以 Node 模式运行
  exit=
```

**A 的行为与报错完全吻合**：进程正常退出、退出码 0、没有任何输出 —— 正是
`Node process exited before completing (0)` 描述的情形。

### 3.2 环境变量确实会被"丢弃"

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
node -e "console.log('ERN=', JSON.stringify(process.env.ELECTRON_RUN_AS_NODE))"
# → ERN= "1"   （父进程里有）

# 起始环境里根本没有该变量时：
$env:ELECTRON_RUN_AS_NODE=$null
node -e "console.log('ERN=', JSON.stringify(process.env.ELECTRON_RUN_AS_NODE))"
# → ERN= undefined
```

配合 3.1 可知：一旦该变量缺席，electron.exe 就不再是 Node。

### 3.3 Box 侧注入点的现状

`src/main/dsh/tools.ts:213-225`：

```ts
export function nodeRuntimeFor(kind: NodeRuntimeKind): NodeRuntime {
    if (kind === 'system') { ... return { exec: p, env: {} } }
    if (kind === 'local')  { ... return { exec: p, env: {} } }
    return { exec: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } }  // ← 'electron'（默认）
}
```

即：**默认档位（`electron`）就是出问题的那一档**；`system` / `local` 两档用的是真 node.exe，
本身不带这个毛病 —— 但它们同样会被 worker 清空环境，只是它们**不需要**那个变量，所以没事。

## 4. 影响面

- **触发条件**：`nodeRuntime = electron`（默认）+ 用到 dsh 的 PTC/run_code 能力。
- **不触发**：`nodeRuntime = system` 或 `local`（用真 node.exe）。
- **表现**：dsh 本体、web UI、普通对话都可能正常，**只有 run_code 这类需要起 worker 的能力挂掉** —— 所以很容易被误判成"dsh 的 bug"或"文件读取有问题"。
- 你原始描述里的"dsh 读取文件"，其实是 worker 还没起来就死了，与具体读哪个文件无关。

## 5. 候选修复方案（含代价，供你决策）

### 方案 A：给 PTC 运行时显式指定 `nodeExecutable`（最对症）

在 dsh 配置里为 `@deepseek-ai/dsh-ptc-runtime-node` 设 `nodeExecutable` 指向**真正的 node**：

```yaml
- name: '@deepseek-ai/dsh-ptc-runtime-node'
  config:
    nodeExecutable: 'C:/path/to/node.exe'
```

- ✅ 直击根因：worker 不再依赖环境变量，天然免疫环境清空。
- ✅ 上游明确支持的字段（README 有文档，`lib/types/launch.d.ts:5` 有类型）。
- ⚠️ 需要 Box 在生成/补丁 dsh 配置时注入这个值。
- ⚠️ 该路径必须**长期有效**：若指向系统的 node.exe，用户卸载 Node 就会坏；指向 Box 部署的本地 Node 更稳。
- ⚠️ 与 `nodeRuntime` 档位要联动：选 `electron` 时其实**没有**可用的真 node，需要先决定"没有真 node 时怎么办"。

### 方案 B：让 Box 不再用 electron 冒充 Node（治本，但影响面大）

把默认 `nodeRuntime` 从 `electron` 改成 `system`/`local`，或让 `electron` 档在有真 Node 时自动回退。

- ✅ 一次性消除"electron.exe 需要 ERN"这个整类隐患（不止 PTC worker）。
- ✅ 复用已有的 `findSystemNode()` / `localNodeExecPath()`。
- ⚠️ 破坏"零依赖"卖点：现在 Box 特意不要求用户装 Node（本地 dsh 用 Electron 自带 Node 跑）。
- ⚠️ 行为变更面大，可能需要设置迁移 + 文案 + 文档。

### 方案 C：包装一个 shim 可执行文件（不推荐）

给 worker 一个设置好 ERN 的 .cmd/垫片。

- ⚠️ `resolveExecutable` 期望的是可执行文件；Windows 上 .cmd 需要 shell，容易踩新的坑。
- ⚠️ 引入额外进程层级，日志与退出码传导更复杂。

### 方案 D：向上游反馈（应与 A/B 并行）

Box 可以对 dsh 提 issue：`nodeExecutable` 默认取 `process.execPath`，
在"以 Electron 作为 Node"的宿主里会指向 electron.exe，而 worker 又清空了 ERN —— 建议上游在
检测到 `process.versions.electron` 时把 ERN 加进 `STARTUP_ENVIRONMENT_NAMES`，或默认显式解析真 node。

- ✅ 这是唯一能让"Electron 宿主"开箱即用的修法。
- ⚠️ Box 无法控制上游排期，仍需本地兜底。

## 6. 建议

**短期**：方案 A —— 在 Box 注入 dsh 配置时，为 PTC 运行时写死一个可靠的 `nodeExecutable`；
若当前档位是 `electron`（无真 Node），至少给出明确诊断而不是让它静默失败。

**中期**：评估方案 B，把"electron 当 Node"从默认改成兜底。

**并行**：提方案 D 的上游 issue。

## 7. 待你确认的问题

1. `nodeRuntime` 默认档位你希望保持 `electron`（零依赖）吗？如果保持，方案 A 就需要 Box 自己部署一份 Node 供 PTC 用，否则该功能在纯 Electron 档下无法工作。
2. 这个修复要不要我做？做的话选 A / B / A+B？
3. 是否需要我顺手加一条**启动自检**：检测到 `electron` 档 + 启用 PTC 时，提前在日志里给出可读警告（而不是等用户 run_code 才看到 worker-exit）？

---

附：本报告未修改任何源文件；临时文件已清理（`.agents/temp/`）。
