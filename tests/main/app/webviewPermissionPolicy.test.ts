import { describe, expect, it } from 'vitest'
import {
    PermissionMemory,
    checkPermission,
    decidePermission,
    isTrustedRequestingUrl,
    originOf,
    permissionKindKey
} from '@main/app/webviewPermissionPolicy'

/**
 * 内嵌页面权限策略。
 *
 * 这里守的是「标签页里是任意站点」这条前提：外部站点不得静默拿到摄像头、麦克风、位置与
 * 本机设备，而**本地界面（dsh 跑在 127.0.0.1 上）必须照常可用** —— 一刀切拒绝会砸掉 dsh
 * 自己的语音输入这类真实功能（官方 desktop 是对它的受控内嵌浏览器全拒，dsbox 是通用外壳，
 * 不能照搬）。任何一条判定放宽，都等于把一个能力交给任意网页，所以逐档钉死。
 */

describe('isTrustedRequestingUrl', () => {
    it('回环地址与外壳自带页面算可信', () => {
        const trusted = [
            'http://127.0.0.1:5173/?token=abc',
            'http://localhost:3000/',
            'https://localhost/',
            'http://[::1]:8080/',
            'file:///C:/Program%20Files/app/index.html',
            'app://dsh/index.html'
        ]
        for (const url of trusted) expect(isTrustedRequestingUrl(url), url).toBe(true)
    })

    it('外部站点不算可信（含「名字里带 localhost」的域名）', () => {
        const untrusted = [
            'https://example.com/',
            'https://localhost.evil.com/',
            'https://127.0.0.1.evil.com/',
            'https://evil.com/?next=http://localhost:5173/',
            'about:blank',
            '',
            'not a url'
        ]
        for (const url of untrusted) expect(isTrustedRequestingUrl(url), url).toBe(false)
    })
})

describe('decidePermission', () => {
    const external = 'https://example.com/page'

    it('可信来源一律放行（dsh 界面就跑在回环地址上）', () => {
        for (const permission of ['media', 'geolocation', 'usb', 'notifications']) {
            expect(decidePermission(permission, 'http://127.0.0.1:4321/'), permission).toBe('grant')
        }
    })

    it('外部站点的设备与隐私类权限要问用户', () => {
        for (const permission of ['media', 'geolocation', 'notifications', 'midi', 'midiSysex']) {
            expect(decidePermission(permission, external), permission).toBe('ask')
        }
    })

    it('外部站点的常规浏览权限直接放行', () => {
        for (const permission of [
            'clipboard-read',
            'clipboard-sanitized-write',
            'fullscreen',
            'keyboardLock',
            'local-fonts',
            'mediaKeySystem',
            'pointerLock',
            'speaker-selection',
            'storage-access',
            'top-level-storage-access',
            'background-sync'
        ]) {
            expect(decidePermission(permission, external), permission).toBe('grant')
        }
    })

    it('外部站点触碰本机设备 / 录屏 / 拉起的权限一律拒绝', () => {
        for (const permission of [
            'hid',
            'serial',
            'usb',
            'display-capture',
            'fileSystem',
            'idle-detection',
            'openExternal',
            'window-management'
        ]) {
            expect(decidePermission(permission, external), permission).toBe('deny')
        }
    })

    it('未列入名单的权限（含将来新出现的）按拒绝处理', () => {
        for (const permission of ['payment-handler', 'digital-credentials-get', 'some-future-permission']) {
            expect(decidePermission(permission, external), permission).toBe('deny')
        }
    })

    it('拿不到来源时按外部站点处理', () => {
        expect(decidePermission('media', '')).toBe('ask')
        expect(decidePermission('usb', '')).toBe('deny')
        expect(decidePermission('fullscreen', '')).toBe('grant')
    })
})

describe('permissionKindKey', () => {
    it('media 按媒体类型细分文案', () => {
        expect(permissionKindKey('media', ['audio'])).toBe('microphone')
        expect(permissionKindKey('media', ['video'])).toBe('camera')
        expect(permissionKindKey('media', ['audio', 'video'])).toBe('cameraMic')
    })

    it('给不出媒体类型时按「摄像头与麦克风」', () => {
        expect(permissionKindKey('media')).toBe('cameraMic')
        expect(permissionKindKey('media', [])).toBe('cameraMic')
    })

    it('其它权限映射到各自文案键，未知权限回落到 unknown', () => {
        expect(permissionKindKey('geolocation')).toBe('location')
        expect(permissionKindKey('notifications')).toBe('notifications')
        expect(permissionKindKey('midiSysex')).toBe('midi')
        expect(permissionKindKey('whatever')).toBe('unknown')
    })
})

describe('originOf', () => {
    it('取来源（忽略路径与查询串）；非法地址返回空串', () => {
        expect(originOf('https://a.example.com/x?y=1')).toBe('https://a.example.com')
        expect(originOf('http://127.0.0.1:5173/?token=x')).toBe('http://127.0.0.1:5173')
        expect(originOf('nope')).toBe('')
    })
})

describe('checkPermission（同步查询路径）', () => {
    const memory = new PermissionMemory()

    it('直接放行 / 直接拒绝的权限照常回答', () => {
        expect(checkPermission('fullscreen', 'https://example.com/', memory)).toBe(true)
        expect(checkPermission('usb', 'https://example.com/', memory)).toBe(false)
    })

    it('「该问用户」的权限在没问过时回答 false（不泄露设备信息）', () => {
        expect(checkPermission('media', 'https://example.com/', memory)).toBe(false)
    })

    it('用户同意过就回答 true，拒绝过仍是 false', () => {
        memory.remember('https://example.com', 'media', true)
        expect(checkPermission('media', 'https://example.com/other', memory)).toBe(true)

        memory.remember('https://denied.example', 'media', false)
        expect(checkPermission('media', 'https://denied.example/', memory)).toBe(false)
    })

    it('记住的选择按来源隔离，不会外溢到别的站点', () => {
        memory.remember('https://one.example', 'notifications', true)
        expect(checkPermission('notifications', 'https://one.example/', memory)).toBe(true)
        expect(checkPermission('notifications', 'https://two.example/', memory)).toBe(false)
    })

    it('clear 后回到「没问过」', () => {
        const m = new PermissionMemory()
        m.remember('https://x.example', 'geolocation', true)
        expect(m.recall('https://x.example', 'geolocation')).toBe(true)
        m.clear()
        expect(m.recall('https://x.example', 'geolocation')).toBeUndefined()
        expect(checkPermission('geolocation', 'https://x.example/', m)).toBe(false)
    })
})
