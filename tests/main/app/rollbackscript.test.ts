import { describe, expect, it } from 'vitest'
import { buildPosixRollbackScript, buildWindowsRollbackScript, ROLLBACK_MAX_TRIES, ROLLBACK_MAX_WAIT_SECONDS } from '@main/app/rollbackscript'

/**
 * 回退脚本是「无人值守、脱离本进程运行」的兜底路径，出事时整机都会被拖垮
 * （见 rollbackscript.ts 顶部注释），所以这里把每条硬约束都钉成断言。
 */

const win = {
    tar: 'C:\\Windows\\System32\\tar.exe',
    archive: 'C:\\Users\\u\\AppData\\Roaming\\DeepSeek Box\\app-slots\\0.1.6-alpha.4.tar.gz',
    parent: 'C:\\Program Files',
    relaunch: 'C:\\Program Files\\dsbox\\dsbox.exe',
    resultFile: 'C:\\Users\\u\\AppData\\Roaming\\DeepSeek Box\\app-slots\\rollback-0.1.6-alpha.4.result',
    logFile: 'C:\\Users\\u\\AppData\\Roaming\\DeepSeek Box\\app-slots\\rollback.log',
    pid: 14916,
    image: 'dsbox.exe'
}

describe('Windows 回退脚本', () => {
    const script = buildWindowsRollbackScript(win)

    it('不再使用 tasklist | findstr 判存活（errorlevel 语义在 tasklist 起不来时会误判）', () => {
        expect(script).not.toContain('findstr')
        expect(script).toContain('/FO CSV')
        expect(script).toContain('for /f "tokens=1 delims=,"')
    })

    it('不再用 timeout 睡觉（无控制台下 timeout 立刻返回，会变成无延迟空转）', () => {
        expect(script).not.toMatch(/timeout\s+\/t/i)
        expect(script).toContain('ping -n 2 127.0.0.1')
    })

    it('等待应用退出有次数上限，超时就尝试解包', () => {
        expect(script).toContain(`if %WAITED% GEQ ${ROLLBACK_MAX_WAIT_SECONDS} goto extract`)
    })

    it('检查 tar 退出码，且只有解包成功才重启应用', () => {
        expect(script).toContain('if not errorlevel 1 goto ok')
        const okAt = script.indexOf(':ok')
        const started = script.indexOf('start ""')
        expect(started).toBeGreaterThan(okAt)
        // 失败分支里绝不能出现 start，否则就是「回退失败 → 重启旧版 → 再回退」死循环
        const failSection = script.slice(script.indexOf(':fail'))
        expect(failSection).not.toContain('start ')
    })

    it('解包重试有上限，超限写 fail 并退出', () => {
        expect(script).toContain(`if %TRIES% GEQ ${ROLLBACK_MAX_TRIES} goto fail`)
        expect(script).toContain(`:fail`)
        expect(script).toContain('echo fail')
        expect(script).toContain('exit /b 1')
    })

    it('成功时写 ok 并自删脚本', () => {
        expect(script).toContain('echo ok')
        expect(script).toContain('del "%~f0"')
    })

    it('路径带空格会被引号包住，cmd 元字符转义', () => {
        expect(script).toContain(`-C "${win.parent}"`)
        expect(script).toContain(`"${win.tar}"`)
        expect(buildWindowsRollbackScript({ ...win, archive: 'C:\\a%b\\x.tar.gz' })).toContain('"C:\\a%%b\\x.tar.gz"')
    })

    it('用 CRLF 落盘（.cmd 的换行约定）', () => {
        expect(script.endsWith('\r\n')).toBe(true)
        expect(script).not.toMatch(/[^\r]\n/)
    })
})

describe('POSIX 回退脚本', () => {
    const posix = {
        ...win,
        tar: '/usr/bin/tar',
        archive: "/Users/u/Library/Application Support/DeepSeek Box/app-slots/0.1.6-alpha.4.tar.gz",
        parent: '/Applications',
        relaunch: 'open "/Applications/DeepSeek Box.app"',
        resultFile: '/Users/u/Library/Application Support/DeepSeek Box/app-slots/rollback-0.1.6-alpha.4.result',
        logFile: '/Users/u/Library/Application Support/DeepSeek Box/app-slots/rollback.log',
        pid: 4242
    }
    const script = buildPosixRollbackScript(posix)

    it('用 kill -0 等本进程退出，上限到点继续尝试解包', () => {
        expect(script).toContain('while kill -0 4242 2>/dev/null; do')
        expect(script).toContain(`[ "$waited" -ge ${ROLLBACK_MAX_WAIT_SECONDS} ] && break`)
    })

    it('检查解包退出码，只有成功才重启', () => {
        expect(script).toContain(`if "/usr/bin/tar" -xzf`)
        expect(script).toMatch(/; then\n/)
        const failAt = script.indexOf('echo fail')
        expect(script.indexOf(posix.relaunch)).toBeLessThan(failAt)
        expect(script.slice(failAt)).not.toContain('open ')
    })

    it('重试有上限并写 fail，最后自删脚本', () => {
        expect(script).toContain(`[ "$tries" -ge ${ROLLBACK_MAX_TRIES} ] && break`)
        expect(script).toContain('echo ok > ')
        expect(script).toContain('echo fail > ')
        expect(script).toContain('rm -f "$0"')
    })

    it('以 LF 落盘，并对 $ 等字符转义', () => {
        expect(script.endsWith('\n')).toBe(true)
        expect(script).not.toContain('\r\n')
        const escaped = buildPosixRollbackScript({ ...posix, archive: '/tmp/a$b.tar.gz' })
        expect(escaped).toContain('a\\$b.tar.gz')
    })
})
