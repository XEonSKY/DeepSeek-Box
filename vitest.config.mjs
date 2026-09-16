import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 单元测试配置（纯 JS）。
 *
 * 为什么是 .mjs 而不是 .ts：这里只有路径别名与几行 test 选项，没有需要类型检查的内容；
 * 纯 JS 可以省掉「加载配置」这一跳（否则 Vite 要先起一次 esbuild 服务把 .ts 转译掉），
 * 少一跳就少一处环境依赖，CI 起步也更快。
 *
 * 目标环境是 **node**：可测单元是纯逻辑 —— shared 的三端共享工具，以及主进程的
 * 版本 / 路径 / 归一化 / 迁移判定，都不需要 DOM。
 */
export default defineConfig({
    resolve: {
        alias: {
            // 与 electron.vite.config.ts 的解析结果保持一致，测试里统一走别名，
            // 这样测试文件搬到 tests/ 之后 import 说明符与原地保持一致。
            '@': resolve('src/renderer/src'),
            '@shared': resolve('src/shared'),
            '@main': resolve('src/main')
        }
    },
    test: {
        environment: 'node',
        // 测试独立于源码目录，全部收在 tests/ 下，按被测模块所在层分目录。
        root: resolve('.'),
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: '.agents/temp/coverage',
            // 覆盖率看的是**源码**，不是测试文件本身。
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts', 'src/preload/**', 'src/renderer/src/env.d.ts']
        }
    }
})
