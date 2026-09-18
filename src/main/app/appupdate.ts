import { app, session } from 'electron'
import type { Session } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateDownloadedEvent } from 'electron-updater'
import semver from 'semver'
import type { AppMeta, AppUpdateEvent, Settings } from '@shared/types'
import { isPrerelease, stripV } from '@shared/version'
import { errorMessage } from '@shared/errors'
import { proxyActive, proxyUrl } from '../dsh/net'
import { proxyConfigFor } from '../dsh/http'
import { broadcast } from './runtime'
import { loadSettings, mt } from './settings'
import {
    appSlotsState,
    archiveRunningVersion,
    beginRollback,
    clearPending,
    dropPreviousIfCurrent,
    noteBootAttempt,
    readManifest,
    restorePrevious,
    stagePendingUpdate,
    syncCurrentVersion,
    takeRollbackResult
} from './appslots'
import { decideBootGuard } from './bootguard'

/**
 * App 自动更新（A/B 版本槽）：封装 electron-updater(GitHub)。
 * 仅打包成安装包且仓库有对应 Release 时实际可下载；开发/未打包时给出提示。
 * 下载进度等事件经 IPC 广播给渲染层的「关于」页。
 *
 * 与旧实现的关键差异：
 *  1. **自己解析发布版本**：先用 GitHub Releases API 按「是否含预发布」筛出目标 tag，
 *     再把更新源钉到该 tag 的资源目录（generic provider 读该 tag 的 latest*.yml）。
 *     CI 在每个 tag 下同时发布安装包与 channel 文件，因此不再依赖 electron-updater 的
 *     通道推断，也就不会再把「远端最新」解析成更旧的版本。
 *  2. **后台安装 + 提示重启**：`appAutoUpdate` 开启时启动即静默检查并后台下载；
 *     下载完成后把当前版本压缩归档为「上一版」（只留一个）并提示重启。
 *  3. **A/B 回退**：新版连续启动失败会自动还原上一版；用户也可手动回退一个版本。
 *
 * ⚠️ 发布侧硬前提：Release 必须已发布（不能停在 draft）——CI 的 electron-builder
 * `--publish always` 已保证；`releaseType` 由工作流按版本号决定。
 */

let inited = false

/** 最后一次更新事件：关于页可能在事件之后才挂载，靠它补齐状态。 */
let lastEvent: AppUpdateEvent | null = null

/** 向渲染层广播一次自动更新事件，并留存供后挂载的页面查询。 */
function emit(e: AppUpdateEvent): void {
    lastEvent = e
    broadcast('appupdate:event', e)
}

/**
 * 是否为 portable（免安装）版。
 *
 * portable 版没有可被安装器替换的安装目录，而 Release 里的 `latest.yml` 指向的是 NSIS 的
 * `setup.exe`；若不禁用，免安装版会被引导去下载并执行一个安装包，行为不可预期。
 * electron-builder 的 portable 运行时会注入 `PORTABLE_EXECUTABLE_DIR`。
 *
 * 注：本项目已不再构建 portable（`build.win.target` 只留 nsis），此守卫用于兜住
 * 「有人本地 `electron-builder --win portable`」这种情况。
 */
function isPortableBuild(): boolean {
    return !!process.env['PORTABLE_EXECUTABLE_DIR']
}

// ---------------------------------------------------------------------------
// 更新走代理：electron-updater 的专属网络 session
// ---------------------------------------------------------------------------

/**
 * electron-updater 的专属 session 名（见其 ElectronHttpExecutor：`fromPartition('electron-updater')`）。
 * 必须复用同一个名字，才能只给更新器设置代理而不波及 webview 与外壳 UI。
 */
const UPDATER_SESSION = 'electron-updater'

/** 更新器专属 session（代理与发布元数据请求都走它）。 */
function updaterSession(): Session {
    return session.fromPartition(UPDATER_SESSION, { cache: false })
}

/** 已应用到更新器 session 的代理 URL；null 表示「未显式设置，沿用系统代理」。 */
let appliedProxy: string | null = null

/**
 * 把「程序更新」范围的代理应用到更新器专属 session。
 *
 * 此前 `proxyScope` 里的 `'update'` 是**空转**的：`proxyActive(cfg, 'update')` 全项目从未被调用，
 * 代理只作用于 npm 子进程。于是配了代理的用户，app 自更新这一步始终直连（在必须走代理的网络里
 * 表现为长时间无响应直到超时）。
 *
 * 两个关键约束：
 *  - 只改 `partition: 'electron-updater'`，**不动 defaultSession**，因此 <webview> 不受影响；
 *  - 未配置代理时**不调用 setProxy**，保留 Electron 默认的「跟随系统代理」——否则会把本来能用的
 *    系统级代理一并关掉。只有从「有」变「无」时才显式回落到 system。
 */
async function applyUpdaterProxy(cfg: Settings): Promise<void> {
    const url = proxyActive(cfg, 'update') ? proxyUrl(cfg) : null
    if (appliedProxy === url) return
    await updaterSession().setProxy(proxyConfigFor(url))
    appliedProxy = url
}

/** 每次检查前刷新更新器环境（设置可在运行期被改，故每次都读一遍）。 */
async function prepareUpdater(cfg: Settings): Promise<void> {
    await applyUpdaterProxy(cfg)
}

// ---------------------------------------------------------------------------
// 发布解析：对齐 CI 产物（GitHub Releases API + 各平台 channel 文件）
// ---------------------------------------------------------------------------

/** 更新源 owner/repo（与 package.json 的 build.publish 一致）。 */
const OWNER = 'XEonSKY'
const REPO = 'DeepSeek-Box'

/** GitHub Releases API 精简项。 */
interface ReleaseItem {
    tag: string
    version: string
    prerelease: boolean
}

/** 用更新器专属 session 请求（自动带上「程序更新」范围配置的代理）。 */
async function fetchReleases(): Promise<ReleaseItem[]> {
    const res = await updaterSession().fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=30`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsbox-updater' }
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const arr = (await res.json()) as Array<{ tag_name?: string; prerelease?: boolean; draft?: boolean }>
    return arr
        .filter((r) => !r.draft && typeof r.tag_name === 'string')
        .map((r) => ({ tag: r.tag_name as string, version: stripV(r.tag_name as string), prerelease: !!r.prerelease }))
        .filter((r) => semver.valid(r.version) !== null)
}

/** 在候选里取最大版本；默认剔除预发布。 */
function pickRelease(list: ReleaseItem[], allowPrerelease: boolean): ReleaseItem | null {
    const pool = list.filter((r) => allowPrerelease || !r.prerelease)
    pool.sort((a, b) => semver.rcompare(a.version, b.version))
    return pool[0] ?? null
}

/** 目标 Release 的资源根：该 tag 目录下就是 CI 产出的安装包与 latest*.yml。 */
function feedUrlFor(tag: string): string {
    return `https://github.com/${OWNER}/${REPO}/releases/download/${tag}`
}

/** 已钉住的 tag（避免重复 setFeedURL）。 */
let pinnedTag: string | null = null

/** 把更新源钉到某个 tag 的资源目录（generic provider，读该 tag 的 latest*.yml）。 */
function pinFeed(tag: string): void {
    if (pinnedTag === tag) return
    // GitHub 资源不适合多段 Range 请求，关掉可避免一部分代理下下载卡住。
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrlFor(tag), useMultipleRangeRequest: false })
    pinnedTag = tag
}

// ---------------------------------------------------------------------------

/** 惰性初始化：注册 electron-updater 事件到广播。 */
function ensureInited(): void {
    if (inited) return
    inited = true
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => emit({ kind: 'checking' }))
    autoUpdater.on('update-available', (info) => emit({ kind: 'available', version: info?.version ?? null }))
    autoUpdater.on('update-not-available', (info) => emit({ kind: 'not-available', version: info?.version ?? null }))
    autoUpdater.on('download-progress', (p) =>
        emit({
            kind: 'progress',
            percent: typeof p?.percent === 'number' ? p.percent : 0,
            speed: typeof p?.bytesPerSecond === 'number' ? p.bytesPerSecond : 0,
            transferred: typeof p?.transferred === 'number' ? p.transferred : 0,
            total: typeof p?.total === 'number' ? p.total : 0
        })
    )
    autoUpdater.on('update-downloaded', (info) => void onDownloaded(info))
    autoUpdater.on('error', (err) => emit({ kind: 'error', message: err && err.message ? err.message : String(err) }))
}

/**
 * 控制是否采纳预发布版本。**仅用于** GitHub API 解析失败时的兜底默认通道。
 *
 * 正常路径下我们已用 GitHub Releases API 解析好确切 tag 并钉住 generic 源，预发布与否由
 * 设置项直接决定，不经过 electron-updater 的通道推断。但兜底路径仍需保持旧语义：
 * **不能**用设置项强行覆盖，否则预发布线用户会被钉死在「只看正式版」——
 * 这里取「设置项 OR 当前版本本身是预发布」，想跨到正式版可单独开，但没人会被卡死。
 */
function setPrerelease(on: boolean): void {
    autoUpdater.allowPrerelease = on || isPrerelease(app.getVersion())
}

// ---------------------------------------------------------------------------
// A/B：下载完成后的归档登记 + 启动守卫 / 自动回退
// ---------------------------------------------------------------------------

/** 新版首次启动的「健康观察期」；熬过去即视为安装成功。 */
const HEALTHY_MS = 30_000
/** 允许的「启动新版但未确认健康」次数；超出即自动回退。 */
const MAX_BOOT_ATTEMPTS = 3

/**
 * 下载完成：把当前版本压缩归档为「上一版」，登记待重启安装。
 * 归档是回退的唯一来源；失败只影响回退能力，不阻塞安装。
 */
async function onDownloaded(info: UpdateDownloadedEvent): Promise<void> {
    const version = info?.version ?? null
    const current = app.getVersion()
    if (!version || version === current) {
        emit({ kind: 'downloaded', version, canRollback: appSlotsState().canRollback })
        return
    }
    emit({ kind: 'staging', version })
    await archiveRunningVersion()
    stagePendingUpdate(version)
    const slots = appSlotsState()
    emit({ kind: 'downloaded', version, canRollback: slots.canRollback, previous: slots.previous?.version ?? null })
}

/**
 * 启动守卫：
 *  - 先消费上一轮回退脚本留下的结果：失败即停止重试并如实报错（不再起第二轮）；
 *  - 写入当前版本，并在「当前版本 == 上一版归档」时清掉已过期的归档记录；
 *  - 判定交给纯函数 `decideBootGuard`（见 bootguard.ts）：无记录 / 记录过期 / 计数 /
 *    触发回退 / 放弃回退，五选一；
 *  - 每轮待安装记录**至多回退一次**（`beginRollback` 落盘计数），杜绝
 *    「回退 → 启动 → 再回退」的无限循环。
 * 返回 false 表示已安排自动回退，调用方不应继续做更新检查。
 */
function runBootGuard(): boolean {
    const running = app.getVersion()

    const result = takeRollbackResult()
    if (result && !result.ok) {
        clearPending()
        emit({ kind: 'error', message: mt('m.appUpdate.rollbackGaveUp', { version: running }) })
        return true
    }

    syncCurrentVersion(running)
    dropPreviousIfCurrent(running)

    const decision = decideBootGuard({ running, pending: readManifest().pending, maxAttempts: MAX_BOOT_ATTEMPTS })
    switch (decision.kind) {
        case 'idle':
            return true
        case 'clear':
            clearPending()
            return true
        case 'count':
            noteBootAttempt(running)
            setTimeout(() => clearPending(), HEALTHY_MS)
            return true
        case 'giveup':
            // 回退过一次还是这个版本：回退没生效，别再重启脚本了
            clearPending()
            emit({ kind: 'error', message: mt('m.appUpdate.rollbackGaveUp', { version: running }) })
            return true
        case 'rollback': {
            // 先落盘「已回退过一次」，再起脚本：脚本即使没回写结果也不会进入第二轮
            beginRollback(running)
            const previous = readManifest().previous?.version ?? null
            emit({
                kind: 'rollback',
                version: previous,
                message: mt('m.appUpdate.autoRollback', { version: previous ?? '?' })
            })
            setTimeout(() => {
                const res = restorePrevious()
                if (res.ok) setTimeout(() => app.quit(), 400)
                else {
                    // 起不来（例如安装目录无写权限）就到此为止，避免「启动 → 回退 → 启动」空转
                    clearPending()
                    emit({ kind: 'error', message: res.message })
                }
            }, 1500)
            return false
        }
    }
}

/**
 * 优雅退出（`before-quit` 走完清理）时调用。
 *
 * 正在运行的就是待安装记录里的目标版本，说明它已经能正常启动起来、只是还没熬满健康观察期 ——
 * 用户手动关掉它**不是**启动失败。不这么判的话，快速开合几次就会被误判成「连续启动失败」，
 * 从而触发一次本不该发生的自动回退。
 */
export function noteGracefulExit(): void {
    const running = app.getVersion()
    const pending = readManifest().pending
    if (pending && pending.to === running) clearPending()
}

/** 运行环境元信息（关于页显示当前版本/架构）。 */
export function appMeta(): AppMeta {
    let version: string | null = null
    try {
        version = app.getVersion() || null
    } catch {
    /* not packaged */
    }
    return { version, arch: process.arch, platform: process.platform }
}

/** 最近一次自动更新状态；关于页挂载晚于事件时据此补齐（从未有过事件则为 null）。 */
export function appUpdateState(): AppUpdateEvent | null {
    return lastEvent
}

/**
 * 触发一次检查：
 *  1. 解析 GitHub Releases，按 `prerelease` 选出目标版本；
 *  2. 有更新则把更新源钉到该 tag，交给 electron-updater 后台下载；
 *  3. 无更新直接广播 `not-available`（带上远端真实版本，便于排查）；
 *  4. 解析失败（离线 / API 限流）退回 electron-updater 的默认 GitHub 通道。
 */
export async function triggerAppUpdate(opts: { prerelease: boolean }): Promise<{ ok: boolean; message: string }> {
    if (!app.isPackaged) return { ok: false, message: mt('m.appUpdate.onlyPackaged') }
    if (isPortableBuild()) return { ok: false, message: mt('m.appUpdate.portable') }
    ensureInited()

    await prepareUpdater(loadSettings())
    emit({ kind: 'checking' })

    const current = app.getVersion()
    let target: ReleaseItem | null
    try {
        target = pickRelease(await fetchReleases(), opts.prerelease)
    } catch {
        setPrerelease(opts.prerelease)
        try {
            await autoUpdater.checkForUpdates()
            return { ok: true, message: '' }
        } catch (err) {
            return { ok: false, message: errorMessage(err) }
        }
    }

    if (!target || !semver.gt(target.version, current)) {
        emit({ kind: 'not-available', version: target?.version ?? null })
        return { ok: true, message: '' }
    }

    pinFeed(target.tag)
    try {
        await autoUpdater.checkForUpdates()
        return { ok: true, message: '' }
    } catch (err) {
        return { ok: false, message: errorMessage(err) }
    }
}

/** 立即重启并安装已下载的更新（后台下载完成后调用）。 */
export function restartAndInstall(): void {
    if (app.isPackaged && !isPortableBuild()) autoUpdater.quitAndInstall()
}

/** 手动回退到压缩保留的上一版；成功后会重启应用。 */
export function rollbackAppUpdate(): { ok: boolean; message: string } {
    if (!app.isPackaged || isPortableBuild()) return { ok: false, message: mt('m.appUpdate.onlyPackaged') }
    const r = restorePrevious()
    if (r.ok) {
        emit({ kind: 'rollback', version: r.version, message: r.message })
        setTimeout(() => app.quit(), 400)
    }
    return { ok: r.ok, message: r.message }
}

/** 版本槽状态（设置页展示；转发自 appslots）。 */
export { appSlotsState }

/**
 * 启动时先跑 A/B 启动守卫，再按设置做一次静默的后台检查（失败不打扰）。
 * `appAutoUpdate` 开启时，electron-updater 会自动后台下载；下载完成后由 onDownloaded
 * 归档旧版并广播「待重启」事件。
 */
export function startAutoCheckIfEnabled(): void {
    if (!app.isPackaged || isPortableBuild()) return
    ensureInited()
    if (!runBootGuard()) return
    const s = loadSettings()
    if (!s.appAutoUpdate) return
    void triggerAppUpdate({ prerelease: s.appCheckPrerelease })
}
