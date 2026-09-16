<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { CloseOutlined } from '@antdv-next/icons'
import type { ConfirmDialogRequest } from '@shared/types'
import { tt } from '../lib/locales'

/**
 * 独立确认子窗口的内容（无边框）。
 *
 * 载荷由本窗口经 `GET /dialog/confirm/context` 拉取；按钮回传
 * `POST /dialog/confirm/reply`，主进程结算后关闭本窗口。
 * 文案全部由调用方 i18n 后传入，这里只负责呈现与交互。
 *
 * 交互约定：标题行是拖拽区（关窗按钮除外），Enter 确认、Escape / 右上角 × 取消。
 */
const ctx = ref<ConfirmDialogRequest | null>(null)
const busy = ref(false)

async function load(): Promise<void> {
    try {
        ctx.value = await window.api.get('/dialog/confirm/context')
    } catch {
        ctx.value = null
    }
}

/** 回传结果；主进程会关窗，这里对失败静默。 */
async function reply(confirmed: boolean): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
        await window.api.post('/dialog/confirm/reply', { body: { confirmed } })
    } catch {
        /* 主进程多半已关窗，忽略 */
    }
}

/** Enter 确认、Escape 取消（与系统原生对话框一致的操作习惯）。 */
function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') void reply(false)
    else if (e.key === 'Enter') void reply(true)
}

onMounted(() => {
    void load()
    window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
    <div class="cf">
        <!-- 标题行整条是拖拽区（无边框窗口靠它移动）；× 按钮吃回点击 -->
        <header class="cf__head">
            <span class="cf__title">{{ ctx?.title }}</span>
            <button type="button" class="cf__close" :title="tt('msg.cancelBtn')" @click="reply(false)">
                <CloseOutlined />
            </button>
        </header>
        <div class="cf__body">
            <div class="cf__msg">{{ ctx?.message }}</div>
            <div v-if="ctx?.detail" class="cf__detail">{{ ctx.detail }}</div>
        </div>
        <div class="cf__actions">
            <a-button size="large" class="cf__btn" :disabled="busy" @click="reply(false)">
                {{ ctx?.cancelText || tt('msg.cancelBtn') }}
            </a-button>
            <a-button
                size="large"
                class="cf__btn"
                type="primary"
                :danger="ctx?.danger === true"
                :disabled="busy"
                @click="reply(true)"
            >
                {{ ctx?.confirmText || tt('msg.continueBtn') }}
            </a-button>
        </div>
    </div>
</template>

<style scoped>
.cf {
    height: 100vh;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    background: var(--el-bg-color);
    border: 1px solid var(--el-border-color);
    border-radius: 10px;
    overflow: hidden;
}
/* 拖拽区：整条标题行；高度给足，不必去找那条细缝 */
.cf__head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 6px 0 18px;
    -webkit-app-region: drag;
}
.cf__title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cf__close {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 14px;
    cursor: pointer;
    -webkit-app-region: no-drag;
}
.cf__close:hover {
    background: var(--el-fill-color);
    color: var(--el-text-color-primary);
}
.cf__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 0 20px 14px;
}
.cf__msg {
    font-size: 13px;
    line-height: 1.6;
    color: var(--el-text-color-regular);
    white-space: pre-wrap;
}
.cf__detail {
    margin-top: 8px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
    white-space: pre-wrap;
}
/* 大按钮：两枚等宽、撑满整行 */
.cf__actions {
    flex: 0 0 auto;
    display: flex;
    gap: 10px;
    padding: 0 16px 16px;
    -webkit-app-region: no-drag;
}
.cf__actions :deep(.cf__btn) {
    flex: 1 1 0;
    height: 40px;
    font-size: 14px;
}
</style>
