<script setup lang="ts">
import { useRouter } from 'vue-router'
import DshWizard from '../components/DshWizard.vue'
import { dshMissing } from '../shell/state'

/**
 * 初始化页（DeepSeek Harness 安装向导）。
 *
 * 与设置页同级：同样是 web 视图之上的覆盖层，进入时 webview 仍保活（`.web-base` 常驻不卸载）；
 * **顶部与底部是全局 TitleBar / StatusBar** —— 页面本身不再自带标题栏与窗口按钮（向导的步骤条
 * 放在页面底部，见 DshWizard.vue 的 `.wiz-footbar`）。
 * 它**不是强制流程** —— 用户可以随时切走（去设置、去别的标签页）；只有当他身处 dsh 页面时，
 * App.vue 才会把他送回来（见 App.vue 里那段 watch），所以初始化不会再锁死窗口。
 */
const router = useRouter()

/** 安装完成：重新确认一次状态，然后回到 dsh 页面。 */
async function done(): Promise<void> {
    try {
        dshMissing.value = !(await window.api.get('/dsh/installed'))
    } catch {
        // 状态查不到时按「已就绪」处理，避免把用户又弹回初始化页
        dshMissing.value = false
    }
    void router.push('/')
}
</script>

<template>
    <DshWizard @done="done" />
</template>
