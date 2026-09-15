import type { BrowserWindow, Tray } from 'electron'
import { IPC_EVENT_CHANNEL } from '@shared/api'
import { listWindows, coreWindowId, windowByContentsId } from './windowreg'

/**
 * Lowest-level cross-cutting runtime state shared by every main-process module.
 *
 * Kept deliberately tiny and cycle-free: feature modules (settings / dsh /
 * dsh server / ui / ipc) import these primitives; nothing imports them back, so
 * there is no import cycle. Electron types are imported as `type` only.
 */
export const IS_WIN = process.platform === 'win32'

// ---------------------------------------------------------------------------
// Shared mutable UI state (owned here so `broadcast` and the window/tray code
// can read / write the same references without a module cycle).
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null
let currentUrl: string | null = null
let tray: Tray | null = null
let quitting = false

export function getMainWindow(): BrowserWindow | null {
    return mainWindow
}

export function setMainWindow(w: BrowserWindow | null): void {
    mainWindow = w
}

export function getCurrentUrl(): string | null {
    return currentUrl
}

export function setCurrentUrl(u: string | null): void {
    currentUrl = u
}

export function getTray(): Tray | null {
    return tray
}

export function setTray(t: Tray | null): void {
    tray = t
}

export function isQuitting(): boolean {
    return quitting
}

export function setQuitting(q: boolean): void {
    quitting = q
}

/** Destroy the tray if present and forget the reference. */
export function destroyTray(): void {
    try {
        tray?.destroy()
    } catch {
    /* already gone */
    }
    tray = null
}

/** Send an event to all alive shell windows' renderers (falls back to the single main window). */
export function broadcast(channel: string, payload?: unknown): void {
    const wins = listWindows()
    const targets = wins.length > 0 ? wins : mainWindow ? [mainWindow] : []
    for (const w of targets) {
        sendToWindow(w, channel, payload)
    }
}

/**
 * Send an event to one specific window's renderer (directed; multi-window safe).
 *
 * 所有主进程 → 渲染层的推送都走唯一通道 `ipc:event`，信封为 `{ event, payload }`；
 * 渲染层用 `window.api.on(event, cb)` 按键名订阅。`event` 即原来各频道的名字。
 */
export function sendToWindow(w: BrowserWindow | null | undefined, event: string, payload?: unknown): void {
    if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) {
        w.webContents.send(IPC_EVENT_CHANNEL, { event, payload })
    }
}

/** Send an event to a window looked up by webContents id (no-op if that window is gone). */
export function sendToWcId(wcId: number | null | undefined, channel: string, payload?: unknown): void {
    if (wcId == null) return
    sendToWindow(windowByContentsId(wcId), channel, payload)
}

/** 只发给“当前核心窗口”（dsh UI 唯一宿主）。无核心则不发送。 */
export function sendCore(channel: string, payload?: unknown): void {
    sendToWcId(coreWindowId(), channel, payload)
}
