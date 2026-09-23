import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 路由表。标签页承载的 web 内容统一由 `/`(WebHost) 渲染（激活的 webview 标签页）。
 * `/settings/*` 是 App 里的**覆盖层**（`v-if view!=='web'` 包 `<router-view/>`），以保证进设置时
 * webview 仍保活。**终端不再是顶层路由**——它是设置页的子页 `/settings/log`（见 LogPanel.vue），
 * Ctrl+T 也跳这里。`/chat`、`/platform` 同样不单独成路由——它们是标签条里的固定标签页。
 * 视图懒加载，切走即卸载；hash 历史在 Electron file:// 与 dev server 下都稳定。
 * name 与设置侧栏高亮对应（`settings-<key>` 切前缀，见 SettingsView.vue 的 activeGroup）。
 */
export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: '/', name: 'web', component: () => import('../views/WebHost.vue') },
        // 初始化页（安装向导）：与设置页同级，同样是盖在 web 之上的覆盖层。
        { path: '/setup', name: 'setup', component: () => import('../views/SetupView.vue') },
        {
            // 父路由不命名：命名路由配上未命名的空路径子路由会触发 Vue Router 警告，
            // 且按名字导航无法落到空路径子路由。导航统一用 path，由子路由 name 区分。
            path: '/settings',
            component: () => import('../views/SettingsView.vue'),
            children: [
                { path: '', name: 'settings-root', redirect: { name: 'settings-general' } },
                { path: 'general', name: 'settings-general', component: () => import('../views/settings/GeneralPanel.vue') },
                { path: 'system', name: 'settings-system', component: () => import('../views/settings/SystemPanel.vue') },
                { path: 'appearance', name: 'settings-appearance', component: () => import('../views/settings/AppearancePanel.vue') },
                { path: 'network', name: 'settings-network', component: () => import('../views/settings/NetworkPanel.vue') },
                { path: 'env', name: 'settings-env', component: () => import('../views/settings/EnvPanel.vue') },
                { path: 'dsh', name: 'settings-dsh', component: () => import('../views/settings/DshPanel.vue') },
                { path: 'plugins', name: 'settings-plugins', component: () => import('../views/settings/PluginsPanel.vue') },
                { path: 'models', name: 'settings-models', component: () => import('../views/settings/ModelsPanel.vue') },
                { path: 'log', name: 'settings-log', component: () => import('../views/settings/LogPanel.vue') },
                { path: 'hotkeys', name: 'settings-hotkeys', component: () => import('../views/settings/HotkeysPanel.vue') },
                { path: 'about', name: 'settings-about', component: () => import('../views/settings/AboutPanel.vue') }
            ]
        },
        { path: '/:pathMatch(.*)*', redirect: '/' }
    ]
})
