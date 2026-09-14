<script setup lang="ts">
import { h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElCheckbox, ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import DshWizard from './components/DshWizard.vue'
import TitleBar from './components/TitleBar.vue'
import StatusBar from './components/StatusBar.vue'
import { applyAppUpdateEvent, checkAndNotify } from './lib/update'
import { applyTheme, applyColorScheme } from './lib/theme'
import { applyExtTranslation, applyLocaleChange, currentLocale, tt } from './lib/locales'
import { useView, useGoView, useToggleTerminal } from './shell/viewnav'
import { webTabs, activeTab, activateTab, openTarget, setCoreRole, tabLabel } from './shell/tabs'
import WebHost from './views/WebHost.vue'
import { shellMeta } from './shell/shellmeta'
import type { AppUpdateEvent, ConfigMigrationPlan, ConfigMigrationProgress } from '@shared/types'
import { STATUSBAR_HEIGHT, TITLEBAR_HEIGHT } from '@shared/chrome'

const { t } = useI18n({ useScope: 'global' })

const view = useView()
const go = useGoView()

/** 把外框高度下发给 TitleBar / StatusBar 的 CSS 变量（与主进程共用 @shared/chrome 常量）。 */
const chromeStyle = `--titlebar-h: ${TITLEBAR_HEIGHT}px; --statusbar-h: ${STATUSBAR_HEIGHT}px`

/**
 * 副窗口把“当前标签页标题”同步给主进程，用于把本窗口命名为“<标题> - 软件名”（例如任务栏/窗口
 * 切换器/“移动到其它窗口”的选择器里可见）。核心窗口保持软件名不推送。
 */
function pushShellTitle(): void {
    if (shellMeta.isCore) return
    const a = activeTab()
    window.api.setShellTitle(a ? tabLabel(a) : '')
}
watch(
    [() => webTabs.activeId, () => activeTab()?.title, () => activeTab()?.kind],
    () => pushShellTitle(),
    { flush: 'post' }
)

// Ctrl+T 在 DeepSeek UI 与「设置 → 终端」之间切换（已在终端页则回 UI）。
const onToggle = useToggleTerminal()

// ---- Element Plus close prompt (requested by the main process) -------------
const remember = ref(false)
let askingClose = false
async function askClosePrompt(): Promise<void> {
    if (askingClose) return
    askingClose = true
    remember.value = false

    const message = h('div', { class: 'close-ask' }, [
        h('p', { class: 'close-ask__text' }, t('closeAsk.text')),
        h(
            ElCheckbox,
            { onChange: (v: string | number | boolean) => (remember.value = !!v) },
            { default: () => t('closeAsk.remember') }
        )
    ])

    try {
        await ElMessageBox({
            title: t('closeAsk.title'),
            message,
            confirmButtonText: t('closeAsk.toTray'),
            cancelButtonText: t('closeAsk.quit'),
            showCancelButton: true,
            distinguishCancelAndClose: true,
            type: 'info',
            customClass: 'close-ask-box'
        })
        // confirm => hide to tray
        window.api.resolveClose({ action: 'hide', remember: remember.value })
    } catch (err) {
    // Element Plus MessageBox 拒绝值就是字符串 'cancel'/'close'（非 { action } 对象）：
    // "直接退出" (cancel) => quit；Esc / X (close) => do nothing。
        if (err === 'cancel') {
            window.api.resolveClose({ action: 'quit', remember: remember.value })
        }
    } finally {
        askingClose = false
    }
}

let offToggle: (() => void) | null = null
let offAskClose: (() => void) | null = null
let offMissing: (() => void) | null = null
let offCore: (() => void) | null = null
let offAppUpdate: (() => void) | null = null
let offMigration: (() => void) | null = null
let offLocale: (() => void) | null = null

/**
 * 主进程后台更新事件：**检测到新版本只更新右下角徽标**（VS Code 式静默提示），
 * 不再弹通知打断用户；只有「已回退」这种异常状态才提示一次。
 */
function onAppUpdateEvent(e: AppUpdateEvent): void {
    applyAppUpdateEvent(e)
    if (e.kind === 'rollback' && e.message) {
        ElNotification({
            title: tt('sv.about.slots'),
            message: e.message,
            type: 'warning',
            position: 'top-right',
            offset: 60,
            duration: 8000
        })
    }
}

// dsh 未安装时由主进程通知 → 显示安装向导（向导组件自管全部安装状态与步骤）。
const showMissing = ref(false)

// ---- 配置目录迁移（重启引导阶段）：进度条 + 当前正在移动的文件 ----
const migration = ref<ConfigMigrationPlan | null>(null)
const migPercent = ref(0)
const migCurrent = ref('')
const migMoved = ref(0)
const migTotal = ref(0)
let migrationDone: (() => void) | null = null

/** 主进程迁移进度：实时刷新进度条与当前文件；done 时收起遮罩。 */
function onMigrationProgress(p: ConfigMigrationProgress): void {
    migPercent.value = p.percent
    migCurrent.value = p.current
    migMoved.value = p.moved
    migTotal.value = p.total
    if (!p.done) return
    migration.value = null
    migrationDone?.()
    migrationDone = null
    if (p.canceled) ElMessage.info(t('configMigration.canceled'))
    else if (!p.ok) ElMessage.error(t('configMigration.failed'))
}

/** 重启后若存在迁移计划：显示进度框，并等主进程搬完再继续启动流程。 */
async function runStartupMigration(): Promise<void> {
    try {
        const info = await window.api.getConfigDir()
        if (!info.pending || !shellMeta.isCore) return
        migration.value = info.pending
        const done = new Promise<void>((resolve) => {
            migrationDone = resolve
        })
        await window.api.runConfigMigration()
        await done
    } catch {
        migration.value = null
    }
}

/** 用户取消迁移：主进程回滚已搬内容并保持原配置目录。 */
function cancelMigration(): void {
    void window.api.cancelConfigMigration()
}

/**
 * 启动流程：先处理待执行的配置目录迁移（重启后显示进度条），再做常规初始化。
 */
async function boot(): Promise<void> {
    await runStartupMigration()
    const s = await window.api.getSettings()
    applyTheme(s.theme)
    applyColorScheme(s.colorScheme)
    void window.api.setWindowZoom(s.zoomPercent ?? 100)
    applyExtTranslation(s.funLocale ?? 'off')
    const ok = await window.api.isDshInstalled()
    if (!ok) {
        showMissing.value = true // main does not start dsh when it is absent
        return
    }
    if (s.autoCheckUpdate) void checkAndNotify({ prerelease: s.checkPrerelease })
}

onMounted(() => {
    // 仅核心窗口保留三固定站；非核心窗口不显示 dsh UI/网页/用量固定标签
    setCoreRole(shellMeta.isCore)
    pushShellTitle() // 副窗口初始命名（如空则回落到软件名）
    // 副窗口若带“开页意图”（创建时主进程给了 URL），挂载后开一个动态标签页承载之。
    if (!shellMeta.isCore) {
        void window.api
            .takeOpenIntent()
            .then((u) => {
                if (u) {
                    openTarget(u)
                    go('web')
                    pushShellTitle()
                }
            })
            .catch(() => {})
    }
    // 角色可能变化（如本窗口接管成为新核心）→ 更新固定标签并回到 dsh UI
    offCore = window.api.onShellRole((isCore) => {
        shellMeta.isCore = isCore
        setCoreRole(isCore)
        if (isCore) activateTab('home')
    })
    offToggle = window.api.onToggleView(onToggle)
    offAskClose = window.api.onAskClose(() => void askClosePrompt())
    offMissing = window.api.onDshMissing(() => {
        showMissing.value = true
    })
    offAppUpdate = window.api.onAppUpdateEvent(onAppUpdateEvent)
    offMigration = window.api.onConfigMigrationProgress(onMigrationProgress)
    // dsh UI 内切换语言 → 外壳跟随（与主题同步同一套机制：语言存在 dsh 的 settings.yaml）
    offLocale = window.api.onLocaleChanged((l) => {
        void (async () => {
            if (l === currentLocale()) return
            try {
                const cur = await window.api.getSettings()
                applyLocaleChange(l, cur.funLocale ?? 'off')
            } catch {
                // 设置读不到也不能让界面停在旧语言上
                applyLocaleChange(l, 'off')
            }
        })()
    })
    void boot()
})
onBeforeUnmount(() => {
    offToggle?.()
    offAskClose?.()
    offMissing?.()
    offCore?.()
    offAppUpdate?.()
    offMigration?.()
    offLocale?.()
})
</script>

<template>
    <div class="shell" :style="chromeStyle">
        <TitleBar />

        <main class="body">
            <!-- 常驻 web 宿主：进入日志/设置也不卸载，标签页 webview 保持保活 -->
            <div class="web-base"><WebHost /></div>
            <div v-if="view !== 'web'" class="web-overlay"><router-view /></div>
        </main>

        <!-- 底部状态栏（类似 VS Code）：空白占位，高度不计入内容区 16:9 -->
        <StatusBar />

        <DshWizard v-if="showMissing && !migration" @done="showMissing = false" />

        <div v-if="migration" class="migrate">
            <div class="migrate__card">
                <div class="migrate__title">{{ $t('configMigration.title') }}</div>
                <div class="migrate__desc">{{ $t('configMigration.desc', { from: migration?.from, to: migration?.to }) }}</div>
                <el-progress :percentage="migPercent" :stroke-width="14" />
                <div class="migrate__label">{{ migTotal > 0 ? $t('configMigration.moving') : $t('configMigration.preparing') }}</div>
                <div class="migrate__path" :title="migCurrent">{{ migCurrent }}</div>
                <div class="migrate__count">{{ $t('configMigration.count', { moved: migMoved, total: migTotal }) }}</div>
                <el-button text @click="cancelMigration">{{ $t('configMigration.cancel') }}</el-button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
}
/* 配置目录迁移：全屏遮罩 + 居中卡片 */
.migrate {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color-page);
}
.migrate__card {
  width: min(560px, 88vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  border-radius: 12px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
}
.migrate__title {
  font-size: 16px;
  font-weight: 600;
}
.migrate__desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.migrate__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.migrate__path {
  font-size: 12px;
  font-family: monospace;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.migrate__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}
/* 常驻 web 宿主（底层，永不卸载以保活 webview） */
.web-base {
  position: absolute;
  inset: 0;
}
/* 日志/设置覆盖层：不透明盖在 web 宿主上 */
.web-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: var(--el-bg-color-page);
  overflow: hidden;
}
</style>
