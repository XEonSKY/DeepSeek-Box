import { app, dialog, nativeTheme } from 'electron'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { parseDocument } from 'yaml'
import { DEFAULT_SETTINGS, COLOR_SCHEME_IDS, PROXY_SCOPE_IDS, SETTINGS_VERSION } from '@shared/types'
import type { ConfigDirInfo, ConfigMigrationPlan, ConfigMigrationProgress, Settings, Theme, ResolvedLocale, LocaleCode, ColorSchemeId, ProxyScope } from '@shared/types'
import { resolveLocale, t as tl } from '@shared/i18n'
import { broadcast } from './runtime'
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
        if (dir) fs.writeFileSync(configPointerFile(), dir, 'utf8')
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

    const scan = scanTree(plan.from)
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
            rollbackMoves(result.journal)
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
        if (process.argv[i] === name && !KNOWN_FLAGS.has(process.argv[i + 1])) return process.argv[i + 1]
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

export function loadSettings(): Settings {
    const disk = readDiskSettings()
    // 设置结构版本：缺失即第 1 版。只有真正的老配置才做改键名 / 改默认值的迁移，
    // 这样用户在新版里手填的值不会被每次启动反复改写（见 normalizeProxyScope 等）。
    const legacy = Number(disk.settingsVersion ?? 0) < SETTINGS_VERSION
    const diskPort = disk.port
    const host = fromArgv('--host') ?? process.env.DSH_DESKTOP_HOST ?? disk.host ?? DEFAULT_SETTINGS.host
    const rawPort =
        fromArgv('--port') ??
    process.env.DSH_DESKTOP_PORT ??
    (diskPort === undefined || diskPort === null ? undefined : String(diskPort))
    const port = resolvePortSetting(rawPort)
    const workspace = fromArgv('--workspace') ?? process.env.DSH_DESKTOP_WORKSPACE ?? disk.workspace ?? defaultWorkspaceDir()
    const dshBin = fromArgv('--dsh-bin') ?? process.env.DSH_BIN ?? disk.dshBin ?? null
    const timeoutMs = Number(fromArgv('--timeout-ms') ?? process.env.DSH_DESKTOP_TIMEOUT_MS ?? disk.timeoutMs ?? DEFAULT_SETTINGS.timeoutMs)
    return {
        settingsVersion: SETTINGS_VERSION,
        host,
        port,
        workspace,
        timeoutMs,
        dshBin,
        closeToTray: disk.closeToTray ?? DEFAULT_SETTINGS.closeToTray,
        theme: disk.theme ?? DEFAULT_SETTINGS.theme,
        autoCheckUpdate: disk.autoCheckUpdate ?? DEFAULT_SETTINGS.autoCheckUpdate,
        checkPrerelease: disk.checkPrerelease ?? DEFAULT_SETTINGS.checkPrerelease,
        npmRegistry: disk.npmRegistry ?? DEFAULT_SETTINGS.npmRegistry,
        appAutoUpdate: disk.appAutoUpdate ?? DEFAULT_SETTINGS.appAutoUpdate,
        appCheckPrerelease: disk.appCheckPrerelease ?? DEFAULT_SETTINGS.appCheckPrerelease,
        downloadThreads: normalizeDownloadThreads(disk.downloadThreads, legacy),
        devMode: disk.devMode ?? DEFAULT_SETTINGS.devMode,
        dshSource: disk.dshSource ?? (disk as { kernelSource?: Settings['dshSource'] }).kernelSource ?? DEFAULT_SETTINGS.dshSource,
        nodeRuntime: disk.nodeRuntime ?? DEFAULT_SETTINGS.nodeRuntime,
        npmSource: normalizeNpmSource(disk.npmSource ?? DEFAULT_SETTINGS.npmSource),
        proxyEnabled: disk.proxyEnabled ?? DEFAULT_SETTINGS.proxyEnabled,
        proxyProtocol: disk.proxyProtocol ?? DEFAULT_SETTINGS.proxyProtocol,
        proxyHost: disk.proxyHost ?? DEFAULT_SETTINGS.proxyHost,
        proxyPort: disk.proxyPort ?? DEFAULT_SETTINGS.proxyPort,
        proxyScope: normalizeProxyScope(disk.proxyScope, legacy),
        zoomPercent: disk.zoomPercent ?? DEFAULT_SETTINGS.zoomPercent,
        ignoreSystemScale: disk.ignoreSystemScale ?? DEFAULT_SETTINGS.ignoreSystemScale,
        funLocale: disk.funLocale ?? DEFAULT_SETTINGS.funLocale,
        searchEngine: disk.searchEngine ?? DEFAULT_SETTINGS.searchEngine,
        newTabMode: disk.newTabMode ?? DEFAULT_SETTINGS.newTabMode,
        newTabUrl: disk.newTabUrl ?? DEFAULT_SETTINGS.newTabUrl,
        shortcuts: Array.isArray(disk.shortcuts) ? disk.shortcuts : DEFAULT_SETTINGS.shortcuts,
        hotkeyFocusWindow: disk.hotkeyFocusWindow ?? DEFAULT_SETTINGS.hotkeyFocusWindow,
        hotkeyToggleTerminal: disk.hotkeyToggleTerminal ?? DEFAULT_SETTINGS.hotkeyToggleTerminal,
        hotkeyDevTools: disk.hotkeyDevTools ?? DEFAULT_SETTINGS.hotkeyDevTools,
        hardwareAcceleration: disk.hardwareAcceleration ?? DEFAULT_SETTINGS.hardwareAcceleration,
        autoLaunch: disk.autoLaunch ?? DEFAULT_SETTINGS.autoLaunch,
        openDshInBrowser: disk.openDshInBrowser ?? DEFAULT_SETTINGS.openDshInBrowser,
        webviewUserAgent: disk.webviewUserAgent ?? DEFAULT_SETTINGS.webviewUserAgent,
        colorScheme: COLOR_SCHEME_IDS.includes(disk.colorScheme as ColorSchemeId)
            ? (disk.colorScheme as ColorSchemeId)
            : DEFAULT_SETTINGS.colorScheme,
        appIcon: disk.appIcon ?? DEFAULT_SETTINGS.appIcon,
        modelsCredConsent: disk.modelsCredConsent ?? DEFAULT_SETTINGS.modelsCredConsent
    }
}

// ---------------------------------------------------------------------------
// dsh `settings.yaml` 的 `locale.preference`（界面语言的单一存储来源）
// ---------------------------------------------------------------------------

const LOCALE_CODES = new Set(['zh', 'en'])

/** 从 dsh settings.yaml 文本读取 locale.preference（zh/en），缺失返回 null。 */
function readDshLocalePref(text: string): LocaleCode | null {
    const doc = parseDocument(text || '')
    const v = doc.getIn(['locale', 'preference'])
    const s = v == null ? '' : String(v)
    return LOCALE_CODES.has(s) ? (s as LocaleCode) : null
}

/** 读取当前 dsh 语言偏好码；文件不存在/不可读返回 null。 */
export function dshLocale(): LocaleCode | null {
    try {
        return readDshLocalePref(fs.readFileSync(dshSettingsFile(), 'utf8'))
    } catch {
        return null
    }
}

/** 当 shell 自身写 locale 时抑制 watcher 回声。 */
let lastSelfLocaleWrite = 0

/** 把语言码写入 dsh settings.yaml 的 locale.preference（保留其它键/注释）。 */
export function writeDshLocale(code: LocaleCode): void {
    try {
        const file = dshSettingsFile()
        let text = ''
        try {
            text = fs.readFileSync(file, 'utf8')
        } catch {
            /* not created yet */
        }
        const doc = parseDocument(text || '')
        doc.setIn(['locale', 'preference'], code)
        const next = doc.toString().replace(/\s+$/, '') + '\n'
        if (next !== text) {
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, next, 'utf8')
        }
        lastSelfLocaleWrite = Date.now()
    } catch (err) {
        console.error('[Manager] failed to write locale to dsh settings.yaml:', err)
    }
}

/**
 * 解析当前界面语言（main 侧）：来源是 dsh settings.yaml 的 locale.preference；
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
// Sync UI theme into dsh's own settings.yaml (ui-theme.preference)
// ---------------------------------------------------------------------------

const UI_THEME_VALUES = new Set(['system', 'light', 'dark'])

function dshSettingsFile(): string {
    return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'settings.yaml')
}

/** 用 `yaml` 库设置顶层 ui-theme.preference，保留其它键/注释，避免手写文本补丁的脆弱性。 */
function patchUiTheme(text: string, pref: string): string {
    const doc = parseDocument(text || '')
    doc.setIn(['ui-theme', 'preference'], pref)
    return doc.toString().replace(/\s+$/, '') + '\n'
}

let lastSyncedTheme = ''
/** When the app itself writes the dsh theme we suppress the watcher echo. */
let lastSelfThemeWrite = 0
/** Timestamp of the last settings.json write performed by this process. */
let lastSelfSettingsWrite = 0

/** Read ui-theme.preference from dsh's settings.yaml (via the yaml library). */
function readUiThemePref(text: string): Theme | null {
    const doc = parseDocument(text || '')
    const v = doc.getIn(['ui-theme', 'preference'])
    const s = v == null ? '' : String(v)
    return UI_THEME_VALUES.has(s) ? (s as Theme) : null
}

/** Write the app theme into dsh's settings.yaml so the dsh UI matches. */
export function syncDshTheme(theme: string): void {
    if (!UI_THEME_VALUES.has(theme) || theme === lastSyncedTheme) return
    try {
        const file = dshSettingsFile()
        let text = ''
        try {
            text = fs.readFileSync(file, 'utf8')
        } catch {
            /* not created yet */
        }
        const next = patchUiTheme(text, theme)
        if (next !== text) {
            fs.mkdirSync(path.dirname(file), { recursive: true })
            fs.writeFileSync(file, next, 'utf8')
        }
        lastSyncedTheme = theme
        lastSelfThemeWrite = Date.now()
    } catch (err) {
        console.error('[Manager] failed to sync theme to dsh settings.yaml:', err)
    }
}

/** 把外壳主题同步到 Electron 的 nativeTheme.themeSource，使所有内嵌 webview 的
 * `prefers-color-scheme` 跟随外壳深浅色（支持深色的站点自动适配）。 */
export function syncNativeTheme(theme: string): void {
    if (theme === 'dark' || theme === 'light' || theme === 'system') nativeTheme.themeSource = theme
}

export function persistSettings(s: Settings): void {
    try {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
        fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8')
        lastSelfSettingsWrite = Date.now()
    } catch {
    /* non-fatal */
    }
}

// ---------------------------------------------------------------------------
// External-config watchers
// ---------------------------------------------------------------------------
// When settings.json / dsh's settings.yaml are changed on disk by someone other
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
    // DSH settings.yaml：当 ui-theme.preference / locale.preference 在 shell 之外被改动
    //（例如在 dsh UI 内切换主题/语言）时广播，让 shell 采用。
    watchConfigFile('settings.yaml', path.dirname(dshSettingsFile()), () => {
        if (Date.now() - lastSelfThemeWrite < 400 || Date.now() - lastSelfLocaleWrite < 400) return
        try {
            const text = fs.readFileSync(dshSettingsFile(), 'utf8')
            const theme = readUiThemePref(text)
            if (theme) {
                syncNativeTheme(theme) // webview 深浅色随外壳
                broadcast('settings:theme', theme)
            }
            const localePref = readDshLocalePref(text)
            if (localePref) broadcast('settings:locale', localePref)
        } catch {
            /* file not (yet) readable */
        }
    })
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
