import { app } from 'electron'
// Electron 里 setLoginItemSettings 的入参类型就叫 Settings（getLoginItemSettings 的返回值才叫
// LoginItemSettings），这里重命名导入以免与应用程序自己的 Settings 混淆。
import type { Settings as LoginItemSettings } from 'electron'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

/**
 * 开机自启（「设置 → 系统与性能」的「启动增强」）。
 *
 * - Windows / macOS：走 Electron 的 `app.setLoginItemSettings`。
 * - Linux：Electron 不支持登录项，改为在 `~/.config/autostart` 写 / 删一个 .desktop 入口。
 *
 * 幂等（开关状态与目标一致时重复写也无害），由启动流程与 `settings:save` 各调一次。
 */

/** Linux autostart 条目的文件名（与安装版共用；托盘/图标名不影响识别）。 */
const LINUX_DESKTOP_NAME = 'deepseek-box.desktop'

function linuxAutostartFile(): string {
    const base = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config')
    return path.join(base, 'autostart', LINUX_DESKTOP_NAME)
}

/** Linux：写 / 删 autostart .desktop。AppImage 优先用 APPIMAGE 环境变量指向的真实镜像。 */
function applyLinuxAutoLaunch(enabled: boolean): void {
    const file = linuxAutostartFile()
    try {
        if (!enabled) {
            fs.rmSync(file, { force: true })
            return
        }
        const exec = process.env['APPIMAGE'] || app.getPath('exe')
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const entry = [
            '[Desktop Entry]',
            'Type=Application',
            'Name=DeepSeek Box',
            `Exec="${exec}"`,
            'Terminal=false',
            'X-GNOME-Autostart-enabled=true',
            ''
        ].join('\n')
        fs.writeFileSync(file, entry, 'utf8')
    } catch (err) {
        console.error('[Manager] failed to write Linux autostart entry:', err)
    }
}

/** 应用开机自启设置。 */
export function applyAutoLaunch(enabled: boolean): void {
    if (process.platform === 'linux') {
        applyLinuxAutoLaunch(enabled)
        return
    }
    try {
        const opts: LoginItemSettings = { openAtLogin: enabled }
        // 开发态下 process.execPath 是 electron.exe，必须补上应用入口参数；打包态用默认即可。
        if (!app.isPackaged) {
            opts.path = process.execPath
            opts.args = [app.getAppPath()]
        }
        app.setLoginItemSettings(opts)
    } catch (err) {
        console.error('[Manager] failed to apply auto-launch:', err)
    }
}
