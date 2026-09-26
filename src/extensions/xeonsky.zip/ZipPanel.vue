<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { FolderOpenOutlined, FileZipOutlined, ReloadOutlined } from '@antdv-next/icons'
import { ElMessage } from 'element-plus'
import { extApi, extErrorMessage, extT } from '../renderer-api'
import type { ArchiveFormat, CompressionMethod, SevenZipRunResult, SevenZipStatus } from './types'
import { FEATURES } from './types'

/**
 * 「归档（7-Zip）」设置面板 —— 内置扩展 `xeonsky.zip` 的渲染层实现。
 *
 * 与主进程入口（同目录 `main.ts`）和清单（同目录 `manifest.ts`）放在一起，
 * 三者构成这个扩展的完整定义；挂载入口见 `renderer/src/extensions/panels.ts` 的 `LOCAL_VIEWS`。
 *
 * 对外依赖全部收在 `../renderer-api`（渲染层扩展 API 面），不 import 外壳内部模块 ——
 * 与主进程侧「扩展不直接 import 内核」是同一条原则。
 *
 * 与主进程的通信走**本扩展自己的 DIY 通道**（`ext:xeonsky.zip:<action>`），
 * 而不是内核内置端点 —— 扩展端点不占 `ApiRoutes` 契约，这正是它的用途。
 */

/** 本扩展的通道前缀（与主进程 manifest.id 一致）。 */
const CHANNEL = 'ext:xeonsky.zip'

/** 调一次本扩展的主进程动作。 */
function call<T>(action: string, payload?: unknown): Promise<T> {
    return extApi.ext.invoke(`${CHANNEL}:${action}`, payload) as Promise<T>
}

const status = ref<SevenZipStatus | null>(null)
const formats = ref<ArchiveFormat[]>([])
const methods = ref<CompressionMethod[]>([])
const targets = ref<Array<{ os: string; arch: string; dir: string; label: string; binary: string }>>([])
const busy = ref(false)

/** 二进制路径输入框（初始化为当前生效值，用户改完点「应用」）。 */
const pathInput = ref('')

async function reload(): Promise<void> {
    busy.value = true
    try {
        status.value = await call<SevenZipStatus>('status')
        pathInput.value = status.value.binaryPath
        const desc = await call<{ formats: ArchiveFormat[]; methods: CompressionMethod[] }>('describe')
        formats.value = desc.formats
        methods.value = desc.methods
        if (!targets.value.length) targets.value = await call<Array<{ os: string; arch: string; dir: string; label: string; binary: string }>>('listTargets')
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        busy.value = false
    }
}

/** 应用用户填写的二进制路径。 */
async function applyPath(): Promise<void> {
    try {
        status.value = await call<SevenZipStatus>('setBinaryPath', { path: pathInput.value.trim() })
        ElMessage.success(extT('ext.xeonskyZip.panel.pathSaved'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    }
}

// ---- 试用：解压 / 压缩 -------------------------------------------------------

/** 现场试解压：填归档路径 + 输出目录。 */
const trialArchive = ref('')
const trialDest = ref('')
const trialPassword = ref('')
const trialOutput = ref('')

async function tryExtract(): Promise<void> {
    if (!trialArchive.value.trim() || !trialDest.value.trim()) return
    busy.value = true
    try {
        const r = await call<SevenZipRunResult & { destDir: string }>('extract', {
            archive: trialArchive.value.trim(),
            destDir: trialDest.value.trim(),
            password: trialPassword.value || undefined
        })
        trialOutput.value = r.output
        if (r.ok) ElMessage.success(extT('ext.xeonskyZip.panel.extractOk'))
        else ElMessage.error(extT('ext.xeonskyZip.panel.extractFail'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        busy.value = false
    }
}

/** 现场试压缩。 */
const trialInputs = ref('')
const trialOutArchive = ref('')
const trialFormat = ref('7z')
const trialLevel = ref(5)
const trialPasswordNew = ref('')

async function tryCompress(): Promise<void> {
    if (!trialOutArchive.value.trim() || !trialInputs.value.trim()) return
    busy.value = true
    try {
        const r = await call<SevenZipRunResult & { archive: string }>('compress', {
            archive: trialOutArchive.value.trim(),
            inputs: trialInputs.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
            format: trialFormat.value,
            level: trialLevel.value,
            password: trialPasswordNew.value || undefined
        })
        trialOutput.value = r.output
        if (r.ok) ElMessage.success(extT('ext.xeonskyZip.panel.compressOk'))
        else ElMessage.error(extT('ext.xeonskyZip.panel.compressFail'))
    } catch (err) {
        ElMessage.error(extErrorMessage(err))
    } finally {
        busy.value = false
    }
}

/** 状态标签：可用 / 不可用。 */
const availableTag = computed(() => (status.value?.available ? 'green' : status.value?.binaryPath ? 'orange' : 'red'))
const availableText = computed(() => {
    if (status.value?.available) return extT('ext.xeonskyZip.panel.stAvailable')
    if (status.value?.binaryPath) return extT('ext.xeonskyZip.panel.stUnusable')
    return extT('ext.xeonskyZip.panel.stMissing')
})

/** 来源文案。 */
const sourceText = computed(() => {
    const s = status.value?.source
    if (s === 'custom') return extT('ext.xeonskyZip.panel.srcCustom')
    if (s === 'bundled') return extT('ext.xeonskyZip.panel.srcBundled')
    if (s === 'system') return extT('ext.xeonskyZip.panel.srcSystem')
    return extT('ext.xeonskyZip.panel.srcMissing')
})

onMounted(() => void reload())
</script>

<template>
    <div class="panel" v-loading="busy">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><FileZipOutlined style="font-size: 34px" /></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('ext.xeonskyZip.nav') }}</div>
                <div class="dsh-brand__desc">{{ $t('ext.xeonskyZip.intro') }}</div>
            </div>
        </div>

        <!-- 核心状态 -->
        <div class="zpanel__bar">
            <div class="zpanel__head">{{ $t('ext.xeonskyZip.panel.coreTitle') }}</div>
            <a-space :size="8">
                <a-button @click="reload">
                    <template #icon><ReloadOutlined /></template>
                    {{ $t('ext.xeonskyZip.panel.refresh') }}
                </a-button>
            </a-space>
        </div>

        <a-descriptions bordered size="small" :column="1" class="zpanel__desc">
            <a-descriptions-item :label="$t('ext.xeonskyZip.panel.binPath')">
                <span :class="['zpanel__path', !status?.binaryPath && 'zpanel__path--empty']">
                    {{ status?.binaryPath || $t('ext.xeonskyZip.panel.notConfigured') }}
                </span>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ext.xeonskyZip.panel.source')">
                <a-tag :color="availableTag">{{ availableText }}</a-tag>
                <span class="zpanel__muted">{{ sourceText }}</span>
                <span v-if="status?.version" class="zpanel__muted">· v{{ status.version }}</span>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ext.xeonskyZip.panel.target')">
                <template v-if="status?.target">
                    <span>{{ status.target.label }}</span>
                </template>
                <span v-else class="zpanel__muted">{{ $t('ext.xeonskyZip.panel.targetUnsupported') }}</span>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ext.xeonskyZip.panel.bundledVersion')">
                <span class="zpanel__path">{{ status?.bundledVersion }}</span>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('ext.xeonskyZip.panel.binDir')">
                <span class="zpanel__path">{{ status?.binDir }}</span>
                <span v-if="status?.binPlatformDir" class="zpanel__muted">{{ status.binPlatformDir }}/{{ status.target?.binary }}</span>
            </a-descriptions-item>
        </a-descriptions>

        <!-- 指定二进制路径 -->
        <div class="zpanel__row">
            <a-input
                v-model:value="pathInput"
                :placeholder="$t('ext.xeonskyZip.panel.pathPlaceholder')"
                allow-clear
                class="zpanel__grow"
            >
                <template #prefix><FolderOpenOutlined /></template>
            </a-input>
            <a-button @click="applyPath">{{ $t('ext.xeonskyZip.panel.apply') }}</a-button>
        </div>

        <!-- 支持的格式 / 方法 / 功能 -->
        <div class="zpanel__grid">
            <div class="zpanel__card">
                <div class="zpanel__cardTitle">{{ $t('ext.xeonskyZip.panel.formatsTitle') }}</div>
                <div class="zpanel__list">
                    <div v-for="f in formats" :key="f.name" class="zpanel__item">
                        <code class="zpanel__fmt">{{ f.name }}</code>
                        <span class="zpanel__badges">
                            <a-tag v-if="f.canCreate" color="green">{{ $t('ext.xeonskyZip.panel.canCreate') }}</a-tag>
                            <a-tag v-if="f.canExtract">{{ $t('ext.xeonskyZip.panel.canExtract') }}</a-tag>
                            <a-tag v-if="f.canUpdate" color="blue">{{ $t('ext.xeonskyZip.panel.canUpdate') }}</a-tag>
                        </span>
                        <span class="zpanel__note" :title="f.note">{{ f.note }}</span>
                    </div>
                </div>
            </div>

            <div class="zpanel__card">
                <div class="zpanel__cardTitle">{{ $t('ext.xeonskyZip.panel.methodsTitle') }}</div>
                <div class="zpanel__list">
                    <div v-for="m in methods" :key="m.name" class="zpanel__item">
                        <code class="zpanel__fmt zpanel__fmt--wide">{{ m.name }}</code>
                        <span class="zpanel__note">{{ m.formats.join(' / ') }}<template v-if="m.note"> — {{ m.note }}</template></span>
                    </div>
                </div>
            </div>

            <div class="zpanel__card zpanel__card--full">
                <div class="zpanel__cardTitle">{{ $t('ext.xeonskyZip.panel.featuresTitle') }}</div>
                <div class="zpanel__list">
                    <div v-for="ft in FEATURES" :key="ft.name" class="zpanel__item">
                        <span class="zpanel__feat">{{ ft.name }}</span>
                        <code v-if="ft.flag" class="zpanel__flag">{{ ft.flag }}</code>
                        <span class="zpanel__note">{{ ft.note }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 试用 -->
        <div class="zpanel__card zpanel__card--full">
            <div class="zpanel__cardTitle">{{ $t('ext.xeonskyZip.panel.trialTitle') }}</div>
            <div class="zpanel__row">
                <a-input v-model:value="trialArchive" :placeholder="$t('ext.xeonskyZip.panel.archivePlaceholder')" class="zpanel__grow" />
                <a-input v-model:value="trialDest" :placeholder="$t('ext.xeonskyZip.panel.destPlaceholder')" class="zpanel__grow" />
                <a-input v-model:value="trialPassword" :placeholder="$t('ext.xeonskyZip.panel.passwordPlaceholder')" class="zpanel__pwd" />
                <a-button type="primary" :disabled="!trialArchive.trim() || !trialDest.trim()" @click="tryExtract">
                    {{ $t('ext.xeonskyZip.panel.tryExtract') }}
                </a-button>
            </div>
            <div class="zpanel__row">
                <a-input v-model:value="trialInputs" type="textarea" :rows="2" :placeholder="$t('ext.xeonskyZip.panel.inputsPlaceholder')" class="zpanel__grow" />
                <a-input v-model:value="trialOutArchive" :placeholder="$t('ext.xeonskyZip.panel.outArchivePlaceholder')" class="zpanel__grow" />
                <a-select v-model:value="trialFormat" class="zpanel__pwd" :options="formats.map((f) => ({ value: f.name, label: f.name, disabled: !f.canCreate }))" />
                <a-input v-model:value="trialPasswordNew" :placeholder="$t('ext.xeonskyZip.panel.passwordPlaceholder')" class="zpanel__pwd" />
                <a-button :disabled="!trialOutArchive.trim() || !trialInputs.trim()" @click="tryCompress">
                    {{ $t('ext.xeonskyZip.panel.tryCompress') }}
                </a-button>
            </div>
            <pre v-if="trialOutput" class="zpanel__out">{{ trialOutput }}</pre>
        </div>
    </div>
</template>

<style scoped>
/*
 * 面板纵向撑满剩余高度，只有内部列表滚动（与扩展管理页同一套 flex 链约定，
 * 父级链定义见 styles/settings.css）。本页内容较长，故整体可滚动、卡片各自定高。
 */
.panel {
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
}
.zpanel__bar {
    display: flex;
    align-items: center;
    gap: 12px;
}
.zpanel__head {
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    flex: 0 0 auto;
    margin-right: auto;
}
.zpanel__desc {
    margin-top: -4px;
}
.zpanel__path {
    font-family: var(--el-font-family-mono);
    font-size: 12px;
    word-break: break-all;
}
.zpanel__path--empty {
    color: var(--el-text-color-secondary);
}
.zpanel__muted {
    color: var(--el-text-color-secondary);
    margin-left: 8px;
    font-size: 12px;
}
.zpanel__row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.zpanel__grow {
    flex: 1 1 auto;
    min-width: 120px;
}
.zpanel__pwd {
    flex: 0 0 150px;
}

/* 三张卡片：格式 / 方法并排，功能与试用占满整行。 */
.zpanel__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
}
.zpanel__card {
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    padding: 12px 14px;
    min-width: 0;
}
.zpanel__card--full {
    grid-column: 1 / -1;
}
.zpanel__cardTitle {
    font-weight: 600;
    font-size: 13px;
    color: var(--el-text-color-primary);
    margin-bottom: 8px;
}
.zpanel__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 260px;
    overflow: auto;
}
.zpanel__item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 12px;
    line-height: 1.6;
}
.zpanel__fmt {
    flex: 0 0 auto;
    font-family: var(--el-font-family-mono);
    font-weight: 600;
    color: var(--el-color-primary);
}
.zpanel__fmt--wide {
    min-width: 76px;
}
.zpanel__badges {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 4px;
}
.zpanel__feat {
    flex: 0 0 auto;
    font-weight: 600;
    color: var(--el-text-color-primary);
    min-width: 100px;
}
.zpanel__flag {
    flex: 0 0 auto;
    font-family: var(--el-font-family-mono);
    font-size: 11px;
    color: var(--el-color-warning);
}
.zpanel__note {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--el-text-color-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.zpanel__out {
    margin: 10px 0 0;
    padding: 8px 10px;
    max-height: 180px;
    overflow: auto;
    background: var(--el-fill-color-light);
    border-radius: 4px;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--el-text-color-regular);
}
</style>
