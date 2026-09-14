<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { BgColorsOutlined, BulbOutlined } from '@antdv-next/icons'
import { tt, applyExtTranslation, applyLocaleChange, currentLocale } from '../../lib/locales'
import { COLOR_SCHEMES, isDark, schemeBackgrounds } from '../../lib/theme'
import { useSettingsStore } from './useSettingsStore'
import type { FunLocale, ResolvedLocale } from '@shared/types'

const { state } = useSettingsStore()

const open = ref(['appearance-main'])
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
        await window.api.setUiLocale(l)
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
        const cur = await window.api.getSettings()
        await window.api.saveSettings({ ...cur, ignoreSystemScale: v })
    } catch {
    /* ignore */
    }
    window.api.relaunch()
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
</style>
