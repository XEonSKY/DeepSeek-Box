import { onBeforeUnmount, ref } from 'vue'

/**
 * 顶部加载进度条的「模拟进度」状态机。
 *
 * Chromium 的 `<webview>` 只给 `did-start-loading` / `did-stop-loading` 两个端点，没有真实
 * 百分比，因此这里像 nprogress 一样做缓动爬升：开始时一下涨到 8% 左右，加载期间按时间逐步
 * 逼近 90%（越接近越慢），结束时补满到 100% 再淡出。这样长页面有持续反馈，短页面也不会
 * 长时间停在 0%。
 *
 * 只负责数值与显示状态，颜色 / 位置等样式在 WebHost.vue 里；调用方在「开始 / 结束」两个
 * 时机各调一次 `start()` / `done()` 即可，重复调用是幂等的。
 */

/** 开始后停留的初始百分比：立刻可见，避免出现「什么都没发生」的空窗。 */
const MIN_PERCENT = 8
/** 加载中允许爬升到的上限：不到真正结束绝不走满，否则进度条会「先到头再等」。 */
const MAX_PERCENT = 90
/** 爬升节拍与每拍逼近剩余距离的比例（配合 CSS width 过渡呈现连续动画）。 */
const TICK_MS = 150
const EASE = 0.12
/** 补满 100% 后停留多久再淡出，给宽度动画留时间。 */
const FINISH_HOLD_MS = 300

export function useLoadProgress() {
    /** 进度条是否可见。 */
    const active = ref(false)
    /** 当前百分比（0–100），宽度由它驱动。 */
    const percent = ref(0)

    let tickTimer: number | null = null
    let finishTimer: number | null = null

    /** 清掉所有待执行定时器（开始 / 结束 / 卸载时都要用）。 */
    function clearTimers(): void {
        if (tickTimer !== null) {
            window.clearInterval(tickTimer)
            tickTimer = null
        }
        if (finishTimer !== null) {
            window.clearTimeout(finishTimer)
            finishTimer = null
        }
    }

    /** 某个（激活的）webview 开始加载。已经在爬升时不重置，避免重定向把它打回起点。 */
    function start(): void {
        if (finishTimer !== null) {
            // 上一轮刚补满、还在淡出：取消收尾，直接进入新一轮
            window.clearTimeout(finishTimer)
            finishTimer = null
        }
        if (tickTimer === null) {
            tickTimer = window.setInterval(() => {
                const remain = MAX_PERCENT - percent.value
                if (remain <= 0) return
                percent.value = Math.min(MAX_PERCENT, percent.value + remain * EASE + 0.4)
            }, TICK_MS)
        }
        if (!active.value || percent.value >= 100) percent.value = MIN_PERCENT
        active.value = true
    }

    /** 加载结束（成功 / 失败都算）：补满、淡出、归零。未在显示时是空操作。 */
    function done(): void {
        if (!active.value) return
        clearTimers()
        percent.value = 100
        finishTimer = window.setTimeout(() => {
            finishTimer = null
            active.value = false
            percent.value = 0
        }, FINISH_HOLD_MS)
    }

    onBeforeUnmount(clearTimers)

    return { active, percent, start, done }
}
