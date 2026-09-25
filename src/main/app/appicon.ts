import { app, nativeImage, nativeTheme } from 'electron'
import type { NativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { AppIconInfo, AppIconState, Settings } from '@shared/types'
import { configDir, loadSettings, persistSettings } from './settings'
import { broadcast, getTray } from '../kernel/runtime'
import { listWindows } from './windowreg'

/**
 * 程序图标（「设置 → 外观」的「程序图标」）。
 *
 * 图标有三类来源，统一用 `<来源>/<文件名>` 的 id 表示：
 *   - 内置 Logo：id 为空串，沿用 `resources/icon.png`（深色下为 `icon-dark.png`）；
 *   - 预制图标：'diy/<文件>'，位于随应用打包的 `resources/diy`（只读，用户预先裁成 1024×1024）；
 *   - 用户上传：'user/<文件>'，位于配置目录下的 `icons`（可写）。
 *
 * 上传的图片一律**中心裁剪成正方形并缩放到 1024×1024 的 PNG** 落盘，这样窗口/托盘在任意
 * DPI 下都只拿一张够大的方图，渲染层也只需要一个 data URL 预览。
 */

/** 预制图标目录（随应用打包，只读）。 */
function diyDir(): string {
    return path.join(app.getAppPath(), 'resources', 'diy')
}

/** 用户上传图标目录（随配置目录，可写）。 */
function userDir(): string {
    return path.join(configDir(), 'icons')
}

/** 归一化后的图标边长：与 resources/diy 的预制图标保持一致。 */
const ICON_SIZE = 1024
/** 选择器里的预览边长（再大只是白占内存）。 */
const PREVIEW_SIZE = 192
/** 上传大小上限：1024×1024 的 PNG 通常远小于它，超过基本是误选了大图。 */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024

/** 允许的图片扩展名（实际能否解码以 nativeImage 的判定为准）。 */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'])

/** 路径分隔符与 Windows 文件名非法字符。 */
const ILLEGAL_NAME_CHARS = /[<>:"|?*\\/]/

/** 是否含非法字符（含控制字符）。控制字符单独判断，避免正则里的 \x00-\x1f 触发 no-control-regex。 */
function hasIllegalChars(name: string): boolean {
    if (ILLEGAL_NAME_CHARS.test(name)) return true
    for (const ch of name) {
        if (ch.charCodeAt(0) < 0x20) return true
    }
    return false
}

/** 文件名是否安全（不含路径分隔符 / Windows 非法字符，且不是 . / ..）。 */
function isSafeName(name: string): boolean {
    if (!name || name === '.' || name === '..') return false
    return !hasIllegalChars(name)
}

/** 去掉扩展名的展示名。 */
function stripExt(name: string): string {
    const i = name.lastIndexOf('.')
    return i > 0 ? name.slice(0, i) : name
}

/** 列表按修改时间倒序（最新上传的排前面），只保留可解码的图片。 */
function listIconFiles(dir: string): string[] {
    let names: string[]
    try {
        names = fs.readdirSync(dir)
    } catch {
        return [] // 目录不存在（如 user 目录尚未创建）
    }
    const files = names.filter((n) => isSafeName(n) && IMAGE_EXT.has(path.extname(n).toLowerCase()))
    return files
        .map((n) => {
            let mtime = 0
            try {
                mtime = fs.statSync(path.join(dir, n)).mtimeMs
            } catch {
                /* 读不到就按 0 排最后 */
            }
            return { n, mtime }
        })
        .sort((a, b) => b.mtime - a.mtime)
        .map((x) => x.n)
}

/** 内置 Logo 路径：深色模式优先 `resources/icon-dark.png`，否则 `resources/icon.png`。
 * 与 ui.ts 原来的实现一致（nativeTheme.themeSource 已由外壳主题驱动，故 system 也会跟随）。 */
export function defaultIconPath(): string {
    const dir = path.join(app.getAppPath(), 'resources')
    const dark = path.join(dir, 'icon-dark.png')
    if (nativeTheme.shouldUseDarkColors && fs.existsSync(dark)) return dark
    return path.join(dir, 'icon.png')
}

/** 把 'diy/x.png' / 'user/x.png' 解析成磁盘路径；id 为空、非法或文件不存在时返回 null。 */
export function customIconPath(id: string | null | undefined): string | null {
    const m = /^(diy|user)\/(.+)$/.exec((id || '').trim())
    if (!m) return null
    const name = m[2]
    if (!isSafeName(name) || !IMAGE_EXT.has(path.extname(name).toLowerCase())) return null
    const p = path.join(m[1] === 'diy' ? diyDir() : userDir(), name)
    return fs.existsSync(p) ? p : null
}

/** 当前生效的图标文件路径（自定义 / 预制优先，回退内置 Logo）。 */
export function effectiveIconPath(id: string | null | undefined): string {
    return customIconPath(id) ?? defaultIconPath()
}

/** 内置 Logo 图（缺文件时返回空图）。 */
function defaultIconImage(): NativeImage {
    const p = defaultIconPath()
    return fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty()
}

/** 按最长边等比缩到预览尺寸后转 data URL（选择器 / 界面 Logo 用）。 */
function previewDataUrl(img: NativeImage): string {
    if (img.isEmpty()) return ''
    const { width, height } = img.getSize()
    const scale = Math.min(1, PREVIEW_SIZE / Math.max(width || 1, height || 1))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const out = w === width && h === height ? img : img.resize({ width: w, height: h, quality: 'good' })
    return out.toDataURL()
}

/** 中心裁剪成正方形并缩放到 ICON_SIZE（不拉伸变形）。 */
function squareIcon(img: NativeImage): NativeImage {
    const { width, height } = img.getSize()
    let out = img
    if (width !== height) {
        const side = Math.min(width, height)
        out = img.crop({
            x: Math.round((width - side) / 2),
            y: Math.round((height - side) / 2),
            width: side,
            height: side
        })
    }
    if (out.getSize().width !== ICON_SIZE) out = out.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' })
    return out
}

/** 生成不冲突的文件名：`<基础名>.png`，重名依次加 -1 / -2 … */
function uniqueName(dir: string, base: string): string {
    const safeBase = base || 'icon'
    let name = `${safeBase}.png`
    let i = 1
    while (fs.existsSync(path.join(dir, name))) name = `${safeBase}-${i++}.png`
    return name
}

/** 把用户原始文件名收敛成安全的基础名（去掉扩展名与非法字符）。 */
function sanitizeBaseName(original: string): string {
    const base = stripExt(path.basename(original || ''))
    let cleaned = ''
    for (const ch of base) {
        if (ch.charCodeAt(0) >= 0x20 && !ILLEGAL_NAME_CHARS.test(ch)) cleaned += ch
    }
    return cleaned.trim().slice(0, 64)
}

/** 图标列表：内置 Logo + 预制图标 + 用户上传。 */
export function listAppIcons(): AppIconInfo[] {
    const out: AppIconInfo[] = [{ id: '', name: 'default', source: 'default', dataUrl: previewDataUrl(defaultIconImage()) }]
    for (const [source, dir] of [['diy', diyDir()], ['user', userDir()]] as const) {
        for (const name of listIconFiles(dir)) {
            const img = nativeImage.createFromPath(path.join(dir, name))
            if (img.isEmpty()) continue
            out.push({ id: `${source}/${name}`, name: stripExt(name), source, dataUrl: previewDataUrl(img) })
        }
    }
    return out
}

/** 当前生效的图标（id + 预览图）；自定义文件缺失时回落到内置 Logo。 */
export function currentAppIcon(): AppIconState {
    const id = (loadSettings().appIcon || '').trim()
    const p = customIconPath(id)
    const img = p ? nativeImage.createFromPath(p) : defaultIconImage()
    return { id: p ? id : '', dataUrl: previewDataUrl(img) }
}

/**
 * 把当前设置的图标应用到所有壳窗口与托盘，并广播给渲染层（界面 Logo 同步）。
 * 幂等：settings:save / settings:reset 每次落盘都会调它。
 */
export function applyAppIcon(s?: Settings): void {
    const id = ((s ?? loadSettings()).appIcon || '').trim()
    const p = customIconPath(id)
    const img = p ? nativeImage.createFromPath(p) : defaultIconImage()
    if (img.isEmpty()) return
    for (const w of listWindows()) {
        if (!w.isDestroyed()) w.setIcon(img)
    }
    const tray = getTray()
    if (tray && !tray.isDestroyed()) tray.setImage(img.resize({ width: 16, height: 16 }))
    broadcast('appicon:changed', { id: p ? id : '', dataUrl: previewDataUrl(img) })
}

/**
 * 保存一张用户上传的图标：解码 → 中心裁剪为正方形 → 缩放到 1024×1024 → 存为 PNG。
 * 返回新图标的 id；无法解码 / 超限时抛错（由 IPC 侧转成失败结果）。
 */
export function saveUserIcon(originalName: string, data: Uint8Array): string {
    if (!data || data.byteLength === 0) throw new Error('empty')
    if (data.byteLength > MAX_UPLOAD_BYTES) throw new Error('too-large')
    const img = nativeImage.createFromBuffer(Buffer.from(data))
    if (img.isEmpty()) throw new Error('bad-format')
    const png = squareIcon(img).toPNG()
    fs.mkdirSync(userDir(), { recursive: true })
    const name = uniqueName(userDir(), sanitizeBaseName(originalName))
    fs.writeFileSync(path.join(userDir(), name), png)
    return `user/${name}`
}

/** 删除一个用户上传的图标；若当前正选中它，则回退内置 Logo 并落盘 / 广播。 */
export function deleteUserIcon(id: string): void {
    const p = customIconPath(id)
    if (!p || path.dirname(p) !== userDir()) return
    try {
        fs.rmSync(p, { force: true })
    } catch (err) {
        console.error('[Manager] failed to delete icon:', err)
        return
    }
    const cur = loadSettings()
    if ((cur.appIcon || '').trim() !== id) return
    const merged: Settings = { ...cur, appIcon: '' }
    persistSettings(merged)
    applyAppIcon(merged)
    broadcast('settings:changed', merged)
}
