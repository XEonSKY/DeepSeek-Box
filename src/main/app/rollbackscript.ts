/**
 * 回退脚本的纯文本构造（不 import Electron，便于单测）。
 *
 * 老实现把脚本内联在 appslots.ts 里，踩了三个坑，这里逐条规避：
 *
 *  1. **不能靠 `tasklist | findstr` 的 errorlevel 判存活**：该管道在 tasklist 起不来时
 *     （句柄 / 内存紧张）仍返回 0，`if not errorlevel 1` 恒真 → 脚本永久空转。
 *     改用 `for /f` 读 `tasklist /FO CSV` 的首列做**内容比较**，取不到内容即视为已退出。
 *  2. **`timeout /t` 在无控制台下不休眠**：应用用 `stdio: 'ignore'` 起脚本，stdin 是 NUL，
 *     `timeout` 会立刻报 "Input redirection is not supported" 返回，等待循环于是变成
 *     **无延迟空转**，每秒拉起成百上千个 tasklist / findstr，直到把整机拖垮。
 *     改用 `ping -n 2 127.0.0.1`（无控制台也能睡满 1 秒）。
 *  3. **必须检查 tar 的退出码**：失败还无条件 `start` 重启，会让「回退 → 启动 → 再回退」
 *     无限循环（安装目录没有写权限时必然如此）。现在只有解包成功才重启；失败把结果写进
 *     `resultFile`，应用下次启动读到 `fail` 即停止重试并如实报错。
 *
 * 另外：等待与应用退出、以及解包重试都有**次数上限**，脚本名由调用方带时间戳，
 * 避免旧实例还在按字节偏移读取时被新脚本覆盖。
 */

/** 构造脚本所需参数。 */
export interface RollbackScriptOptions {
    /** tar 可执行文件（Windows 上通常是 `%SystemRoot%\System32\tar.exe`）。 */
    tar: string
    /** 归档文件全路径。 */
    archive: string
    /** 解包目标父目录：归档内是安装目录本身，故解到它的父目录。 */
    parent: string
    /** 解包成功后要执行的命令（Windows 是可执行文件路径；POSIX 可带 `&` 后台符）。 */
    relaunch: string
    /** 结果文件：脚本写入 `ok` / `fail`，供应用下次启动判断。 */
    resultFile: string
    /** tar 的 stderr 落盘位置（每次覆盖，只留最后一次的报错）。 */
    logFile: string
    /** 本进程 PID：脚本先等它退出再动手，避免边跑边覆盖自己被占用的文件。 */
    pid: number
    /** Windows 判断存活用的镜像名（`path.basename(process.execPath)`）。 */
    image?: string
    /** 最多等应用退出多少秒（超时就试解包，失败由重试上限兜底）。 */
    maxWaitSeconds?: number
    /** 解包最多重试几次。 */
    maxTries?: number
}

/** 等待应用退出的默认上限（秒）。 */
export const ROLLBACK_MAX_WAIT_SECONDS = 60
/** 解包重试的默认上限（次）。 */
export const ROLLBACK_MAX_TRIES = 40

/** cmd 双引号内的转义：`"` → `""`，`%` → `%%`（落盘后由 cmd 解读）。 */
function quoteWin(value: string): string {
    return `"${value.replace(/"/g, '""').replace(/%/g, '%%')}"`
}

/** sh 双引号内的转义。 */
function quoteSh(value: string): string {
    return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

function winDefaults(o: RollbackScriptOptions): { wait: number; tries: number; image: string } {
    return {
        wait: o.maxWaitSeconds ?? ROLLBACK_MAX_WAIT_SECONDS,
        tries: o.maxTries ?? ROLLBACK_MAX_TRIES,
        image: o.image ?? ''
    }
}

/**
 * Windows 回退脚本（CRLF 落盘）。
 *
 * 流程：等 PID 退出（有上限）→ 解包（有上限，成功才继续）→ 写 `ok` → 重启 → 自删；
 * 超限写 `fail` 且**不重启**，把「回退失败」留给应用下次启动处理。
 */
export function buildWindowsRollbackScript(o: RollbackScriptOptions): string {
    const { wait, tries, image } = winDefaults(o)
    const lines = [
        '@echo off',
        'setlocal',
        'rem 由 DeepSeek Box 生成：应用退出后解包覆盖安装目录并重启；失败则不重启，结果写进 resultFile。',
        'set "WAITED=0"',
        'set "TRIES=0"',
        '',
        ':wait',
        'rem 用内容比较而不是 errorlevel：tasklist 起不来时也不会误判成「仍存活」。',
        'set "ALIVE="',
        `for /f "tokens=1 delims=," %%a in ('tasklist /FI "PID eq ${o.pid}" /NH /FO CSV 2^>nul') do set "ALIVE=%%~a"`,
        `if /i not "%ALIVE%"==${quoteWin(image)} goto extract`,
        'set /a WAITED+=1',
        `if %WAITED% GEQ ${wait} goto extract`,
        'rem 无控制台下 timeout 不会休眠，必须用 ping 睡。',
        'ping -n 2 127.0.0.1 >nul',
        'goto wait',
        '',
        ':extract',
        'set /a TRIES+=1',
        `${quoteWin(o.tar)} -xzf ${quoteWin(o.archive)} -C ${quoteWin(o.parent)} 2>${quoteWin(o.logFile)}`,
        'if not errorlevel 1 goto ok',
        `if %TRIES% GEQ ${tries} goto fail`,
        'ping -n 2 127.0.0.1 >nul',
        'goto extract',
        '',
        ':ok',
        `>${quoteWin(o.resultFile)} echo ok`,
        `start "" ${quoteWin(o.relaunch)}`,
        'del "%~f0" >nul 2>nul',
        'exit /b 0',
        '',
        ':fail',
        `>${quoteWin(o.resultFile)} echo fail`,
        'del "%~f0" >nul 2>nul',
        'exit /b 1'
    ]
    return lines.join('\r\n') + '\r\n'
}

/**
 * POSIX 回退脚本（LF 落盘）。
 *
 * `kill -0` 判存活本身是可靠的，这里同样只加**上限**、检查解包退出码、
 * 成功才重启，失败把 `fail` 写进结果文件后退出。
 */
export function buildPosixRollbackScript(o: RollbackScriptOptions): string {
    const { wait, tries } = winDefaults(o)
    const lines = [
        '#!/bin/sh',
        '# 由 DeepSeek Box 生成：等应用退出后解包覆盖安装目录并重启；失败则不重启。',
        'tries=0',
        'waited=0',
        `while kill -0 ${o.pid} 2>/dev/null; do`,
        '    waited=$((waited + 1))',
        `    [ "$waited" -ge ${wait} ] && break`,
        '    sleep 1',
        'done',
        'while :; do',
        '    tries=$((tries + 1))',
        `    if ${quoteSh(o.tar)} -xzf ${quoteSh(o.archive)} -C ${quoteSh(o.parent)} 2>${quoteSh(o.logFile)}; then`,
        `        echo ok > ${quoteSh(o.resultFile)}`,
        `        ${o.relaunch}`,
        '        rm -f "$0"',
        '        exit 0',
        '    fi',
        `    [ "$tries" -ge ${tries} ] && break`,
        '    sleep 1',
        'done',
        `echo fail > ${quoteSh(o.resultFile)}`,
        'rm -f "$0"',
        'exit 1'
    ]
    return lines.join('\n') + '\n'
}
