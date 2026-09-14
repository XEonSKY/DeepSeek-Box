import { h, reactive } from 'vue'
import { ElTag, ElNotification } from 'element-plus'
import type { VNode } from 'vue'
import type { AppUpdateEvent, Settings, UpdateResult } from '@shared/types'
import { isPrerelease } from '@shared/version'
import { tt } from './locales'

const TYPE: Record<UpdateResult['status'], 'success' | 'warning' | 'error'> = {
    ok: 'success',
    update: 'warning',
    missing: 'error',
    error: 'warning'
}

export interface DshCheckState {
    /** A newer version than the installed one has been found. */
    found: boolean
    latest: string | null
    /** Whether the found latest is a pre-release (rc / beta / …). */
    prerelease: boolean
    /** 最近一次检查返回的当前版本（「已是最新」的界面回显用）。 */
    current: string | null
    /** 是否已经检查过至少一次 —— 决定要不要显示「已是最新」那一行。 */
    checked: boolean
}

/** Latest dsh check result, so the DeepSeek Harness page header can show it reactively. */
export const dshCheck = reactive<DshCheckState>({
    found: false,
    latest: null,
    prerelease: false,
    current: null,
    checked: false
})

// ---------------------------------------------------------------------------
// 版本与更新状态：状态栏右下角「程序 + dsh」徽标的唯一真源。
// 原则：**检测到新版本只更新徽标，不弹通知**（VS Code 式静默提示）；
// 只有检查本身失败 / 回退这类异常才走通知。
// ---------------------------------------------------------------------------

export type VersionCheckState = 'idle' | 'checking' | 'latest' | 'available' | 'downloaded' | 'error'

/** 一条版本线的状态：当前版本、已知最新版本、检查结果。 */
export interface VersionLine {
    current: string | null
    latest: string | null
    state: VersionCheckState
    message: string | null
}

export const versionStatus = reactive<{ app: VersionLine; dsh: VersionLine }>({
    app: { current: null, latest: null, state: 'idle', message: null },
    dsh: { current: null, latest: null, state: 'idle', message: null }
})

/** 是否有可用更新（程序可更新 / 已下载，或 dsh 有新版本）——决定状态栏徽标。 */
export function hasUpdate(): boolean {
    return (
        versionStatus.app.state === 'available' ||
        versionStatus.app.state === 'downloaded' ||
        versionStatus.dsh.state === 'available'
    )
}

/** 读取程序 / dsh 的当前版本（只改 current，不动检查结果）。 */
export async function refreshVersions(): Promise<void> {
    try {
        versionStatus.app.current = (await window.api.getAppMeta()).version
    } catch {
        /* 读不到就保留原值 */
    }
    try {
        versionStatus.dsh.current = await window.api.getDshVersion()
    } catch {
        /* 读不到就保留原值 */
    }
}

/**
 * 主进程 app 更新事件 → 状态行。
 * progress / staging / rollback 不改变「是否有更新」的判定，只更新 latest（若带版本）。
 */
export function applyAppUpdateEvent(e: AppUpdateEvent): void {
    const app = versionStatus.app
    if (e.version) app.latest = e.version
    switch (e.kind) {
        case 'checking':
            app.state = 'checking'
            break
        case 'available':
            app.state = 'available'
            app.message = null
            break
        case 'not-available':
            app.state = 'latest'
            app.message = null
            break
        case 'downloaded':
            app.state = 'downloaded'
            app.message = null
            break
        case 'error':
            app.state = 'error'
            app.message = e.message ?? null
            break
        default:
            break
    }
}

/** Build the notification body: current & latest versions shown as el-tag. */
function buildBody(r: UpdateResult): string | VNode {
    const kids: Array<string | VNode> = []

    if (r.current) {
        kids.push(
            h('div', { class: 'update-row' }, [
                h('span', { class: 'update-lbl' }, tt('update.current')),
                h(ElTag, { size: 'small', type: 'info', effect: 'plain' }, () => r.current!)
            ])
        )
    }

    if (r.latest) {
        const isPre = isPrerelease(r.latest)
        const tagType = r.status === 'update' ? (isPre ? 'warning' : 'success') : 'success'
        kids.push(
            h('div', { class: 'update-row' }, [
                h('span', { class: 'update-lbl' }, tt('update.latest')),
                h(ElTag, { size: 'small', effect: 'plain', type: tagType }, () => r.latest!)
            ])
        )
    }

    kids.push(h('div', { class: 'update-note' }, r.message))

    return h('div', { class: 'update-body' }, kids)
}

/**
 * 检查 dsh 更新并写入状态；**静默**：不弹任何提示，结果由状态栏徽标 / dsh 页回显。
 * 返回 UpdateResult（连不上等异常时为 null）。
 */
export async function checkDsh(opts?: {
    prerelease?: boolean
    registry?: 'npmjs' | 'npmmirror'
}): Promise<UpdateResult | null> {
    const dsh = versionStatus.dsh
    try {
        const cfg: Settings = await window.api.getSettings()
        const r = await window.api.checkForUpdates({
            prerelease: opts?.prerelease ?? cfg.checkPrerelease,
            registry: opts?.registry ?? cfg.npmRegistry
        })
        dshCheck.found = r.status === 'update' && !!r.latest
        dshCheck.latest = r.latest
        dshCheck.prerelease = r.latest ? isPrerelease(r.latest) : false
        dshCheck.current = r.current ?? null
        dshCheck.checked = true

        if (r.current) dsh.current = r.current
        dsh.latest = r.latest
        dsh.message = r.message || null
        dsh.state = r.status === 'update' ? 'available' : r.status === 'ok' ? 'latest' : 'error'
        return r
    } catch (err) {
        dshCheck.checked = true
        dsh.state = 'error'
        dsh.message = err instanceof Error ? err.message : String(err)
        return null
    }
}

/** 检查 dsh 更新；新版本走徽标，只有「检查失败」这类异常才提示。 */
export async function checkAndNotify(opts?: {
    prerelease?: boolean
    registry?: 'npmjs' | 'npmmirror'
}): Promise<void> {
    const r = await checkDsh(opts)
    // 发现新版本 / 已是最新：不再打断用户（徽标 + 页面回显足够）。
    if (!r || r.status === 'ok' || r.status === 'update') return

    const titles: Record<UpdateResult['status'], string> = {
        ok: tt('update.okTitle'),
        update: tt('update.updateTitle'),
        missing: tt('update.missingTitle', { pkg: '@deepseek-ai/dsh' }),
        error: tt('update.errorTitle')
    }
    ElNotification({
        title: titles[r.status],
        message: buildBody(r),
        type: TYPE[r.status],
        position: 'top-right',
        // Drop below the custom (frameless) title bar so it never covers it.
        offset: 60,
        duration: 7000
    })
}

/** 状态栏点击「检查更新」：程序 + dsh 一起查，全程静默，结果只进 versionStatus。 */
export async function checkAllUpdates(): Promise<void> {
    let cfg: Settings | null = null
    try {
        cfg = await window.api.getSettings()
    } catch {
        /* 读不到设置就按默认检查 */
    }
    versionStatus.app.state = 'checking'
    versionStatus.dsh.state = 'checking'

    const app = window.api
        .triggerAppUpdate({ prerelease: cfg?.appCheckPrerelease ?? false })
        .then(async (r) => {
            if (!r.ok) {
                versionStatus.app.state = 'error'
                versionStatus.app.message = r.message || null
                return
            }
            // 事件可能早于订阅/晚于本次调用：用主进程记录的最后一次状态补齐。
            const last = await window.api.getAppUpdateState()
            if (last) applyAppUpdateEvent(last)
        })
        .catch((err) => {
            versionStatus.app.state = 'error'
            versionStatus.app.message = err instanceof Error ? err.message : String(err)
        })

    await Promise.all([app, checkDsh({ prerelease: cfg?.checkPrerelease, registry: cfg?.npmRegistry })])
    await refreshVersions()
}
