/// <reference types="vite/client" />

import type { RendererApi } from '@shared/api'

declare global {
    interface Window {
        api: RendererApi
    }
}

declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
    export default component
}

export {}
