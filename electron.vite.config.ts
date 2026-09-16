import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { AntdvNextResolver } from '@antdv-next/auto-import-resolver'

export default defineConfig({
    main: {
        // 依赖外置：electron-vite 5 起改用 build.externalizeDeps（默认 true），
        // 旧的 externalizeDepsPlugin() 已弃用。
        build: { externalizeDeps: true },
        resolve: {
            alias: { '@shared': resolve('src/shared') }
        }
    },
    preload: {
        build: { externalizeDeps: true },
        resolve: {
            alias: { '@shared': resolve('src/shared') }
        }
    },
    renderer: {
        resolve: {
            alias: {
                '@': resolve('src/renderer/src'),
                '@shared': resolve('src/shared')
            }
        },
        plugins: [
            vue(),
            // antdv-next 按需引入：模板里的 <a-*> 组件与样式自动导入，产物只含实际用到的组件。
            // 旧的 Element Plus 组件仍需在 main.ts 全量注册，逐步迁移完成后即可移除。
            Components({
                resolvers: [AntdvNextResolver()],
                dts: false, // 不生成 d.ts：本项目显式 import，vitepress/tsconfig 无需额外声明
                dirs: [], // 只解析第三方库组件，本地组件保持显式 import
                include: [/\.[jt]sx?$/, /\.vue$/, /\.vue\?vue/]
            })
        ]
    }
})
