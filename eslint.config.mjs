// ESLint 扁平配置（ESLint 10 + typescript-eslint + eslint-plugin-vue）
// 目标：统一代码风格，缩进使用 4 个空格。
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import stylistic from '@stylistic/eslint-plugin'

export default tseslint.config(
    // 构建产物与依赖不参与检查；`.agents/` 是技能文档与 agent 的临时目录
    // （含上游 deepseek-harness 的参考克隆，动辄数万个 .ts），check 时必须跳过。
    // `electron.vite.config.*.mjs` 是 electron-vite 加载配置时生成的临时文件（已在 .gitignore），
    // eslint 默认不读 .gitignore，不显式排除会被扫到并报一堆缩进错。
    { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', '.agents/**', '.vitepress/**', '**/.vitepress/**', '.vite/**', '**/*.tsbuildinfo', 'electron.vite.config.*.mjs'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs['flat/essential'],
    {
        // .vue 的 <script> 交给 TypeScript 解析器，<template> 交给 vue-eslint-parser
        files: ['**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
    },
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
        },
        plugins: { '@stylistic': stylistic },
        rules: {
            // any 作为警告而非错误（引入期不阻塞）
            '@typescript-eslint/no-explicit-any': 'warn',
            // 统一缩进：4 个空格
            '@stylistic/indent': ['error', 4, { SwitchCase: 1 }],
            'vue/html-indent': ['error', 4],
        },
    },
)
