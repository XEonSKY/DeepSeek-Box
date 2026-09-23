// 安装仓库自带的 Git hooks：把 core.hooksPath 指向 .githooks。
// 失败（例如在非 Git 环境解包源码）不阻塞 npm install。
import { execSync } from 'node:child_process'

try {
    execSync('git config core.hooksPath .githooks', { stdio: 'inherit' })
    // hook 需要可执行位：Windows 上 git 会自行忽略该位，macOS / Linux 缺了会被静默跳过，故这里补一次。
    try {
        execSync('chmod +x .githooks/pre-commit')
        console.log('[hooks] 已确保 .githooks/pre-commit 可执行')
    } catch {
        console.warn('[hooks] 跳过 chmod（Windows 上无需可执行位）')
    }
    console.log('[hooks] core.hooksPath -> .githooks')
} catch {
    console.warn('[hooks] 跳过：当前环境不是 Git 仓库')
}
