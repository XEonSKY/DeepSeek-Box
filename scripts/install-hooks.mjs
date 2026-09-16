// 安装仓库自带的 Git hooks：把 core.hooksPath 指向 .githooks。
// 失败（例如在非 Git 环境解包源码）不阻塞 npm install。
import { execSync } from 'node:child_process'

try {
    execSync('git config core.hooksPath .githooks', { stdio: 'inherit' })
    console.log('[hooks] core.hooksPath -> .githooks')
} catch {
    console.warn('[hooks] 跳过：当前环境不是 Git 仓库')
}
