// ESLint 扁平配置（ESLint 10 + typescript-eslint + eslint-plugin-vue）
// 目标：统一代码风格，缩进使用 4 个空格。
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import stylistic from '@stylistic/eslint-plugin'

export default tseslint.config(
    // 构建产物、依赖与本地临时目录不参与检查
    // .temp/.dsh 是约定的本地目录（见 .gitignore）：里面的临时脚本不应让 `npm run lint` 报错
    { ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', '.vitepress/**', '**/.vitepress/**', '.vite/**', '**/*.tsbuildinfo', '.temp/**', '.dsh/**'] },
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
