import { app, dialog, nativeTheme } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { defu } from 'defu'
import { PATCH_FILENAME, composePatchConfig, mergePatchEntryConfig, readConfigString } from '../dsh/cordisPatch'
import { dshHomeDir, homePatchFile, profilePatchFile } from '../dsh/dshHome'
import { PNPM_MANIFEST_REL } from '../dsh/pnpmEntry'
import writeFileAtomic from 'write-file-atomic'
import { DEFAULT_SETTINGS, COLOR_SCHEME_IDS, PROXY_SCOPE_IDS, SETTINGS_VERSION } from '@shared/types'
import type { ConfigDirInfo, ConfigMigrationPlan, ConfigMigrationProgress, Settings, ResolvedLocale, LocaleCode, ColorSchemeId, ProxyScope } from '@shared/types'
import { resolveLocale, t as tl } from '@shared/i18n'
import { broadcast } from '../kernel/runtime'
import { clearMigrationPlan, migrateTree, readMigrationPlan, rollbackMoves, scanTree, writeMigrationPlan } from './configmigrate'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * 配置目录：默认在用户主目录的隐藏目录 .dsbox 下，开发态与发行态分开——
 *   - 发行（打包）：~/.dsbox/release
 *   - 开发（dev/start）：~/.dsbox/dev
 * 用户可在「设置 → 常规」自选覆盖。覆盖指针存于 userData（固定位置，先于
 * settings.json 读取，避免“配置目录本身由配置决定”的鸡生蛋问题）。
 * 更改目录不会立即搬迁，而是落一份迁移计划，待下次重启的引导阶段执行。
 */
function defaultConfigDir(): string {
    return path.join(os.homedir(), '.dsbox', app.isPackaged ? 'release' : 'dev')
}

/**
 * 曾经用过的默认目录（升级时自动迁移到 ~/.dsbox）：
 *  - ~/dsbox/{release,dev}：短暂用过的中间默认位置；
 *  - ~/.config/dsh_shell[_dev]：最初的默认位置。
 * 按「越新越靠前」返回，升级时取第一个存在者作为迁移源。
 */
function legacyDefaultConfigDirs(): string[] {
    const release = app.isPackaged
    return [
        path.join(os.homedir(), 'dsbox', release ? 'release' : 'dev'),
        path.join(os.homedir(), '.config', release ? 'dsh_shell' : 'dsh_shell_dev')
    ]
}

/** 自选配置目录的指针文件（放 userData，与 configDir 解耦，保证可先读）。 */
function configPointerFile(): string {
    return path.join(app.getPath('userData'), 'config-dir')
}

function readConfigOverride(): string | null {
    try {
        const raw = fs.readFileSync(configPointerFile(), 'utf8').trim()
        return raw || null
    } catch {
        return null
    }
}

/** 写入 / 清除覆盖指针（null 表示回归默认目录）。 */
function writeConfigOverride(dir: string | null): void {
    try {
        fs.mkdirSync(path.dirname(configPointerFile()), { recursive: true })
        if (dir) writeFileAtomic.sync(configPointerFile(), dir, 'utf8')
        else {
            try {
                fs.unlinkSync(configPointerFile())
            } catch {
                /* ignore */
            }
        }
    } catch (err) {
        console.error('[Manager] failed to persist config-dir override:', err)
    }
}

/** 内存中的迁移计划缓存（仅本模块写，避免热点路径反复读盘）。undefined = 尚未读取。 */
let pendingMigration: ConfigMigrationPlan | null | undefined

/** 待执行的配置目录迁移计划（无则 null）。 */
export function configMigrationPlan(): ConfigMigrationPlan | null {
    if (pendingMigration === undefined) pendingMigration = readMigrationPlan()
    return pendingMigration
}

/** 两个目录是否互为父子（Windows 下大小写不敏感）；互为父子时迁移会自我递归。 */
function isNestedDir(a: string, b: string): boolean {
    const norm = (p: string): string => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
    const na = norm(a)
    const nb = norm(b)
    if (na === nb) return false
    return nb.startsWith(na + path.sep) || na.startsWith(nb + path.sep)
}

/** 更新迁移计划（内存 + 磁盘）。 */
function setMigrationPlan(plan: ConfigMigrationPlan | null): void {
    pendingMigration = plan
    if (plan) writeMigrationPlan(plan)
    else clearMigrationPlan()
}

/** 当前有效配置目录：迁移未完成时仍是旧目录（内容尚未搬走）。 */
export function configDir(): string {
    const plan = configMigrationPlan()
    if (plan) return plan.from
    return readConfigOverride() || defaultConfigDir()
}

/** 向导 / 设置页展示：当前有效 + 默认 + 覆盖值 + 待迁移计划。 */
export function configDirInfo(): ConfigDirInfo {
    return {
        current: configDir(),
        default: defaultConfigDir(),
        override: readConfigOverride(),
        pending: configMigrationPlan()
    }
}

/**
 * 设置自选配置目录；传 null 恢复默认。
 *
 * 旧目录存在内容时不立即搬迁，只记录「重启后迁移」计划（返回值的 pending 非空），
 * 由调用方提示用户重启；用户取消则用 revertConfigDir() 撤销。旧目录不存在
 *（首次安装）时直接生效，无需重启。
 */
export function setConfigDir(dir: string | null): ConfigDirInfo {
    const from = configDir()
    const to = dir || defaultConfigDir()
    const override = !!dir
    if (to !== from && isNestedDir(from, to)) {
        // 互为父子目录：搬迁会自我递归，直接拒绝并保持原目录（渲染层据此提示用户）
        console.warn('[Manager] refuse nested config dir:', from, '->', to)
        return configDirInfo()
    }
    if (to === from) {
        setMigrationPlan(null)
        writeConfigOverride(override ? to : null)
        settleMigrationWaiters()
    } else if (!fs.existsSync(from)) {
        setMigrationPlan(null)
        writeConfigOverride(override ? to : null)
        rewatchConfig()
        settleMigrationWaiters()
    } else {
        setMigrationPlan({ from, to, override })
    }
    return configDirInfo()
}

/** 取消尚未执行的迁移：固定回旧目录，撤销本次更改。 */
export function revertConfigDir(): ConfigDirInfo {
    const plan = configMigrationPlan()
    if (plan) {
        setMigrationPlan(null)
        writeConfigOverride(plan.from)
        rewatchConfig()
        // 计划已撤销 = 引导阶段无需再等迁移。必须在目录指针落盘之后才放行，
        // 否则等待方会读到尚未更新的旧目录。
        settleMigrationWaiters()
    }
    return configDirInfo()
}

/**
 * 升级默认目录：新默认位置为 ~/.dsbox/{release,dev}；旧默认目录（~/.config/dsh_shell[_dev]
 * 或中间版本用过的 ~/dsbox/{release,dev}）有内容、且用户从未自选过目录
 * 时，自动登记一份迁移计划，让本次重启走一次迁移。必须在任何 readDiskSettings() 之前
 * 调用，否则会读到还不存在的新目录。
 */
export function ensureDefaultConfigMigration(): void {
    try {
        if (readConfigOverride() || configMigrationPlan()) return
        const to = defaultConfigDir()
        // 新目录已经有 settings.json 说明迁移过（或用户已在新位置使用），不再重复迁移。
        if (fs.existsSync(path.join(to, 'settings.json'))) return
        for (const from of legacyDefaultConfigDirs()) {
            if (from === to || isNestedDir(from, to) || !fs.existsSync(from)) continue
            setMigrationPlan({ from, to, override: false })
            return
        }
    } catch (err) {
        console.error('[Manager] failed to queue default config migration:', err)
    }
}

// ---------------------------------------------------------------------------
// 重启引导阶段的配置目录迁移（广播进度，供渲染层显示进度条与当前文件）
// ---------------------------------------------------------------------------

let migrationRunning = false
let migrationCancel = false
const migrationWaiters: Array<() => void> = []

/** 请求取消正在执行的迁移（已搬内容会回滚）。 */
export function cancelConfigMigration(): void {
    if (migrationRunning) migrationCancel = true
}

function emitMigrationProgress(p: ConfigMigrationProgress): void {
    broadcast('configdir:migration', p)
}

function settleMigrationWaiters(): void {
    for (const done of migrationWaiters.splice(0)) done()
}

/**
 * 执行待迁移计划：先统计文件数，再逐项搬迁并广播进度；成功后把当前目录指向新位置，
 * 取消 / 失败则回滚（取消时）并保持原目录。进行中重复调用安全（直接忽略）。
 */
export async function runConfigMigration(): Promise<void> {
    const plan = configMigrationPlan()
    if (!plan || migrationRunning) return
    migrationRunning = true
    migrationCancel = false

    const scan = await scanTree(plan.from)
    const total = scan.total
    let moved = 0
    let lastEmit = 0

    emitMigrationProgress({ phase: 'scan', current: plan.from, moved: 0, total, percent: 0, done: false, ok: true })

    const finish = (ok: boolean, canceled: boolean): void => {
        if (ok) {
            setMigrationPlan(null)
            writeConfigOverride(plan.override ? plan.to : null)
        } else {
            setMigrationPlan(null)
            writeConfigOverride(plan.from)
        }
        rewatchConfig()
        const shown = Math.min(moved, total)
        const percent = ok ? 100 : Math.round((shown / Math.max(1, total)) * 100)
        emitMigrationProgress({ phase: 'done', current: '', moved: shown, total, percent, done: true, ok, canceled })
        migrationRunning = false
        settleMigrationWaiters()
    }

    try {
        const result = await migrateTree(plan, {
            scan,
            onAdvance: (current, n) => {
                moved += n
                const now = Date.now()
                if (now - lastEmit < 60 && moved < total) return
                lastEmit = now
                const shown = Math.min(moved, total)
                emitMigrationProgress({
                    phase: 'move',
                    current,
                    moved: shown,
                    total,
                    percent: Math.round((shown / Math.max(1, total)) * 100),
                    done: false,
                    ok: true
                })
            },
            shouldStop: () => migrationCancel
        })

        if (result.stopped || migrationCancel) {
            await rollbackMoves(result.journal)
            finish(false, true)
            return
        }
        finish(true, false)
    } catch (err) {
        // 兜底：任何未预期异常都不能让引导阶段卡住（保持旧目录并放行启动）
        console.error('[Manager] config migration crashed:', err)
        finish(false, false)
    }
}

/**
 * 引导阶段等待迁移完成：无待迁移计划时立即返回；有则由渲染层触发执行，最长等待
 * timeoutMs 后自行兜底执行，避免无人触发时卡住启动。
 *
 * 三条放行路径缺一不可，否则启动会永久挂起：
 *  1. 迁移正常结束 —— `runConfigMigration()` 的 `finish()` 里 settle；
 *  2. 计划在执行前被撤销（`revertConfigDir()` / `setConfigDir()` 清空计划）—— 由那两处 settle；
 *  3. 兜底超时到点时已经没有计划可迁 —— 这里必须主动 settle（曾经漏掉，导致 dsh 永不启动）。
 */
export function waitForConfigMigration(timeoutMs = 30_000): Promise<void> {
    if (!configMigrationPlan()) return Promise.resolve()
    return new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            // 正在迁移：不要抢先放行，交给 finish() 统一 settle，避免读到半成品目录
            if (migrationRunning) return
            if (configMigrationPlan()) void runConfigMigration()
            else settleMigrationWaiters()
        }, timeoutMs)
        migrationWaiters.push(() => {
            clearTimeout(timer)
            resolve()
        })
    })
}

/** 应用自身设置文件：`<configDir>/settings.json`。 */
const settingsFile = (): string => path.join(configDir(), 'settings.json')

/**
 * 读取 `<root>/.active` 指向的版本目录；无指针 / 目录不存在 / 缺少关键文件时返回 null。
 * 关键文件校验与 dsh/installs.ts 的 isVersionComplete 保持一致：残缺目录不能当成安装。
 */
function activeSubdir(root: string, keyRel: string): string | null {
    const candidates: string[] = []
    try {
        const v = fs.readFileSync(path.join(root, '.active'), 'utf8').trim()
        if (v) candidates.push(v)
    } catch {
        /* 尚无指针 */
    }
    try {
        for (const n of fs.readdirSync(root)) {
            if (/^v?\d+\.\d+\.\d+/.test(n) && !candidates.includes(n)) candidates.push(n)
        }
    } catch {
        /* 根目录还不存在 */
    }
    for (const v of candidates) {
        const dir = path.join(root, v)
        if (fs.existsSync(path.join(dir, keyRel))) return dir
    }
    return null
}

/** 当前生效的 dsh 版本目录（npm `--prefix`）：`<configDir>/dsh/<版本>`（旧名 kernel，见 installs.ts 的迁移）。 */
export function localDshDir(): string {
    const root = path.join(configDir(), 'dsh')
    return activeSubdir(root, path.join('node_modules', '@deepseek-ai', 'dsh', 'package.json')) ?? root
}

/** 当前生效的内置 npm 目录：`<configDir>/npm/<版本>`。 */
export function bundledNpmDir(): string {
    const root = path.join(configDir(), 'npm')
    return activeSubdir(root, path.join('package', 'bin', 'npm-cli.js')) ?? root
}

/** 当前生效的内置 pnpm 目录：`<configDir>/pnpm/<版本>`。 */
export function bundledPnpmDir(): string {
    const root = path.join(configDir(), 'pnpm')
    // 用包清单定位：入口文件名随 pnpm 大版本变过（bin/pnpm.cjs → bin/pnpm.mjs），
    // 而 package.json 任何版本都有（见 dsh/pnpmEntry.ts）。
    return activeSubdir(root, PNPM_MANIFEST_REL) ?? root
}

/** pnpm 的独立 store 目录：`<工作目录>/temp/pnpm-store`（不污染 ~/.pnpm-store）。 */
export function tempPnpmStoreDir(): string {
    const ws = loadSettings().workspace ?? defaultWorkspaceDir()
    return path.join(ws, 'temp', 'pnpm-store')
}

/** 默认工作目录：`<configDir>/workspace`。 */
export function defaultWorkspaceDir(): string {
    return path.join(configDir(), 'workspace')
}

/** 下载临时目录：`<工作目录>/temp/download`（所有 dsh 下载共用）。 */
export function tempDownloadDir(): string {
    const ws = loadSettings().workspace ?? defaultWorkspaceDir()
    return path.join(ws, 'temp', 'download')
}

/** npm 缓存目录：`<工作目录>/temp/npm`（所有 npm 调用统一指向这里，不污染 ~/.npm）。 */
export function tempNpmDir(): string {
    const ws = loadSettings().workspace ?? defaultWorkspaceDir()
    return path.join(ws, 'temp', 'npm')
}

export function readDiskSettings(): Partial<Settings> {
    try {
        return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Partial<Settings>
    } catch {
        return {}
    }
}

const KNOWN_FLAGS = new Set(['--port', '--host', '--workspace', '--timeout-ms', '--dsh-bin'])
function fromArgv(name: string): string | undefined {
    for (let i = 0; i < process.argv.length - 1; i++) {
        const value: string | undefined = process.argv[i + 1]
        if (process.argv[i] === name && value !== undefined && !KNOWN_FLAGS.has(value)) return value
    }
    return undefined
}

function resolvePortSetting(raw: unknown): number | null {
    if (raw === undefined || raw === null) return null
    const text = String(raw).trim()
    // Treat empty or the literal "null"/"undefined" (e.g. written by older
    // settings.json when port was cleared) as "not configured".
    if (text === '' || /^(null|undefined)$/i.test(text)) return null
    if (!/^\d+$/.test(text)) {
        dialog.showErrorBox('DeepSeek Box', `Invalid --port value: ${JSON.stringify(text)} (must be a non-negative integer)`)
        return null
    }
    return Number(text)
}

/** 归一化 npm 来源：旧版 'auto' 视为 'system'。 */
export function normalizeNpmSource(v: unknown): Settings['npmSource'] {
    if (v === 'bundled' || v === 'localnode') return v
    return 'system'
}

/** 归一化 pnpm 来源：只认 'system'，其余（脏值 / 缺失 / 老配置）落到默认的 'bundled'。 */
export function normalizePnpmSource(v: unknown): Settings['pnpmSource'] {
    return v === 'system' ? 'system' : 'bundled'
}

/**
 * 归一化 Node 运行时：只认 'system'，其余（含旧版的 'electron'、脏值、缺失）
 * 一律落到默认的 'local'。
 *
 * 旧版允许 'electron'（用 Electron 自带 Node 冒充）。该能力已整体移除，
 * 因此这里对它**无条件**迁移到 'local' —— 这不是「改默认值」，而是删掉一个枚举值，
 * 保留旧值会让类型与运行期都不成立。'system' 是用户显式选的，原样保留。
 */
export function normalizeNodeRuntime(v: unknown): Settings['nodeRuntime'] {
    return v === 'system' ? 'system' : 'local'
}

/** 旧版默认并发数。存量配置里几乎人人都是这个值（自动保存会把默认值一起写盘）。 */
const LEGACY_DEFAULT_DOWNLOAD_THREADS = 4

/**
 * 归一化下载并发数：'auto'（自动）或 1–16 的整数，其余一律回默认（'auto'）。
 *
 * `legacy` 为真（老配置）且值恰好是旧默认 4 时升级为 'auto' —— 否则「默认自动」只对新装生效。
 * 之所以必须带 `legacy`：跑过新版之后再手动填 4 是**明确的选择**，不能被反复改回自动。
 * 数值上限与 downloader.ts 的 MAX_DOWNLOAD_THREADS 一致，避免设置里存下用不到的大值。
 */
export function normalizeDownloadThreads(v: unknown, legacy: boolean): Settings['downloadThreads'] {
    if (v === 'auto' || v === undefined || v === null) return DEFAULT_SETTINGS.downloadThreads
    const n = Math.floor(Number(v))
    if (!Number.isFinite(n) || n < 1) return DEFAULT_SETTINGS.downloadThreads
    if (legacy && n === LEGACY_DEFAULT_DOWNLOAD_THREADS) return DEFAULT_SETTINGS.downloadThreads
    return Math.min(16, n)
}

/** 旧版的默认代理范围；数组与之完全一致说明用户从未自定义过。 */
const LEGACY_DEFAULT_PROXY_SCOPES: readonly ProxyScope[] = ['npm', 'node', 'update']

/**
 * 归一化代理范围：过滤未知项、按固定顺序还原，并把第 1 版的旧格式升级成新格式。
 *
 * 旧格式没有 'app' / 'dsh' / 'registry' 三个键，且其中的 'update' 还**兼任**「注册表版本查询」
 * 的开关（见代理改造前的 http.ts：registry = npm ∪ update）。因此升级规则是：
 *  - 用户自定义过的旧配置：**只做等价拆分**（'update' 额外补出 'registry'），
 *    'app' / 'dsh' 是新增能力，保持关闭由用户自行勾选 —— 不悄悄改变既有用户的网络行为；
 *  - 恰好等于旧默认值的（从未动过）：直接给新默认（六项全开），否则新装与老装的默认行为会不一致。
 *
 * `legacy` 为假时只做过滤与排序：跑过新版之后用户手挑的子集**必须原样保留**
 *（否则「只留 update」这种选择会在每次重启后被悄悄扩展回六项）。
 */
export function normalizeProxyScope(v: unknown, legacy: boolean): ProxyScope[] {
    if (!Array.isArray(v)) return [...DEFAULT_SETTINGS.proxyScope]
    const items = v.filter((x): x is ProxyScope => PROXY_SCOPE_IDS.includes(x as ProxyScope))
    if (!legacy) return PROXY_SCOPE_IDS.filter((s) => items.includes(s))
    if (LEGACY_DEFAULT_PROXY_SCOPES.every((s) => items.includes(s)) && items.length === LEGACY_DEFAULT_PROXY_SCOPES.length) {
        return [...DEFAULT_SETTINGS.proxyScope]
    }
    const upgraded = new Set<ProxyScope>(items)
    if (upgraded.has('update')) upgraded.add('registry')
    return PROXY_SCOPE_IDS.filter((s) => upgraded.has(s))
}

/**
 * 磁盘上读到的设置：与 `Settings` 同键，但**显式排除 null**。
 *
 * defu 的类型层对「默认值本身可空」的字段会退化成 `T | void`，于是 `workspace` 这类
 * `string | null` 字段拿到的是 `string | void | null`，直接赋值会报错。
 * 这里先把「磁盘值不可能为 null」表达出来（withoutNulls 保证），
 * 让 defu 推导出可用类型，剩余的 undefined 由调用处 `?? null` 收口。
 */
type DiskSettings = { [K in keyof Settings]?: Exclude<Settings[K], null> }

/**
 * 去掉取值为 null 的键。
 *
 * defu 只在值为 `undefined` 时用默认值覆盖，null 会被当成「用户明确设置成 null」保留下来；
 * 而历史版本确实往 settings.json 里写过 null（例如清空过的端口），必须显式剔除后再合并。
 */
function withoutNulls(obj: Partial<Settings>): DiskSettings {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
        if (v !== null) out[k] = v
    }
    return out as DiskSettings
}

export function loadSettings(): Settings {
    const disk = readDiskSettings()
    // 设置结构版本：缺失即第 1 版。只有真正的老配置才做改键名 / 改默认值的迁移，
    // 这样用户在新版里手填的值不会被每次启动反复改写（见 normalizeProxyScope 等）。
    const legacy = Number(disk.settingsVersion ?? 0) < SETTINGS_VERSION
    const diskPort = disk.port
    const rawPort =
        fromArgv('--port') ??
        process.env.DSH_DESKTOP_PORT ??
        (diskPort === undefined || diskPort === null ? undefined : String(diskPort))

    // 默认值填充交给 defu：逐字段手写 `disk.x ?? DEFAULT.x` 有 36 项，
    // 漏掉一项的后果是「设置页改了、重启又变回去」这种很难复现的漂移。
    // 注意 defu 只认 `undefined`（null 会被当作已设置的值原样保留），
    // 而磁盘上确实可能存着 null（旧版清空过的字段），故显式用 ?? 剔除 null。
    const merged = defu<DiskSettings, [Settings]>(withoutNulls(disk), DEFAULT_SETTINGS)
    return {
        ...merged,
        // 以下字段的取值优先级高于磁盘：命令行 / 环境变量 / 归一化
        settingsVersion: SETTINGS_VERSION,
        host: fromArgv('--host') ?? process.env.DSH_DESKTOP_HOST ?? merged.host,
        port: resolvePortSetting(rawPort),
        workspace: fromArgv('--workspace') ?? process.env.DSH_DESKTOP_WORKSPACE ?? merged.workspace ?? null,
        dshBin: fromArgv('--dsh-bin') ?? process.env.DSH_BIN ?? merged.dshBin ?? null,
        timeoutMs: Number(fromArgv('--timeout-ms') ?? process.env.DSH_DESKTOP_TIMEOUT_MS ?? merged.timeoutMs),
        // defu 对可空字段的推导会带上 void，这里按 Settings 的可空语义统一收回
        proxyPort: merged.proxyPort ?? null,
        // kernelSource 是 dshSource 的旧键名，只在迁移时读一次
        dshSource: merged.dshSource ?? (disk as { kernelSource?: Settings['dshSource'] }).kernelSource,
        downloadThreads: normalizeDownloadThreads(disk.downloadThreads, legacy),
        nodeRuntime: normalizeNodeRuntime(merged.nodeRuntime),
        npmSource: normalizeNpmSource(merged.npmSource),
        pnpmSource: normalizePnpmSource(merged.pnpmSource),
        proxyScope: normalizeProxyScope(disk.proxyScope, legacy),
        shortcuts: Array.isArray(merged.shortcuts) ? merged.shortcuts : DEFAULT_SETTINGS.shortcuts,
        colorScheme: COLOR_SCHEME_IDS.includes(merged.colorScheme as ColorSchemeId)
            ? merged.colorScheme
            : DEFAULT_SETTINGS.colorScheme
    }
}

// ---------------------------------------------------------------------------
// dsh 的界面偏好（语言 / 主题）——写在 profile 的 `cordis.patch.yml` 里
// ---------------------------------------------------------------------------
//
// 0.1.7 起 dsh 不再有 `settings.yaml`：插件配置全部落在 Cordis patch 层，用户可见的
// 偏好就是 patch 条目里的 `config`（条目 id 即插件名）：
//
//   - id: locale      config: { preference: zh }    ← 界面语言
//   - id: ui-theme    config: { preference: dark }   ← 主题（同条目还有 fontSize）
//
// 为什么写 **profile 层**（`profiles/<name>/cordis.patch.yml`）而不是 home 层：
// home 层优先级更高，dsh 自己的设置表单一旦发现要写的值被 home 层覆盖就会**拒绝写入**
// （dsh 会抛 "overridden by a home patch or command-line overlay"）。dsh UI 里的切换
// 也写 profile 层，两边必须落在同一个文件里才能互相看见。
//
// 界面语言的单一存储来源仍是 dsh 的这一条配置：外壳读写它，未设置时按系统语言回退。

/** 界面语言所在的 patch 条目（id / name 与 dsh 的 bundle 层一致）。 */
const LOCALE_ENTRY = { id: 'locale', name: '@deepseek-ai/dsh-client-locale' }
/** 主题所在的 patch 条目。 */
const THEME_ENTRY = { id: 'ui-theme', name: '@deepseek-ai/dsh-client-ui-theme' }

const LOCALE_CODES = new Set(['zh', 'en'])
const UI_THEME_VALUES = new Set(['system', 'light', 'dark'])

/** 本应用承载的 profile 的用户 patch 层（dsh UI 也写这里）。 */
function dshPatchFile(): string {
    return profilePatchFile()
}

/** 读一个 patch 文件的文本；不存在 / 不可读按空层处理。 */
function readPatchLayer(file: string): string {
    try {
        return fs.readFileSync(file, 'utf8')
    } catch {
        return ''
    }
}

/**
 * 按 dsh 的层叠顺序（低 → 高）取出用户自己的 patch 层：profile 层 → home 层。
 * 读的是**有效值**，所以 home 层里更靠前的覆盖也会被算进来。
 */
function dshUserPatchLayers(): string[] {
    return [readPatchLayer(dshPatchFile()), readPatchLayer(homePatchFile())]
}

/** 读 dsh 某个偏好条目的字符串字段；未配置返回 null。 */
function readDshPreference(entryId: string, field: string): string | null {
    return readConfigString(composePatchConfig(dshUserPatchLayers()), entryId, field)
}

/** 写盘抑制窗口（毫秒）：自己写的 patch 不该触发自己的 watcher。
 *  语言与主题同写一个文件，因此共用一个时间戳。 */
let lastSelfPatchWrite = 0

/**
 * 把某个偏好字段写进 profile patch 的对应条目（保留其它条目、注释与同行其它字段）。
 * @returns 是否真的写入了（内容没变时不写，避免无谓地触发 dsh 的文件监听）。
 * 失败不抛：偏好同步是尽力而为，坏了不该把启动流程带崩。
 */
function writeDshPreference(entry: { id: string; name: string }, field: string, value: string): boolean {
    try {
        const file = dshPatchFile()
        const cur = readPatchLayer(file)
        const next = mergePatchEntryConfig(cur, entry.id, { [field]: value }, entry.name)
        if (next === cur) return false
        fs.mkdirSync(path.dirname(file), { recursive: true })
        writeFileAtomic.sync(file, next, 'utf8')
        lastSelfPatchWrite = Date.now()
        return true
    } catch (err) {
        console.error(`[Manager] failed to write ${entry.id}.${field} to dsh profile patch:`, err)
        return false
    }
}

/** 读取当前 dsh 语言偏好码；未配置 / 非法返回 null。 */
export function dshLocale(): LocaleCode | null {
    const s = readDshPreference(LOCALE_ENTRY.id, 'preference')
    return s && LOCALE_CODES.has(s) ? (s as LocaleCode) : null
}

/** 把语言码写入 dsh 的 locale 条目。 */
export function writeDshLocale(code: LocaleCode): void {
    writeDshPreference(LOCALE_ENTRY, 'preference', code)
}

/**
 * 解析当前界面语言（main 侧）：来源是 dsh 的 locale 配置；
 * 未设置时按 app.getLocale()（系统）回退。
 */
export function uiLocale(): ResolvedLocale {
    return resolveLocale(dshLocale(), app.getLocale())
}

/** main 进程的翻译入口：读当前语言目录 `path` 并替换 `{x}` 占位。 */
export function mt(path: string, params?: Record<string, unknown>): string {
    return tl(uiLocale(), path, params)
}

// ---------------------------------------------------------------------------
// 把外壳主题同步进 dsh（ui-theme 条目的 preference）
// ---------------------------------------------------------------------------

/** 上一次同步出去的主题，避免重复写盘。 */
let lastSyncedTheme = ''

/** 读 dsh 的主题偏好；未配置 / 非法返回 null。 */
function dshThemePref(): string | null {
    const s = readDshPreference(THEME_ENTRY.id, 'preference')
    return s && UI_THEME_VALUES.has(s) ? s : null
}

/** 把外壳主题写进 dsh，让 dsh UI 跟随。 */
export function syncDshTheme(theme: string): void {
    if (!UI_THEME_VALUES.has(theme) || theme === lastSyncedTheme) return
    if (writeDshPreference(THEME_ENTRY, 'preference', theme)) lastSyncedTheme = theme
}

/** 把外壳主题同步到 Electron 的 nativeTheme.themeSource，使所有内嵌 webview 的
 * `prefers-color-scheme` 跟随外壳深浅色（支持深色的站点自动适配）。 */
export function syncNativeTheme(theme: string): void {
    if (theme === 'dark' || theme === 'light' || theme === 'system') nativeTheme.themeSource = theme
}

/** Timestamp of the last settings.json write performed by this process. */
let lastSelfSettingsWrite = 0

export function persistSettings(s: Settings): void {
    try {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
        // 原子写：settings.json 是被外部编辑器 / 本应用同时读写的文件，
        // 直接覆盖可能让另一个进程读到半截 JSON（表现为「设置莫名其妙被重置」）。
        writeFileAtomic.sync(settingsFile(), JSON.stringify(s, null, 2), 'utf8')
        lastSelfSettingsWrite = Date.now()
    } catch {
    /* non-fatal */
    }
}

// ---------------------------------------------------------------------------
// External-config watchers
// ---------------------------------------------------------------------------
// When settings.json / dsh's profile patch are changed on disk by someone other
// than this app, tell the renderer to re-sync automatically. Echoes caused by
// our own writes are suppressed via the lastSelf* timestamps.
// ---------------------------------------------------------------------------

const configWatchers: fs.FSWatcher[] = []

/** Watch one file in a directory and call onChange (debounced) on changes. */
function watchConfigFile(name: string, dir: string, onChange: () => void): void {
    try {
        fs.mkdirSync(dir, { recursive: true })
    } catch {
    /* directory may be uncreatable; the watcher will still try below */
    }
    let timer: NodeJS.Timeout | null = null
    const schedule = (): void => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            timer = null
            onChange()
        }, 200)
    }
    try {
        const w = fs.watch(dir, (_event, filename) => {
            if (filename && filename.toString() === name) schedule()
        })
        w.on('error', () => {
            /* ignore transient watch errors */
        })
        configWatchers.push(w)
    } catch (err) {
        console.error(`[Manager] failed to watch ${name} in ${dir}:`, err)
    }
}

export function startConfigWatchers(): void {
    // App settings: on external edit, push the authoritative settings for the
    // renderer to re-fill its form.
    watchConfigFile('settings.json', configDir(), () => {
        if (Date.now() - lastSelfSettingsWrite < 400) return
        broadcast('settings:changed', loadSettings())
    })
    // dsh 的 patch 层：主题 / 语言被 shell 之外的改动（例如在 dsh UI 里切换主题或语言）
    // 时广播，让外壳采用。dsh 只写 profile 层，但 home 层优先级更高、同样会影响有效值，
    // 所以两层都监听。
    const onPatchChange = (): void => {
        if (Date.now() - lastSelfPatchWrite < 400) return
        const theme = dshThemePref()
        if (theme) {
            syncNativeTheme(theme) // webview 深浅色随外壳
            broadcast('settings:theme', theme)
        }
        const localePref = dshLocale()
        if (localePref) broadcast('settings:locale', localePref)
    }
    watchConfigFile(PATCH_FILENAME, path.dirname(dshPatchFile()), onPatchChange)
    watchConfigFile(PATCH_FILENAME, dshHomeDir(), onPatchChange)
}

export function stopConfigWatchers(): void {
    for (const w of configWatchers) {
        try {
            w.close()
        } catch {
            /* ignore */
        }
    }
    configWatchers.length = 0
}

/** 配置目录变更后重建外部变更 watcher。 */
export function rewatchConfig(): void {
    stopConfigWatchers()
    startConfigWatchers()
}
