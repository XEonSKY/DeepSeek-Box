import { app, dialog, shell } from 'electron'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs'
import { createInterface } from 'node:readline'
import type { Settings } from '@shared/types'
import { errorMessage } from '@shared/errors'
import { sendCore, setCurrentUrl } from '../kernel/runtime'
import { listWindows } from '../app/windowreg'
import type { NodeRuntime } from './tools'
import { resolveDshModule, nodeRuntimeForCfg } from './tools'
import { loadSettings, mt } from '../app/settings'
import { proxyEnv } from './net'
import { describePtcNode, syncPtcNode } from './ptcNodeSync'
import { WATCHDOG_CODE } from './watchdog'
import { killAllChildren, killTree, pushLog, rememberChild } from './logbus'

/** Build the CLI args passed to the @deepseek-ai/dsh bin entry. */
function dshArgs(host: string, port: number): string[] {
    const args = ['web', '--no-open']
    if (host && host !== '127.0.0.1') args.push('--host', host)
    args.push('--port', String(port))
    return args
}

// ---------------------------------------------------------------------------
// dsh server process state（日志缓冲 / 子进程登记表已移到 logbus.ts）
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null
let childKilled = false
let serverGeneration = 0

export function killServer(): void {
    if (!serverProcess) return
    childKilled = true
    const pid = serverProcess.pid
    // 不 await：这是「立即停掉」的入口，调用方不等回收完成（killTree 已异步，不会冻结主进程）。
    if (pid) void killTree(pid)
    serverProcess = null
}

/** Whether a dsh server (a watchdog/dsh tree) is currently launched. */
export function isDshRunning(): boolean {
    return serverProcess !== null
}

/**
 * Force-stop every launched dsh instance (the active watchdog/dsh tree plus any
 * lingering registered children, e.g. older generations). Returns true if a
 * server was actually running and had to be shut down. Used before swapping or
 * removing the dsh module, where a live process would lock the files.
 */
export function stopAllDsh(): boolean {
    const wasRunning = isDshRunning()
    killServer()
    killAllChildren()
    return wasRunning
}

/** 主动停止 dsh：关停并清空当前 URL，广播给渲染层（仅核心窗口承载 dsh UI）。 */
export function stopServer(): void {
    stopAllDsh()
    setCurrentUrl(null)
    sendCore('dsh:url', null)
}

// ---------------------------------------------------------------------------
// Graceful stop
// ---------------------------------------------------------------------------

/** 优雅终止的宽限期：SIGTERM 后等 dsh 自行退出的最长时间（超时改强杀）。 */
export const SHUTDOWN_GRACE_MS = 5000

/**
 * 让当前 dsh（watchdog 树）优雅退出：经 watchdog 的 stdin 控制通道发
 * `{"cmd":"stop"}`，由 watchdog 给 dsh 发 SIGTERM 并等待其清场；若 watchdog
 * 迟迟不退（dsh 忽略信号等），超时后在此强杀兜底，避免残留孤儿进程。
 */
export function stopDshGracefully(graceMs: number = SHUTDOWN_GRACE_MS): Promise<void> {
    const child = serverProcess
    if (!child || !child.pid) {
        killServer()
        return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
        let settled = false
        let timer: NodeJS.Timeout | null = null
        const finish = (): void => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            resolve()
        }
        child.once('exit', () => {
            if (serverProcess === child) serverProcess = null
            finish()
        })
        // Ask the watchdog to gracefully stop its dsh child.
        try {
            if (child.stdin && !child.stdin.destroyed) {
                child.stdin.write(JSON.stringify({ cmd: 'stop', grace: graceMs }) + '\n')
            }
        } catch {
            /* stdin already closed → fall straight to the hard-kill timer below */
        }
        timer = setTimeout(() => {
            if (serverProcess === child) serverProcess = null
            if (child.pid) void killTree(child.pid) // force
            childKilled = true
            finish()
        }, graceMs + 3000)
    })
}

// ---------------------------------------------------------------------------
// Port selection
// ---------------------------------------------------------------------------

function findFreePort(start: number, host: string): Promise<number> {
    return new Promise((resolve) => {
        const tryPort = (candidate: number): void => {
            const probe = net.createServer()
            probe.unref()
            probe.once('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
                    if (candidate + 1 > start + 200) resolve(0)
                    else tryPort(candidate + 1)
                } else resolve(0)
            })
            probe.listen(candidate, host, () => {
                const bound = (probe.address() as net.AddressInfo).port
                probe.close(() => resolve(bound))
            })
        }
        tryPort(start)
    })
}

async function resolvePort(s: Settings): Promise<number> {
    if (s.port === 0) return 0
    const base = (s.port && s.port > 0) ? s.port : 3080
    return findFreePort(base, s.host || '127.0.0.1')
}

// ---------------------------------------------------------------------------
// dsh server lifecycle (through the watchdog)
// ---------------------------------------------------------------------------

/**
 * 启动 dsh（经 watchdog 中转）并解析它打印出的 URL。
 * 注：调用方（restart）会先挑好一个空闲端口并写回 cfg.port，因此这里总能拿到确定端口。
 */
function launchServer(cfg: Settings): Promise<string> {
    const gen = ++serverGeneration
    killServer() // stop any previous generation
    childKilled = false

    const resolved = resolveDshModule(cfg)
    if (!resolved.present || !resolved.entry) {
        return Promise.reject(
            new Error(`No usable @deepseek-ai/dsh install (source=${cfg.dshSource ?? 'local'}). Please install it first.`)
        )
    }

    let cwd = os.homedir()
    if (cfg.workspace) {
    // 默认工作目录在配置目录下；不存在则创建，创建失败再回退主目录。
        try {
            fs.mkdirSync(cfg.workspace, { recursive: true })
            cwd = cfg.workspace
        } catch {
            dialog.showErrorBox(mt('m.dialogs.workspaceMissingTitle'), mt('m.dialogs.workspaceMissing', { path: cfg.workspace }))
        }
    }

    const port = (cfg.port ?? 3080) === 0 ? 0 : cfg.port ?? 3080
    const rt = nodeRuntimeForCfg(cfg)
    const launch = { entry: resolved.entry, args: dshArgs(cfg.host || '127.0.0.1', port) }

    return new Promise<string>((resolve, reject) => {
        spawnWatchdog(rt, launch, { cwd, gen, resolve, reject, timeoutMs: cfg.timeoutMs }, cfg)
    })
}

interface SpawnOpts {
    cwd: string
    gen: number
    resolve: (url: string) => void
    reject: (err: Error) => void
    timeoutMs: number
}

function spawnWatchdog(rt: NodeRuntime, launch: { entry: string; args: string[] }, o: SpawnOpts, cfg: Settings): void {
    // 「DSH 本体」范围的代理以环境变量注入：watchdog 把它原样透传给 dsh 子进程
    //（见 watchdog.ts 里的 `env: process.env`），dsh 内部再自己决定怎么用。
    const child = rememberChild(
        spawn(rt.exec, ['-e', WATCHDOG_CODE, JSON.stringify(launch)], {
            shell: false,
            windowsHide: true,
            cwd: o.cwd,
            env: { ...process.env, ...rt.env, ...proxyEnv(cfg, 'dsh') },
            stdio: ['pipe', 'pipe', 'pipe']
        })
    )
    serverProcess = child
    let settledUrl = false
    let stderrTail = ''
    let timedOut = false

    const timer = setTimeout(() => {
        timedOut = true
        if (!settledUrl) {
            o.reject(new Error(`Timed out waiting for dsh to print its URL (${o.timeoutMs} ms).\n${stderrTail}`))
            killServer()
        }
    }, o.timeoutMs)

    const finish = (url: string): void => {
        if (settledUrl || o.gen !== serverGeneration) return
        settledUrl = true
        clearTimeout(timer)
        o.resolve(url)
    }

    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
        console.log('[Core]', line)
        pushLog('o', line)
        const m = line.match(/dsh web:\s*(https?:\/\/\S+)/i)
        if (m) finish(m[1])
    })

    child.stderr!.on('data', (d: Buffer) => {
        const s = d.toString()
        stderrTail = (stderrTail + s).slice(-4000)
        pushLog('e', s)
        console.error('[Core]', s.replace(/\n/g, '\n[Core]'))
    })

    child.stdin!.on('error', () => {})

    child.on('error', (err) => {
        if (!settledUrl && !timedOut) {
            clearTimeout(timer)
            o.reject(new Error(`Failed to start dsh: ${err.message}`))
        }
    })

    child.on('exit', (code) => {
        console.log('[Manager] dsh exited (code=', code, ')')
        clearTimeout(timer)
        // 进程已结束就清掉当前句柄，避免 isDshRunning / 后续优雅停误判到已死/复用 PID。
        if (serverProcess === child) serverProcess = null
        if (!settledUrl && !childKilled) {
            o.reject(new Error(`dsh exited before serving a URL (code=${code}).\n${stderrTail}`))
        }
    })
}

// ---------------------------------------------------------------------------
// Serialized restart
// ---------------------------------------------------------------------------

/**
 * Run one full restart cycle from the current on-disk settings. Broken out so
 * `restart` can serialize invocations — see below.
 */
async function runOneRestart(): Promise<void> {
    try {
    // 优雅停掉上一代 dsh（若有）再启动，避免反复强杀导致会话来不及落盘。
        await stopDshGracefully()
        const effective = { ...loadSettings() }
        effective.port = await resolvePort(effective)
        // PTC（run_code）worker 启动时会清空环境变量，必须用真 node；每次启动前
        // 按当前档位重算并写入 dsh 的 home 级 patch（幂等）。
        const ptc = syncPtcNode(effective.nodeRuntime)
        console.log('[Manager]', describePtcNode(ptc))
        const url = await launchServer(effective)
        setCurrentUrl(url)
        sendCore('dsh:url', url) // 只通知核心窗口：dsh UI 由核心窗口承载
        // 「设置 → 系统与性能」的「默认使用系统浏览器打开 DSH」：地址就绪后交给系统默认浏览器
        // （此时壳窗口多半隐藏在托盘里）。打不开浏览器也不影响托盘召回，故静默忽略失败。
        if (loadSettings().openDshInBrowser) {
            void shell.openExternal(url).catch(() => {
                /* ignore */
            })
        }
    } catch (err) {
        const msg = errorMessage(err)
        dialog.showErrorBox(mt('m.dialogs.startFailedTitle'), msg)
        if (listWindows().length === 0) app.quit()
    }
}

let restartBusy = false
let restartRequested = false

/**
 * Restart the dsh server, serialized: concurrent triggers (a fresh install, a
 * settings apply, the auto-start at boot) queue behind one another and coalesce
 * into a single trailing run, so they can never each spawn their own
 * watchdog/dsh generation and stack processes.
 */
export async function restart(): Promise<void> {
    restartRequested = true
    if (restartBusy) return
    restartBusy = true
    try {
        while (restartRequested) {
            restartRequested = false
            await runOneRestart()
        }
    } finally {
        restartBusy = false
    }
}
