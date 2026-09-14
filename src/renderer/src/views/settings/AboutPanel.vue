<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ReloadOutlined, SendOutlined, GithubOutlined } from '@antdv-next/icons'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from './useSettingsStore'
import { friendlyPlatform } from './settingsStore'
import type { AppMeta, AppSlotsState, AppUpdateEvent } from '@shared/types'
import { useAppIcon } from '../../lib/appIcon'
import { tt } from '../../lib/locales'
import { formatDownload } from '../../lib/format'

const { state } = useSettingsStore()
// 应用 Logo：随深浅色切换（深色用 icon-dark.png），见 lib/appIcon.ts
const aboutIcon = useAppIcon()

/** 开发模式彩蛋：连点应用版本 5 次解锁。 */
const DEV_UNLOCK_TAPS = 5
const DEV_TAP_WINDOW_MS = 1500

let tapCount = 0
let tapTimer: number | undefined
let burstHost: HTMLElement | null = null

/** 从点击点炸出一圈彩色粒子。 */
function spawnBurst(el: HTMLElement, e: MouseEvent): void {
    burstHost ??= el.parentElement ?? el
    const hostRect = burstHost.getBoundingClientRect()
    const x = e.clientX - hostRect.left
    const y = e.clientY - hostRect.top
    const colors = [
        'var(--el-color-primary)',
        'var(--el-color-primary-light-3)',
        'var(--el-color-warning)',
        'var(--el-color-success)',
        'var(--el-color-danger)'
    ]

    for (let i = 0; i < 12; i++) {
        const p = document.createElement('i')
        const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.4
        const dist = 18 + Math.random() * 22
        const size = 3 + Math.random() * 3
        p.className = 'kv-burst'
        p.style.cssText = [
            `left:${x}px`,
            `top:${y}px`,
            `width:${size}px`,
            `height:${size}px`,
            `background:${colors[i % colors.length]}`,
            `--dx:${Math.cos(angle) * dist}px`,
            `--dy:${Math.sin(angle) * dist}px`,
            `--rot:${Math.random() * 360}deg`
        ].join(';')
        burstHost.appendChild(p)
        p.addEventListener('animationend', () => p.remove(), { once: true })
    }
}

function onAppVerClick(e: MouseEvent): void {
    const el = e.currentTarget as HTMLElement
    spawnBurst(el, e)

    if (state.devMode) return

    if (tapTimer) window.clearTimeout(tapTimer)
    tapCount += 1
    if (tapCount >= DEV_UNLOCK_TAPS) {
        tapCount = 0
        state.devMode = true
        ElMessage.success(tt('sv.about.devUnlocked'))
        return
    }

    tapTimer = window.setTimeout(() => {
        tapCount = 0
    }, DEV_TAP_WINDOW_MS)
}

const open = ref(['about-options', 'about-links', 'about-check'])

// ---------------------------------------------------------------------------
// 彩蛋二：连点「系统架构」徽标 5 次 → 井字棋
// ---------------------------------------------------------------------------

/** 连点窗口与版本号彩蛋一致：两次点击间隔超过它，计数从头开始。 */
const GAME_TAPS = 5
const GAME_TAP_WINDOW_MS = 1500

let gameTaps = 0
let gameTapTimer: number | undefined
const showGame = ref(false)

function onEnvClick(e: MouseEvent): void {
    if (gameTapTimer) window.clearTimeout(gameTapTimer)
    gameTaps += 1
    if (gameTaps >= GAME_TAPS) {
        gameTaps = 0
        spawnBurst(e.currentTarget as HTMLElement, e)
        resetGame()
        showGame.value = true
        return
    }
    gameTapTimer = window.setTimeout(() => {
        gameTaps = 0
    }, GAME_TAP_WINDOW_MS)
}

type Cell = 'X' | 'O' | null
type GameStatus = 'playing' | 'won' | 'lost' | 'draw'

/** 玩家执 X、电脑执 O。 */
const LINES: ReadonlyArray<readonly [number, number, number]> = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
]

const board = ref<Cell[]>(Array(9).fill(null))
const gameStatus = ref<GameStatus>('playing')

/** 状态文案的键后缀：在模板里拼成 `$t('sv.about.ttt' + statusKey)`，这样切语言也会跟着变。 */
const statusKey = computed(() => {
    if (gameStatus.value === 'won') return 'Won'
    if (gameStatus.value === 'lost') return 'Lost'
    if (gameStatus.value === 'draw') return 'Draw'
    return 'YourTurn'
})
/** 电脑「思考」中的延时句柄：非空表示电脑该走子/正在走。 */
let aiTimer: number | undefined

function winnerOf(b: Cell[]): 'X' | 'O' | null {
    for (const [a, c, d] of LINES) {
        if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a]
    }
    return null
}

function settle(): void {
    const w = winnerOf(board.value)
    if (w === 'X') gameStatus.value = 'won'
    else if (w === 'O') gameStatus.value = 'lost'
    else if (board.value.every(Boolean)) gameStatus.value = 'draw'
}

/** 电脑走子：能赢就赢 → 挡玩家 → 占中心 → 占角 → 占边。刻意留一点破绽，不至于无法取胜。 */
function aiMove(b: Cell[]): number {
    for (const me of ['O', 'X'] as const) {
        for (const line of LINES) {
            const mine = line.filter((i) => b[i] === me).length
            const blank = line.filter((i) => !b[i])
            if (mine === 2 && blank.length === 1) return blank[0]
        }
    }
    if (!b[4]) return 4
    const corners = [0, 2, 6, 8].filter((i) => !b[i])
    if (corners.length > 0) return corners[Math.floor(Math.random() * corners.length)]
    const empty = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0)
    return empty.length > 0 ? empty[Math.floor(Math.random() * empty.length)] : -1
}

function stopAi(): void {
    if (aiTimer !== undefined) {
        window.clearTimeout(aiTimer)
        aiTimer = undefined
    }
}

function resetGame(): void {
    stopAi()
    board.value = Array(9).fill(null)
    gameStatus.value = 'playing'
}

/** 玩家落子；落完若未分胜负则安排电脑走子。 */
function play(i: number): void {
    if (gameStatus.value !== 'playing' || board.value[i] || aiTimer !== undefined) return
    board.value[i] = 'X'
    settle()
    if (gameStatus.value !== 'playing') return
    aiTimer = window.setTimeout(() => {
        aiTimer = undefined
        const j = aiMove(board.value)
        if (j >= 0) board.value[j] = 'O'
        settle()
    }, 320)
}

type Phase = 'idle' | 'checking' | 'downloading' | 'staging' | 'downloaded' | 'none' | 'error'

const meta = ref<AppMeta | null>(null)
const phase = ref<Phase>('idle')
const targetVersion = ref<string | null>(null)
/**
 * 「已是最新」时**远端实际解析到的版本**。
 * 必须显示出来：本模块只比较版本号，若通道解析错了（例如正式版线拿到的是更旧的正式版），
 * 界面只会说「已是最新」，完全无法与「确实没有新版」区分 —— 排查时只能靠猜。
 */
const remoteVersion = ref<string | null>(null)
const percent = ref(0)
const speed = ref(0)
const transferred = ref(0)
const totalBytes = ref(0)
/** 进度条下方的「已下载 / 总大小 · 速度」。 */
const progressInfo = computed(() => formatDownload(totalBytes.value, transferred.value, speed.value))
const errMsg = ref('')

/** A/B 版本槽状态（当前 / 压缩保留的上一版 / 待重启安装）。 */
const slots = ref<AppSlotsState | null>(null)

const envLabel = ref('')

/** 刷新版本槽状态。 */
async function refreshSlots(): Promise<void> {
    try {
        slots.value = await window.api.getAppSlots()
    } catch {
        /* ignore */
    }
}

/** 归档大小显示（MB，保留一位小数）。 */
function archiveSize(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

/** 手动回退到上一版（二次确认后重启应用）。 */
async function rollback(): Promise<void> {
    const version = slots.value?.previous?.version ?? ''
    try {
        await ElMessageBox.confirm(
            tt('sv.about.rollbackConfirm', { version }),
            tt('sv.about.rollbackConfirmTitle'),
            { type: 'warning', confirmButtonText: tt('sv.about.rollback'), cancelButtonText: tt('sv.about.rollbackCancel') }
        )
    } catch {
        return
    }
    const r = await window.api.rollbackAppUpdate()
    if (r.ok) ElMessage.success(tt('sv.about.rollbackStarted'))
    else ElMessage.error(tt('sv.about.rollbackFailed', { message: r.message }))
}

/** 项目主页（外部浏览器打开）。 */
const REPO_URL = 'https://github.com/XEonSKY/DeepSeek-Box'

function openRepo(): void {
    void window.api.openExternal(REPO_URL)
}

function onEvent(e: AppUpdateEvent): void {
    switch (e.kind) {
        case 'checking':
            phase.value = 'checking'
            remoteVersion.value = null
            break
        case 'available':
            targetVersion.value = e.version ?? null
            phase.value = 'downloading'
            percent.value = 0
            speed.value = 0
            transferred.value = 0
            totalBytes.value = 0
            break
        case 'progress':
            phase.value = 'downloading'
            percent.value = Math.round(e.percent ?? 0)
            speed.value = e.speed ?? 0
            transferred.value = e.transferred ?? 0
            totalBytes.value = e.total ?? 0
            break
        case 'staging':
            targetVersion.value = e.version ?? targetVersion.value
            phase.value = 'staging'
            break
        case 'downloaded':
            targetVersion.value = e.version ?? targetVersion.value
            phase.value = 'downloaded'
            percent.value = 100
            void refreshSlots()
            break
        case 'not-available':
            remoteVersion.value = e.version ?? null
            phase.value = 'none'
            break
        case 'rollback':
            errMsg.value = e.message ?? ''
            phase.value = 'idle'
            void refreshSlots()
            break
        case 'error':
            errMsg.value = e.message ?? ''
            phase.value = 'error'
            break
    }
}

async function check(): Promise<void> {
    errMsg.value = ''
    phase.value = 'checking'
    try {
        const r = await window.api.triggerAppUpdate({ prerelease: state.appCheckPrerelease })
        if (!r.ok) {
            errMsg.value = r.message
            phase.value = 'error'
        }
        // r.ok 为真时由主进程的 appupdate 事件推进 phase（checking → available / not-available / error）
    } catch (err) {
        // IPC 自己抛错（处理器异常等）时也要落到 error，
        // 否则 phase 会永远停在 checking：按钮一直转圈且一直禁用。
        errMsg.value = tt('sv.about.checkFailed', { err: err instanceof Error ? err.message : String(err) })
        phase.value = 'error'
    }
}

function restart(): void {
    window.api.restartAndInstall()
}

let offEvent: (() => void) | null = null
/** 是否已收到过实时事件：用于避免「补齐状态」把更新的实时状态覆盖成旧值。 */
let gotLiveEvent = false

onMounted(async () => {
    offEvent = window.api.onAppUpdateEvent((e) => {
        gotLiveEvent = true
        onEvent(e)
    })
    // 启动期的静默检查/下载发生在本页挂载之前，先订阅再补一次最近状态；
    // 若期间已收到实时事件，则以下载/完成等实时状态为准，不用缓存覆盖。
    try {
        const last = await window.api.getAppUpdateState()
        if (last && !gotLiveEvent) onEvent(last)
    } catch {
    /* ignore */
    }
    void refreshSlots()
    try {
        const m = await window.api.getAppMeta()
        meta.value = m
        const parts: string[] = []
        if (m.platform) parts.push(friendlyPlatform(m.platform))
        if (m.arch) parts.push(m.arch)
        envLabel.value = parts.join(' · ')
    } catch {
    /* ignore */
    }
})

onBeforeUnmount(() => {
    offEvent?.()
    if (tapTimer) window.clearTimeout(tapTimer)
    if (gameTapTimer) window.clearTimeout(gameTapTimer)
    stopAi()
})
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon about-logo"><img :src="aboutIcon" alt="DeepSeek Box" draggable="false" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">DeepSeek Box</div>
                <div class="dsh-brand__ver">
                    {{ $t('sv.about.appVersion') }}&nbsp;<code
                        class="app-ver"
                        @click="onAppVerClick"
                    >{{ meta?.version ? 'v' + meta.version : '—' }}</code>
                    <span v-if="envLabel" class="env-badge env-tap" @click="onEnvClick">{{ envLabel }}</span>
                </div>
            </div>
        </div>

        <el-collapse v-model="open">
            <el-collapse-item name="about-options">
                <template #title>
                    <div class="sec__title">{{ $t('sv.about.options') }}</div>
                </template>
                <div class="kopt">
                    <div class="au">
                        <div class="au__txt">
                            <div class="au__t">{{ $t('sv.about.autoUpdate') }}</div>
                            <div class="au__desc">{{ $t('sv.about.autoUpdateDesc') }}</div>
                        </div>
                        <el-switch v-model="state.appAutoUpdate" />
                    </div>
                    <div class="au">
                        <div class="au__txt">
                            <div class="au__t">{{ $t('sv.about.checkPrerelease') }}</div>
                            <div class="au__desc">{{ $t('sv.about.checkPrereleaseDesc') }}</div>
                        </div>
                        <el-switch v-model="state.appCheckPrerelease" />
                    </div>
                    <!-- 开发模式默认隐藏：在本页连点「应用版本号」5 次解锁；开启后才显示，关闭即再隐藏 -->
                    <div v-if="state.devMode" class="au">
                        <div class="au__txt">
                            <div class="au__t">{{ $t('sv.about.devMode') }}</div>
                            <div class="au__desc">{{ $t('sv.about.devModeDesc') }}</div>
                        </div>
                        <el-switch v-model="state.devMode" />
                    </div>
                </div>
            </el-collapse-item>

            <el-collapse-item name="about-links">
                <template #title>
                    <div class="sec__title">{{ $t('sv.about.links') }}</div>
                </template>
                <div class="au">
                    <div class="au__txt">
                        <div class="au__t">{{ $t('sv.about.github') }}</div>
                        <div class="au__desc">{{ $t('sv.about.githubDesc') }}</div>
                        <div class="repo-url">{{ REPO_URL }}</div>
                    </div>
                    <el-button class="repo-btn" @click="openRepo">
                        <GithubOutlined class="gh-icon" />
                        {{ $t('sv.about.openGithub') }}
                    </el-button>
                </div>
            </el-collapse-item>

            <el-collapse-item name="about-check">
                <template #title>
                    <div class="sec__title"><el-icon><ReloadOutlined /></el-icon> {{ $t('sv.about.checkTitle') }}</div>
                </template>

                <div class="au-row">
                    <el-button
                        type="primary"
                        :icon="ReloadOutlined"
                        :loading="phase === 'checking'"
                        :disabled="phase === 'checking' || phase === 'downloading' || phase === 'staging'"
                        @click="check"
                    >
                        {{ $t('sv.about.checkBtn') }}
                    </el-button>
                    <el-button
                        v-if="phase === 'downloaded'"
                        type="success"
                        :icon="SendOutlined"
                        @click="restart"
                    >
                        {{ $t('sv.about.restartNow') }}
                    </el-button>
                </div>

                <template v-if="phase === 'downloading'">
                    <p class="au-note">{{ $t('sv.about.downloading', { version: targetVersion || '' }) }}</p>
                    <el-progress :percentage="percent" :status="percent >= 100 ? 'success' : 'active'" />
                    <div class="au-note au-speed">{{ progressInfo }}</div>
                </template>

                <el-alert
                    v-else-if="phase === 'staging'"
                    class="about-result"
                    :title="$t('sv.about.staging', { version: targetVersion || '' })"
                    type="info"
                    show-icon
                    :closable="false"
                />
                <el-alert
                    v-else-if="phase === 'downloaded'"
                    class="about-result"
                    :title="$t('sv.about.downloadedTitle')"
                    :description="$t('sv.about.downloadedDesc')"
                    type="success"
                    show-icon
                    :closable="false"
                />
                <el-alert
                    v-else-if="phase === 'none'"
                    class="about-result"
                    :title="
                        remoteVersion
                            ? $t('sv.about.notAvailableWith', { version: remoteVersion })
                            : $t('sv.about.notAvailable')
                    "
                    type="info"
                    show-icon
                    :closable="false"
                />
                <el-alert
                    v-else-if="phase === 'error' && errMsg"
                    class="about-result"
                    :title="errMsg"
                    type="warning"
                    show-icon
                    :closable="false"
                />
            </el-collapse-item>

            <el-collapse-item name="about-slots">
                <template #title>
                    <div class="sec__title"><el-icon><ReloadOutlined /></el-icon> {{ $t('sv.about.slots') }}</div>
                </template>

                <div class="slot-row">
                    <span class="slot-label">{{ $t('sv.about.slotsCurrent') }}</span>
                    <el-tag size="small" type="success" effect="plain">{{ slots?.current || '—' }}</el-tag>
                </div>
                <div class="slot-row">
                    <span class="slot-label">{{ $t('sv.about.slotsPrevious') }}</span>
                    <el-tag v-if="slots?.previous" size="small" type="info" effect="plain">
                        {{ slots.previous.version }} · {{ archiveSize(slots.previous.bytes) }}
                    </el-tag>
                    <span v-else class="slot-empty">{{ $t('sv.about.slotsEmpty') }}</span>
                </div>
                <div v-if="slots?.pending" class="slot-row">
                    <span class="slot-label">{{ $t('sv.about.slotsPending') }}</span>
                    <el-tag size="small" type="warning" effect="plain">{{ slots.pending }}</el-tag>
                </div>

                <div class="au-row">
                    <el-button :icon="ReloadOutlined" @click="refreshSlots">{{ $t('sv.about.rollbackRefresh') }}</el-button>
                    <el-button type="warning" :disabled="!slots?.canRollback" @click="rollback">
                        {{ $t('sv.about.rollback') }}
                    </el-button>
                </div>
            </el-collapse-item>
        </el-collapse>

        <!-- 彩蛋：连点系统架构徽标 5 次弹出的井字棋（el-dialog 会 teleport 到 body，放哪都一样） -->
        <el-dialog v-model="showGame" :title="$t('sv.about.tttTitle')" width="320px" align-center>
            <div class="ttt">
                <div class="ttt__status">{{ $t('sv.about.ttt' + statusKey) }}</div>
                <div class="ttt__grid">
                    <button
                        v-for="(c, i) in board"
                        :key="i"
                        class="ttt__cell"
                        :class="{ 'ttt__cell--x': c === 'X', 'ttt__cell--o': c === 'O' }"
                        type="button"
                        :disabled="!!c || gameStatus !== 'playing'"
                        @click="play(i)"
                    >
                        {{ c ?? '' }}
                    </button>
                </div>
                <div class="ttt__foot">
                    <el-button size="small" :icon="ReloadOutlined" @click="resetGame">{{ $t('sv.about.tttAgain') }}</el-button>
                    <span class="ttt__mark">{{ $t('sv.about.tttMarks') }}</span>
                </div>
            </div>
        </el-dialog>
    </div>
</template>

<style scoped>
.au-speed {
  font-variant-numeric: tabular-nums;
}
/* 关于页使用应用图标（icon.png）替代默认的 Info 图标。 */
.about-logo {
  background: transparent;
}
.about-logo img {
  width: 52px;
  height: 52px;
  border-radius: 13px;
  object-fit: cover;
  display: block;
}

/* 项目主页：地址 + 外链按钮 */
.repo-url {
  display: inline-block;
  margin-top: 8px;
  padding: 3px 8px;
  font-family: var(--el-font-family-mono);
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-radius: 6px;
  word-break: break-all;
}
.repo-btn {
  flex: 0 0 auto;
}

/* A/B 版本槽：标签行 */
.slot-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.slot-label {
  flex: 0 0 auto;
  min-width: 120px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.slot-empty {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
/* antdv 图标按 1em 取尺寸（不是 svg 的 width/height），故用 font-size 控制大小 */
.gh-icon {
  font-size: 15px;
  margin-right: 6px;
  vertical-align: -2px;
}

/* 系统架构徽标：彩蛋入口（连点 5 次），给个可点的光标 */
.env-tap {
  cursor: pointer;
  user-select: none;
}

/* ---- 井字棋（彩蛋） ---- */
/* 注意：el-dialog 的内容会被 teleport 到 body，但仍是本组件的渲染作用域，
   所以 scoped 样式照常生效，不需要 :deep() 之外的特殊处理。 */
.ttt {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.ttt__status {
  font-size: 13px;
  font-weight: 600;
}
.ttt__grid {
  display: grid;
  grid-template-columns: repeat(3, 64px);
  gap: 6px;
}
.ttt__cell {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-primary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ttt__cell:hover:not(:disabled) {
  background: var(--el-fill-color-light);
  border-color: var(--el-color-primary);
}
.ttt__cell:disabled {
  cursor: default;
}
.ttt__cell--x {
  color: var(--el-color-primary);
}
.ttt__cell--o {
  color: var(--el-color-danger);
}
.ttt__foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ttt__mark {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
