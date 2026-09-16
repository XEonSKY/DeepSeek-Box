/**
 * 以 `node -e` 运行的 watchdog 脚本（内嵌为字符串）。
 *
 * 它是 `dsh web` 的**真父进程**，保证外壳退出时 dsh 一并消亡——优雅退出或强杀都成立：
 *   - 优雅退出：Electron 杀掉 watchdog 进程树（taskkill /T / -pid）。
 *   - 强杀 / 崩溃：本进程的 stdin 写端被 OS 关闭，watchdog 读到 EOF 后自行杀掉 dsh 树。
 * argv[1] 是 JSON 启动描述符：{ entry, args }。
 * watchdog 会用**同一个 Node 运行时**（本地 dsh 时即 Electron-as-Node）重新拉起 dsh 的 JS bin 入口，
 * 因此不依赖 shell `.cmd` 垫片，也不需要系统 `node`。
 *
 * 单独成文件的理由：这是一段**独立程序**（62 行 JS），与主进程的类型化代码不同源，
 * 混在 dsh.ts 里会淹没真正的进程管理逻辑。
 */
export const WATCHDOG_CODE = `
"use strict";
const { spawn, spawnSync } = require("child_process");
const IS_WIN = process.platform === "win32";
let child = null;
let stopping = false;
function killTree(pid) {
    if (!pid) return;
    try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    else { try { process.kill(-pid, "SIGKILL"); } catch (_) { try { process.kill(pid, "SIGKILL"); } catch (__) {} } }
    } catch (_) {}
}
function forceShutdown() { if (child) { killTree(child.pid); child = null; } try { process.exit(0); } catch (_) {} }
// Graceful stop: SIGTERM the dsh child (letting it flush sessions / dispose
// plugins), then force-kill only if it has not exited within the grace ms.
function gracefulStop(grace) {
    if (stopping) return;
    stopping = true;
    if (!child) { try { process.exit(0); } catch (_) {} return; }
    const g = (typeof grace === "number" && grace > 0) ? grace : 5000;
    const timer = setTimeout(function () { killTree(child.pid); child = null; try { process.exit(0); } catch (_) {} }, g);
    child.on("exit", function () { clearTimeout(timer); try { process.exit(0); } catch (_) {} });
    try { child.kill("SIGTERM"); } catch (_) {} // best effort; graceful where the OS/dsh supports it
}
let launch = null;
try { launch = JSON.parse(process.argv[1] || "null"); } catch (_) { launch = null; }
if (!launch || typeof launch.entry !== "string") { console.error("watchdog: bad launch descriptor"); process.exit(2); }
// dsh's web profile runs an HMR service that requires Node launched with
// --expose-internals, so pass it through when we spawn the dsh bin.
child = spawn(process.execPath, ['--expose-internals', launch.entry].concat(launch.args || []), {
    detached: !IS_WIN,
    windowsHide: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("exit", (code) => { if (stopping) { try { process.exit(0); } catch (_) {} } else { try { process.exit(code == null ? 0 : code); } catch (_) {} } });
child.on("error", () => { try { process.exit(1); } catch (_) {} });
// Control channel on stdin: a JSON line {"cmd":"stop","grace":N} asks for a
// graceful stop of the dsh child. stdin EOF (shell gone) falls back to force.
let stdinBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function (chunk) {
    stdinBuf += chunk;
    let idx;
    while ((idx = stdinBuf.indexOf("\\n")) >= 0) {
    const line = stdinBuf.slice(0, idx).trim();
    stdinBuf = stdinBuf.slice(idx + 1);
    if (!line) continue;
    let cmd = null;
    try { cmd = JSON.parse(line); } catch (_) { cmd = null; }
    if (cmd && cmd.cmd === "stop") gracefulStop(cmd.grace);
    }
});
process.stdin.on("end", function () { if (!stopping) forceShutdown(); });
process.stdin.on("close", function () { if (!stopping) forceShutdown(); });
["SIGINT", "SIGTERM", "SIGHUP"].forEach((s) => process.on(s, function () { if (!stopping) forceShutdown(); }));
process.on("exit", () => { if (child) killTree(child.pid); });
`
