/**
 * 扩展状态的落盘：崩溃计数、被用户停用的扩展、安全模式原因。
 *
 * 文件位置 `~/.dsbox/{channel}/extensions-state.json` —— 与外部扩展同源，
 * 因此换配置目录时状态也跟着走，不会与扩展本体脱节。
 *
 * 写入走 `write-file-atomic`（项目已有依赖）：这个文件在崩溃路径上被写，
 * 半写坏的 JSON 会导致下次启动读不出状态 → 又崩一次，形成死循环。
 */

import fs from 'node:fs'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { ExtStateFile } from '@shared/extensions'
import { configDir } from '../../app/settings'

/** 状态文件结构版本。 */
const STATE_VERSION = 1

/** 状态文件路径（与外部扩展同在一个配置目录下）。 */
export function stateFilePath(): string {
    return path.join(configDir(), 'extensions-state.json')
}

/** 空状态。 */
function emptyState(): ExtStateFile {
    return { version: STATE_VERSION, crashes: {}, disabled: [] }
}

/**
 * 读取状态；文件缺失或损坏都返回空状态。
 *
 * **刻意不抛错**：状态文件损坏时最该做的是「当作没有状态继续启动」，
 * 而不是让应用起不来 —— 否则用户只能手动去删文件。
 */
export function loadState(): ExtStateFile {
    try {
        const raw = fs.readFileSync(stateFilePath(), 'utf8')
        const parsed = JSON.parse(raw) as unknown
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState()
        const o = parsed as Record<string, unknown>
        const crashes: Record<string, number> = {}
        if (o.crashes !== null && typeof o.crashes === 'object' && !Array.isArray(o.crashes)) {
            for (const [id, v] of Object.entries(o.crashes as Record<string, unknown>)) {
                if (typeof v === 'number' && Number.isFinite(v) && v > 0) crashes[id] = v
            }
        }
        const disabled = Array.isArray(o.disabled)
            ? o.disabled.filter((v): v is string => typeof v === 'string' && v.length > 0)
            : []
        const state: ExtStateFile = { version: STATE_VERSION, crashes, disabled }
        if (typeof o.safeModeReason === 'string' && o.safeModeReason.length > 0) state.safeModeReason = o.safeModeReason
        return state
    } catch {
        return emptyState()
    }
}

/** 保存状态（原子写）。失败只记日志，不影响运行。 */
export function saveState(state: ExtStateFile): void {
    try {
        const file = stateFilePath()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        writeFileAtomic.sync(file, JSON.stringify(state, undefined, 2) + '\n')
    } catch (err) {
        console.error('[ext] 保存扩展状态失败', err)
    }
}
