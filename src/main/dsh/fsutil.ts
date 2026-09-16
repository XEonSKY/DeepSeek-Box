import fs from 'node:fs'

/**
 * 主进程 / dsh 链路共用的文件系统小助手。
 *
 * 这些操作此前在 downloader / nodeenv / npmRunner / installs / tools 里各写一份，
 * 语义一致却分散，改一处漏一处。
 */

/**
 * 尽力删除文件或目录：目标不存在、被占用、无权限都静默返回。
 *
 * 删除流程里的清理动作不该把主流程带崩 —— 残留的临时文件下次会被覆盖。
 * `recursive` 对普通文件同样成立，因此文件与目录共用一个入口。
 */
export function removeQuietly(target: string): void {
    try {
        fs.rmSync(target, { recursive: true, force: true })
    } catch {
        /* 尽力而为 */
    }
}

/** 读取 package.json 的 version 字段；文件不存在或格式不对返回 null。 */
export function readPkgVersion(pkgJsonPath: string): string | null {
    try {
        const v = (JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { version?: unknown }).version
        return typeof v === 'string' && v ? v : null
    } catch {
        return null
    }
}
