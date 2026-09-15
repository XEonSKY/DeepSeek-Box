import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

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
        plugins: [vue()]
    }
})
