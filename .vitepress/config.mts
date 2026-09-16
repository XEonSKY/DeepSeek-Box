import { defineConfig } from 'vitepress'

const REPO = 'https://github.com/XEonSKY/DeepSeek-Box'

// 文档分「用户文档 / 开发文档」两类，各自再分中英：
//   docs/zh/user、docs/zh/dev、docs/en/user、docs/en/dev
// URL 前缀与目录一一对应；站点根 / 由 docs/index.md 重定向到 /zh/。
//
// 分语言的 nav / sidebar 等主题配置必须放在 **locales.<lang>.themeConfig** 下：
// VitePress 只会把该语言条目的 themeConfig 与顶层 themeConfig 做浅合并
// （见 types/shared.d.ts 的 LocaleSpecificConfig 与 resolveSiteDataByRoute），
// 顶层只放各语言共用的 search / socialLinks。

const zhUser = [
    { text: '用户文档', items: [
    { text: '总览', link: '/zh/user/' },
    { text: '下载与系统要求', link: '/zh/user/download' },
    { text: '快速开始', link: '/zh/user/quickstart' },
    { text: '界面与操作', link: '/zh/user/usage' },
    { text: '设置说明', link: '/zh/user/settings' },
    { text: '环境管理（Node / npm）', link: '/zh/user/environment' },
    { text: 'DeepSeek Harness 管理', link: '/zh/user/dsh' },
    { text: '模型', link: '/zh/user/models' },
    { text: '应用更新与回退', link: '/zh/user/update' },
    { text: '常见问题', link: '/zh/user/faq' }
    ] }
]

const zhDev = [
    { text: '开发文档', items: [
    { text: '总览', link: '/zh/dev/' },
    { text: '开发环境与命令', link: '/zh/dev/setup' },
    { text: '架构总览', link: '/zh/dev/architecture' },
    { text: '主进程模块', link: '/zh/dev/modules' },
    { text: '渲染进程', link: '/zh/dev/renderer' },
    { text: 'IPC 契约', link: '/zh/dev/ipc' },
    { text: '安装链路', link: '/zh/dev/installs' },
    { text: '配置目录', link: '/zh/dev/config-dir' },
    { text: '应用自更新', link: '/zh/dev/app-update' },
    { text: '构建与发布', link: '/zh/dev/release' },
    { text: '开发约定', link: '/zh/dev/conventions' }
    ] }
]

const enUser = [
    { text: 'User guide', items: [
    { text: 'Overview', link: '/en/user/' },
    { text: 'Download & requirements', link: '/en/user/download' },
    { text: 'Quick start', link: '/en/user/quickstart' },
    { text: 'Interface & usage', link: '/en/user/usage' },
    { text: 'Settings', link: '/en/user/settings' },
    { text: 'Environment (Node / npm)', link: '/en/user/environment' },
    { text: 'DeepSeek Harness management', link: '/en/user/dsh' },
    { text: 'Models', link: '/en/user/models' },
    { text: 'App updates & rollback', link: '/en/user/update' },
    { text: 'FAQ', link: '/en/user/faq' }
    ] }
]

const enDev = [
    { text: 'Developer guide', items: [
    { text: 'Overview', link: '/en/dev/' },
    { text: 'Setup & commands', link: '/en/dev/setup' },
    { text: 'Architecture', link: '/en/dev/architecture' },
    { text: 'Main-process modules', link: '/en/dev/modules' },
    { text: 'Renderer', link: '/en/dev/renderer' },
    { text: 'IPC contract', link: '/en/dev/ipc' },
    { text: 'Install pipeline', link: '/en/dev/installs' },
    { text: 'Config directory', link: '/en/dev/config-dir' },
    { text: 'App self-update', link: '/en/dev/app-update' },
    { text: 'Build & release', link: '/en/dev/release' },
    { text: 'Conventions', link: '/en/dev/conventions' }
    ] }
]

const zhNav = [
    { text: '首页', link: '/zh/' },
    { text: '用户文档', link: '/zh/user/', activeMatch: '/zh/user/' },
    { text: '开发文档', link: '/zh/dev/', activeMatch: '/zh/dev/' },
    { text: '下载', link: '/zh/user/download' }
]

const enNav = [
    { text: 'Home', link: '/en/' },
    { text: 'User guide', link: '/en/user/', activeMatch: '/en/user/' },
    { text: 'Developer guide', link: '/en/dev/', activeMatch: '/en/dev/' },
    { text: 'Download', link: '/en/user/download' }
]

export default defineConfig({
    title: 'DeepSeek Box',
    description: 'DeepSeek Box —— 用户与开发文档',
    cleanUrls: true,
    lastUpdated: true,
    // README.md 是仓库/站点维护说明，不属于用户文档，不进站点。
    srcDir: 'docs',
    srcExclude: ['README.md'],
    head: [
    ['meta', { name: 'theme-color', content: '#0d1424' }],
    ['meta', { name: 'application-name', content: 'DeepSeek Box' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'DeepSeek Box' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    // 应用图标：由 resources/icon.png 复制为 docs/public/logo.png
    ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
    ['meta', { property: 'og:image', content: '/logo.png' }]
    ],
    locales: {
    zh: {
        label: '简体中文',
        lang: 'zh-CN',
        link: '/zh/',
        themeConfig: {
        nav: zhNav,
        // 左侧边栏：按路径前缀匹配，用户文档 / 开发文档各自一套
        sidebar: { '/zh/user/': zhUser, '/zh/dev/': zhDev },
        outline: { label: '本页导航', level: [2, 3] },
        // 默认主题的界面文案：VitePress 缺省是英文，这里按语言本地化
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        sidebarMenuLabel: '目录',
        returnToTopLabel: '回到顶部',
        langMenuLabel: '切换语言',
        skipToContentLabel: '跳到正文',
        notFound: {
            title: '页面不存在',
            quote: '你访问的页面可能已被移动或删除。',
            linkLabel: '返回首页',
            linkText: '回到首页'
        },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新于', formatOptions: { dateStyle: 'short', timeStyle: 'short' } },
        editLink: { pattern: REPO + '/edit/main/docs/:path', text: '在 GitHub 上编辑此页' },
        footer: {
            message: 'DeepSeek Box · 用户与开发文档',
            copyright: 'Copyright © 2026 <a href="https://www.xeonsky.com/" target="_blank" rel="noopener">XEonSKY Studio</a>'
        }
        }
    },
    en: {
        label: 'English',
        lang: 'en-US',
        link: '/en/',
        themeConfig: {
        nav: enNav,
        // Left sidebar: one set per section, matched by path prefix
        sidebar: { '/en/user/': enUser, '/en/dev/': enDev },
        outline: { label: 'On this page', level: [2, 3] },
        notFound: {
            title: 'Page not found',
            quote: 'The page you are looking for might have been moved or deleted.',
            linkLabel: 'Go to home',
            linkText: 'Take me home'
        },
        docFooter: { prev: 'Previous', next: 'Next' },
        lastUpdated: { text: 'Last updated at', formatOptions: { dateStyle: 'short', timeStyle: 'short' } },
        editLink: { pattern: REPO + '/edit/main/docs/:path', text: 'Edit this page on GitHub' },
        footer: {
            message: 'DeepSeek Box · User & developer docs',
            copyright: 'Copyright © 2026 <a href="https://www.xeonsky.com/" target="_blank" rel="noopener">XEonSKY Studio</a>'
        }
        }
    }
    },
    // 各语言共用的主题配置（会与 locales.<lang>.themeConfig 浅合并）
    themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: REPO }]
    }
})
