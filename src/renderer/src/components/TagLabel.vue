<script setup lang="ts">
import { computed } from 'vue'
import { splitTag } from '../lib/tagLabel'

/**
 * 设置页短标签：把「主文案（限定语）」渲染成「主文案 + a-tag」。
 *
 * 用法：`<TagLabel :label="$t('sv.system.autoLaunch')" />`。
 * 拆分规则见 lib/tagLabel.ts；没有结尾括号时与直接渲染文案等价。
 * 本地组件不参与自动导入（electron.vite.config.ts 的 dirs 为空），需显式 import。
 */
const props = defineProps<{ label: string }>()

const parts = computed(() => splitTag(props.label))
</script>

<template>
    <span class="tag-label">{{ parts.text }}<a-tag v-if="parts.tag" class="tag-label__tag">{{ parts.tag }}</a-tag></span>
</template>

<style scoped>
.tag-label__tag {
    margin-inline-start: 6px;
}
</style>
