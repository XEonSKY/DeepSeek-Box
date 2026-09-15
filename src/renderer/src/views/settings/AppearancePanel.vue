<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { BgColorsOutlined, BulbOutlined, DeleteOutlined, PictureOutlined, PlusOutlined } from '@antdv-next/icons'
import { tt, applyExtTranslation, applyLocaleChange, currentLocale } from '../../lib/locales'
import { COLOR_SCHEMES, isDark, schemeBackgrounds } from '../../lib/theme'
import { useSettingsStore } from './useSettingsStore'
import type { AppIconInfo, FunLocale, ResolvedLocale } from '@shared/types'

const { state } = useSettingsStore()

const open = ref(['appearance-main', 'appearance-icon'])
const ZOOMS = [50, 75, 100, 125, 150, 175, 200]

/**
 * 色块预览要按当前明暗取底色。`isDark` 是从 lib/theme.ts 导入的 ref，
 * 这里包一层本地 computed，模板里的解包就一定成立（否则会把 Ref 对象当 truthy，永远按深色画）。
 */
const dark = computed(() => isDark.value)

// 界面语言单一来源是 dsh settings.yaml 的 locale.preference（zh/en）。
const lang = ref<ResolvedLocale>(currentLocale())
const isZh = computed(() => lang.value === 'zh')

// 当前语言的扩展翻译变体（off + 该语言变体）
const FUN_ZH: FunLocale[] = ['off', 'anime', 'wenyan', 'hant']
const FUN_EN: FunLocale[] = ['off', 'pirate', 'shakespeare']
const funList = computed<FunLocale[]>(() => (isZh.value ? FUN_ZH : FUN_EN))
const funCurrent = computed<FunLocale>(() => (funList.value.includes(state.funLocale) ? state.funLocale : 'off'))

// 选项文案固定（不随当前界面语言变化）
const ZH_LABEL: Record<string, string> = { off: '简体中文', anime: '二次元', wenyan: '文言', hant: '繁体中文' }
const EN_LABEL: Record<string, string> = { off: 'English', pirate: 'Pirate', shakespeare: 'Shakespearean' }
const langOptions = computed(() => [
    { value: 'zh', label: '中文', children: FUN_ZH.map((e) => ({ value: e, label: ZH_LABEL[e] })) },
    { value: 'en', label: 'English', children: FUN_EN.map((e) => ({ value: e, label: EN_LABEL[e] })) }
])
const langCascader = computed<[string, string]>(() => [lang.value, funCurrent.value])
function onLangCascader(path: (string | number)[]): void {
    const [loc, ext] = path.map(String)
    if (loc === 'zh' || loc === 'en') void chooseLang(loc as ResolvedLocale)
    if (ext) state.funLocale = ext as FunLocale
}

async function chooseLang(l: ResolvedLocale): Promise<void> {
    if (lang.value === l) return
    lang.value = l
    // 语言与扩展风格一起应用：风格只对它所属的语言生效（anime/wenyan/hant→zh、pirate/shakespeare→en）
    applyLocaleChange(l, state.funLocale)
    try {
        await window.api.put('/locale', { body: l })
    } catch {
    /* 忽略写盘失败，界面仍即时切换 */
    }
}

// 扩展风格变化即时应用（不切语言时只重铺对应语言的文案目录）。
watch(() => state.funLocale, (v) => applyExtTranslation(v))

// 禁用系统缩放需重启生效：确认→保存并重启；取消→不做任何修改（回退）。
async function onSysScale(v: boolean): Promise<void> {
    if (v === state.ignoreSystemScale) return
    try {
        await ElMessageBox.confirm(tt('sv.appearance.sysScaleText'), tt('sv.appearance.ignoreScale'), {
            confirmButtonText: tt('sv.appearance.restartNow'),
            cancelButtonText: tt('msg.cancelBtn'),
            type: 'warning'
        })
    } catch {
        return // 取消：回退修改（状态未变更）
    }
    state.ignoreSystemScale = v
    try {
        const cur = await window.api.get('/settings')
        await window.api.put('/settings', { body: { ...cur, ignoreSystemScale: v } })
    } catch {
    /* ignore */
    }
    void window.api.post('/app/relaunch')
}

// ---------------------------------------------------------------------------
// 程序图标（内置 Logo + resources/diy 预制 + 用户上传）
// ---------------------------------------------------------------------------

const icons = ref<AppIconInfo[]>([])
const fileInput = ref<HTMLInputElement | null>(null)

/** 拉取图标列表；读不到不影响其它外观设置。 */
async function loadIcons(): Promise<void> {
    try {
        icons.value = await window.api.get('/icons')
    } catch {
    /* 忽略：保持空列表 */
    }
}
onMounted(loadIcons)

/** 选中某个图标：改 state 即触发自动保存，主进程应用后广播预览回来。 */
function chooseIcon(id: string): void {
    state.appIcon = id
}

function pickIconFile(): void {
    fileInput.value?.click()
}

/** 上传：整份读成字节交给主进程（中心裁剪 + 归一化 1024×1024 PNG），完成后自动选中。 */
async function onIconFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // 清空以便连续选同一个文件
    if (!file) return
    try {
        const data = new Uint8Array(await file.arrayBuffer())
        const res = await window.api.post('/icons', { body: { name: file.name, data } })
        icons.value = res.list
        chooseIcon(res.id)
        ElMessage.success(tt('sv.appearance.iconUploaded'))
    } catch {
        ElMessage.error(tt('sv.appearance.iconUploadFail'))
    }
}

/** 删除用户上传的图标；若它正被选中，主进程会一并回退内置 Logo。 */
async function removeIcon(it: AppIconInfo): Promise<void> {
    try {
        await ElMessageBox.confirm(tt('sv.appearance.iconDeleteText', { name: it.name }), tt('sv.appearance.iconDelete'), {
            confirmButtonText: tt('msg.deleteBtn'),
            cancelButtonText: tt('msg.cancelBtn'),
            type: 'warning'
        })
    } catch {
        return // 取消删除
    }
    try {
        // 选中的正是它时先在本地回退内置 Logo：主进程也会落盘回退，但它的 settings:changed 广播
        // 可能落在本窗口的「忽略自保存回放」窗口期内，本地同步一次才不会留下悬空的选中态。
        if (state.appIcon === it.id) state.appIcon = ''
        icons.value = await window.api.delete('/icons/:id', { params: { id: it.id } })
    } catch {
        ElMessage.error(tt('sv.appearance.iconDeleteFail'))
    }
}
</script>

<template>
    <div class="panel">
        <div class="dsh-brand">
            <div class="dsh-brand__icon"><el-icon :size="34"><BgColorsOutlined /></el-icon></div>
            <div class="dsh-brand__txt">
                <div class="dsh-brand__name">{{ $t('sv.nav.appearance') }}</div>
                <div class="dsh-brand__desc">{{ $t('sv.intro.appearance') }}</div>
            </div>
        </div>
        <el-collapse v-model="open">
            <el-collapse-item name="appearance-main">
                <template #title>
                    <div class="sec__title"><el-icon><BulbOutlined /></el-icon> {{ $t('sv.appearance.title') }}</div>
                </template>

                <el-form label-position="top">
                    <el-form-item :label="$t('sv.appearance.theme')">
                        <el-radio-group v-model="state.theme">
                            <el-radio-button :value="'system'">{{ $t('sv.appearance.themeSystem') }}</el-radio-button>
                            <el-radio-button :value="'light'">{{ $t('sv.appearance.themeLight') }}</el-radio-button>
                            <el-radio-button :value="'dark'">{{ $t('sv.appearance.themeDark') }}</el-radio-button>
                        </el-radio-group>
                    </el-form-item>

                    <el-form-item :label="$t('sv.appearance.schemeLabel')">
                        <div class="schemes">
                            <button
                                v-for="s in COLOR_SCHEMES"
                                :key="s.id"
                                type="button"
                                class="scheme"
                                :class="{ 'scheme--on': state.colorScheme === s.id }"
                                :title="$t('sv.appearance.scheme.' + s.id)"
                                @click="state.colorScheme = s.id"
                            >
                                <!-- 三个色块：页面底 / 侧栏底 / 主色 —— 一眼看出背景是否也成套 -->
                                <span class="scheme__chips">
                                    <i class="scheme__chip" :style="{ background: schemeBackgrounds(s.id, dark).page }" />
                                    <i class="scheme__chip" :style="{ background: schemeBackgrounds(s.id, dark).side }" />
                                    <i class="scheme__chip" :style="{ background: s.primary }" />
                                </span>
                                <span class="scheme__name">{{ $t('sv.appearance.scheme.' + s.id) }}</span>
                            </button>
                        </div>
                        <div class="hint">{{ $t('sv.appearance.schemeHint') }}</div>
                    </el-form-item>

                    <el-form-item :label="$t('sv.appearance.zoom')">
                        <el-select v-model="state.zoomPercent" class="zoom-sel">
                            <el-option v-for="z in ZOOMS" :key="z" :label="z + '%'" :value="z" />
                        </el-select>
                        <div class="hint">{{ $t('sv.appearance.zoomHint') }}</div>
                    </el-form-item>

                    <el-form-item :label="$t('sv.appearance.ignoreScale')">
                        <el-switch :model-value="state.ignoreSystemScale" @update:model-value="onSysScale" />
                        <div class="hint">{{ $t('sv.appearance.ignoreScaleHint') }}</div>
                    </el-form-item>

                    <el-form-item :label="$t('sv.appearance.language')">
                        <el-cascader
                            :options="langOptions"
                            :model-value="langCascader"
                            class="lang-casc"
                            :placeholder="$t('sv.appearance.language')"
                            @change="onLangCascader"
                        />
                        <div class="hint">{{ $t('sv.appearance.funHint') }}</div>
                    </el-form-item>
                </el-form>
            </el-collapse-item>

            <el-collapse-item name="appearance-icon">
                <template #title>
                    <div class="sec__title"><el-icon><PictureOutlined /></el-icon> {{ $t('sv.appearance.iconTitle') }}</div>
                </template>

                <div class="hint">{{ $t('sv.appearance.iconHint') }}</div>
                <div class="icons">
                    <button
                        v-for="it in icons"
                        :key="it.id"
                        type="button"
                        class="icon-cell"
                        :class="{ 'icon-cell--on': state.appIcon === it.id }"
                        :title="it.source === 'default' ? $t('sv.appearance.iconDefault') : it.name"
                        @click="chooseIcon(it.id)"
                    >
                        <img class="icon-cell__img" :src="it.dataUrl" alt="" />
                        <span class="icon-cell__name">{{ it.source === 'default' ? $t('sv.appearance.iconDefault') : it.name }}</span>
                        <span
                            v-if="it.source === 'user'"
                            class="icon-cell__del"
                            :title="$t('sv.appearance.iconDelete')"
                            @click.stop="removeIcon(it)"
                        >
                            <DeleteOutlined />
                        </span>
                    </button>

                    <!-- 上传入口：点开系统文件选择框，图标由主进程归一化后存到配置目录 -->
                    <button type="button" class="icon-cell icon-cell--add" @click="pickIconFile">
                        <span class="icon-cell__add"><PlusOutlined /></span>
                        <span class="icon-cell__name">{{ $t('sv.appearance.iconUpload') }}</span>
                    </button>
                </div>
                <input
                    ref="fileInput"
                    class="icon-file"
                    type="file"
                    accept="image/png,image/jpeg"
                    @change="onIconFile"
                />
            </el-collapse-item>
        </el-collapse>
    </div>
</template>

<style scoped>
.zoom-sel {
  width: 220px;
}
.lang-casc {
  width: 100%;
}

/* ---- 配色方案色板 ---- */
.schemes {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  width: 100%;
}
.scheme {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.scheme:hover {
  border-color: var(--el-color-primary);
}
.scheme--on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.scheme:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
/* 三个色块并排：页面底 / 侧栏底 / 主色 */
.scheme__chips {
  display: flex;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--el-border-color-lighter);
}
.scheme__chip {
  width: 16px;
  height: 16px;
  display: block;
}
.scheme__name {
  white-space: nowrap;
}

/* ---- 程序图标选择器 ---- */
.icons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}
.icon-cell {
  position: relative;
  width: 88px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-regular);
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.icon-cell:hover {
  border-color: var(--el-color-primary);
}
.icon-cell--on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}
.icon-cell:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.icon-cell__img {
  width: 44px;
  height: 44px;
  object-fit: contain;
  border-radius: 8px;
}
.icon-cell__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 删除按钮只在悬停该图标时出现；只对用户上传的图标渲染 */
.icon-cell__del {
  position: absolute;
  top: 2px;
  right: 2px;
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--el-color-danger);
  color: #fff;
  font-size: 10px;
}
.icon-cell:hover .icon-cell__del {
  display: flex;
}
.icon-cell--add {
  border-style: dashed;
  color: var(--el-text-color-secondary);
}
.icon-cell__add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  font-size: 22px;
}
.icon-file {
  display: none;
}
</style>
