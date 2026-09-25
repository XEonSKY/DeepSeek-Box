import path from 'node:path'
import fs from 'node:fs'
import type { InstalledVersions, NodeDeployProgress, NodeDeployResult, NodeRuntimeStatus, NodeStatus } from '@shared/types'
import { loadSettings, tempDownloadDir } from '../app/settings'
import { isDshRunning } from './dsh'
import { runChild } from './child'
import { removeQuietly } from '../kernel/treeops'
import { pushLog } from './logbus'
import { findSystemNode, localNodeExecPath, nodeVersionOf } from './tools'
import { compareVersions, stripV } from './semver'
import { downloadFile } from './downloader'
import { httpFetch } from './http'
import { beginCancelable, CANCELED_MESSAGE } from '../kernel/operations'
import { activeVersion, installRoot, listInstalled, prepareVersionDir, removeVersion, resolveActive, setActiveVersion, versionDir } from './installs'

/**
 * Node.js 版本管理：按当前平台 / 架构下载官方发行包，解压后放进
 * `<configDir>/node/<版本>/`，允许多版本并存；`.active` 指向生效版本。
 * 平台名 / 扩展名 / 内部目录均按 Node 官方发行命名。
 */

const NODE_DIST = 'https://nodejs.org/dist'

function nodeOs(): string {
    if (process.platform === 'win32') return 'win'
    if (process.platform === 'darwin') return 'darwin'
    return 'linux'
}

function extOf(): string {
    return nodeOs() === 'win' ? 'zip' : 'tar.gz'
}

/** 当前生效的本地 Node 目录（尚无版本时为安装根目录）。 */
export function localNodeDir(): string {
    const active = resolveActive('node')
    return active ? versionDir('node', active) : installRoot('node')
}

/**
 * 发行索引（index.json，新 → 旧）的短缓存。设置页每次进入「环境」都要拿版本列表，
 * 而该文件有几百 KB；10 分钟内复用。**失败不写缓存** —— 否则一次网络抖动会让版本列表空锁 10 分钟。
 */
const DIST_TTL_MS = 10 * 60 * 1000

interface NodeRelease {
    version: string
    lts: boolean
}

let distCache: { at: number; list: NodeRelease[] } | null = null

/** 取官方发行索引（新 → 旧）；失败返回 null（失败不缓存）。 */
async function nodeDistIndex(): Promise<NodeRelease[] | null> {
    if (distCache && Date.now() - distCache.at < DIST_TTL_MS) return distCache.list
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20000)
    try {
        const res = await httpFetch('node', `${NODE_DIST}/index.json`, { signal: ctrl.signal })
        if (!res.ok) return null
        const arr = (await res.json()) as Array<{ version?: unknown; lts?: unknown }>
        const list: NodeRelease[] = []
        for (const x of arr) {
            if (typeof x.version === 'string') list.push({ version: x.version, lts: !!x.lts })
        }
        if (list.length === 0) return null
        distCache = { at: Date.now(), list }
        return list
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

/** 从官方 index.json 取最新 LTS 版本号（如 v22.14.0）。 */
export async function latestLtsVersion(): Promise<string | null> {
    const list = await nodeDistIndex()
    return list?.find((x) => x.lts)?.version ?? null
}

/**
 * 可安装的 Node 版本列表（新 → 旧）；`includeNonLts=false` 时优先只给 LTS。
 * 万一索引里一个 LTS 都没有（罕见），退回全部版本 —— 不能让下拉框空着。
 */
export async function listNodeVersions(includeNonLts: boolean): Promise<string[]> {
    const list = await nodeDistIndex()
    if (!list) return []
    if (includeNonLts) return list.map((x) => x.version)
    const lts = list.filter((x) => x.lts).map((x) => x.version)
    return lts.length > 0 ? lts : list.map((x) => x.version)
}

/**
 * 系统 / 本地部署 Node 的当前版本 + 与最新 LTS 的对比（设置 → 环境页）。
 *
 * 版本比较放主进程做：`semver` 是 main 的运行时依赖，渲染层不该引它；
 * 比较结果比原始字符串更不容易被前端各写一份而漂移。
 */
export async function nodeStatus(): Promise<NodeStatus> {
    const sysPath = findSystemNode()
    const localPath = localNodeExecPath()
    const [systemVersion, localVersion, latest] = await Promise.all([
        sysPath ? nodeVersionOf(sysPath) : Promise.resolve(null),
        localPath ? nodeVersionOf(localPath) : Promise.resolve(null),
        latestLtsVersion()
    ])
    const mk = (version: string | null, present: boolean): NodeRuntimeStatus => ({
        present,
        version,
        outdated: !!version && !!latest && compareVersions(stripV(version), stripV(latest)) < 0
    })
    return { latest, system: mk(systemVersion, !!sysPath), local: mk(localVersion, !!localPath) }
}

/** 解压发行包；取消时杀掉子进程并返回 false。 */
function extract(stage: string, file: string, signal: AbortSignal): Promise<boolean> {
    const win = nodeOs() === 'win'
    const exec = win ? 'powershell.exe' : 'tar'
    const argv = win
        ? ['-NoProfile', '-NonInteractive', '-Command', "Expand-Archive -Path '" + file + "' -DestinationPath '" + stage + "' -Force"]
        : ['-xzf', file, '-C', stage]
    pushLog('o', '[Manager] 解压 Node 压缩包…')
    return runChild(exec, { argv, onStdoutLine: (s) => pushLog('o', s), onStderr: (s) => pushLog('e', s) }, signal).then((r) => r.ok)
}

/** 已安装 / 生效的本地 Node 版本。 */
export function listInstalledNodeVersions(): InstalledVersions {
    return { installed: listInstalled('node'), active: activeVersion('node') }
}

/** 切换本地 Node 生效版本（只改指针，不重装；重启 dsh 后生效）。 */
export function useNodeVersion(version: string): NodeDeployResult {
    if (!listInstalled('node').includes(version)) return { ok: false, message: `未安装 Node ${version}`, version: null }
    setActiveVersion('node', version)
    return { ok: true, message: `已切换到 Node ${version}（重启 dsh 后生效）`, version }
}

/** 删除某个本地 Node 版本；正在使用该版本运行 dsh 时拒绝。 */
export async function removeInstalledNodeVersion(version: string): Promise<NodeDeployResult> {
    if (activeVersion('node') === version && loadSettings().nodeRuntime === 'local' && isDshRunning()) {
        return { ok: false, message: 'dsh 正在使用该 Node 版本运行，请先停止 dsh。', version }
    }
    await removeVersion('node', version)
    return { ok: true, message: `已删除 Node ${version}`, version }
}

/**
 * 下载指定（默认最新 LTS）Node 发行包，解压到 `<configDir>/node/<版本>/` 并设为生效版本。
 * 多版本并存：不会动其它已安装版本。下载与解压阶段均可取消。
 */
export async function deployLocalNode(
    onProgress?: (p: NodeDeployProgress) => void,
    version?: string
): Promise<NodeDeployResult> {
    const token = beginCancelable()
    try {
        const ver = version ?? (await latestLtsVersion())
        if (!ver) return { ok: false, message: '无法获取 Node 版本（网络不可用？）', version: null }
        // 版本号会被拼进下载 URL 与目录名，必须挡住意外/恶意字符串。
        if (!/^v\d+\.\d+\.\d+$/.test(ver)) return { ok: false, message: `Node 版本号不合法：${ver}`, version: null }
        // 正在用该版本的本地 Node 跑 dsh 时不能覆盖它（Windows 上运行中的 node.exe 被锁）。
        if (loadSettings().nodeRuntime === 'local' && isDshRunning() && activeVersion('node') === ver) {
            return { ok: false, message: 'dsh 正在使用该 Node 版本运行，请先停止 dsh 再重装。', version: ver }
        }

        const dir = `node-${ver}-${nodeOs()}-${process.arch}`
        const url = `${NODE_DIST}/${ver}/${dir}.${extOf()}`
        const stage = path.join(installRoot('node'), '.tmp')
        const file = path.join(stage, `${dir}.${extOf()}`)
        try {
            await removeQuietly(stage)
            await fs.promises.mkdir(stage, { recursive: true })
        } catch {
            return { ok: false, message: '无法创建配置目录', version: ver }
        }

        pushLog('o', `[Manager] 下载 ${url}`)
        const dl = await downloadFile({
            url,
            destDir: stage,
            fileName: `${dir}.${extOf()}`,
            tmpDir: tempDownloadDir(),
            threads: loadSettings().downloadThreads,
            signal: token.signal,
            // Node 发行包属于「Node 下载部署」这一档代理范围
            proxyScope: 'node',
            onProgress: (p) => onProgress?.({ phase: 'download', ...p })
        })
        if (dl.canceled) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: ver }
        if (!dl.ok) return { ok: false, message: dl.message ?? '下载 Node 失败', version: ver }

        onProgress?.({ phase: 'extract', percent: 100, downloaded: 0, total: 0, speed: 0 })
        const okExtract = await extract(stage, file, token.signal)
        await removeQuietly(file)
        if (token.signal.aborted) return { ok: false, canceled: true, message: CANCELED_MESSAGE, version: ver }
        if (!okExtract) {
            await removeQuietly(stage)
            return { ok: false, message: '解压 Node 失败', version: ver }
        }

        const src = path.join(stage, dir)
        if (!fs.existsSync(src)) {
            await removeQuietly(stage)
            return { ok: false, message: '解压后未找到 Node 目录', version: ver }
        }

        let dest: string
        try {
            dest = await prepareVersionDir('node', ver)
            // 逐项搬进版本目录（同盘 rename 很快）；被占用时退回整目录拷贝。
            // 拷贝走 promise 版：几万个小文件同步拷会把主进程独占住，界面完全没响应。
            try {
                for (const n of fs.readdirSync(src)) fs.renameSync(path.join(src, n), path.join(dest, n))
                await removeQuietly(src)
            } catch {
                await removeQuietly(dest)
                await fs.promises.cp(src, dest, { recursive: true })
                await removeQuietly(src)
            }
        } catch (err) {
            await removeVersion('node', ver)
            await removeQuietly(stage)
            return { ok: false, message: err instanceof Error ? err.message : '移动 Node 到配置目录失败', version: ver }
        }
        setActiveVersion('node', ver)
        await removeQuietly(stage)
        pushLog('o', `[Manager] Node ${ver} 已部署到 ${dest}`)
        return { ok: true, message: `Node ${ver} 已部署并生效`, version: ver }
    } finally {
        token.done()
    }
}
