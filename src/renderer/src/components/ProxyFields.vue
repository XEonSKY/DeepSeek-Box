<script setup lang="ts">
import type { ProxyProtocol, ProxyScope } from '@shared/types'
import TagLabel from './TagLabel.vue'

/**
 * 代理字段（启用 / 协议 / 主机 / 端口 / 生效范围）。
 *
 * 抽成独立组件是因为它要同时出现在两处：设置页的「网络」面板，以及首次安装向导的第 0 步。
 * 向导里它不是为了方便——是**必需**：Node / npm / dsh 全都要在线下载，在必须先挂代理才能
 * 出网的环境里，「装完才能配代理」会直接死锁。
 *
 * 字段全部走 defineModel 双向绑定，父组件给 ref（向导）或 reactive state（设置页）都能用；
 * 组件自身不读设置、不落盘，持久化由父组件负责。
 *
 * 这些 a-form-item 依赖父级的 a-form（布局 vertical）提供上下文，父组件里两者都已就位。
 */

const enabled = defineModel<boolean>('enabled', { required: true })
const protocol = defineModel<ProxyProtocol>('protocol', { required: true })
const host = defineModel<string>('host', { required: true })
const port = defineModel<number | null>('port', { required: true })
const scope = defineModel<ProxyScope[]>('scope', { required: true })

/** 代理范围项：顺序即展示顺序，文案键一一对应（见 locales 的 sv.network.scope*）。 */
const SCOPES: Array<{ id: ProxyScope; label: string }> = [
    { id: 'app', label: 'sv.network.scopeApp' },
    { id: 'update', label: 'sv.network.scopeUpdate' },
    { id: 'dsh', label: 'sv.network.scopeDsh' },
    { id: 'npm', label: 'sv.network.scopeNpm' },
    { id: 'node', label: 'sv.network.scopeNode' },
    { id: 'registry', label: 'sv.network.scopeRegistry' }
]

/** 勾选 / 取消一个范围。整组替换而非就地 splice：父组件可能是 ref，替换对 ref 与 reactive 都成立。 */
function toggleScope(s: ProxyScope): void {
    scope.value = scope.value.includes(s) ? scope.value.filter((x) => x !== s) : [...scope.value, s]
}
</script>

<template>
    <a-form-item :label="$t('sv.network.proxy')">
        <a-switch v-model:checked="enabled" />
    </a-form-item>

    <template v-if="enabled">
        <a-form-item :label="$t('sv.network.protocol')">
            <a-radio-group v-model:value="protocol">
                <a-radio-button :value="'http'">{{ $t('sv.network.protocolHttp') }}</a-radio-button>
                <a-radio-button :value="'socks5'">{{ $t('sv.network.protocolSocks') }}</a-radio-button>
            </a-radio-group>
        </a-form-item>

        <div class="pf__row">
            <a-form-item :label="$t('sv.network.host')" class="pf__grow">
                <a-input v-model:value="host" placeholder="127.0.0.1" />
            </a-form-item>
            <a-form-item :label="$t('sv.network.port')" class="pf__port">
                <a-input-number v-model:value="port" :min="1" :max="65535" :controls="false" placeholder="8080" />
            </a-form-item>
        </div>

        <a-form-item :label="$t('sv.network.scope')">
            <div class="pf__scope">
                <a-checkbox
                    v-for="s in SCOPES"
                    :key="s.id"
                    :checked="scope.includes(s.id)"
                    @change="() => toggleScope(s.id)"
                >
                    <TagLabel :label="$t(s.label)" />
                </a-checkbox>
            </div>
            <div class="nf-hint">{{ $t('sv.network.scopeHint') }}</div>
        </a-form-item>
    </template>
</template>

<style scoped>
.pf__row {
    display: flex;
    gap: 12px;
    width: 100%;
}
.pf__grow {
    flex: 1 1 auto;
}
.pf__port {
    width: 170px;
}
.pf__scope {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
}
</style>
