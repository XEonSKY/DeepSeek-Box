import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { parse } from 'yaml'
import {
    HOME_PATCH_FILENAME,
    isValidNodeExecutable,
    mergePtcNodePatch,
    pickPtcNode
} from '@main/dsh/ptcNode'
import type { NodeCandidate } from '@main/dsh/ptcNode'

/**
 * PTC（run_code）worker 的可执行文件选择。
 *
 * 「用 Electron 自带 Node」已移除：dsh 一律由真 node 启动，候选里不再有
 * electron.exe。这里守的是「候选按调用方排好的优先级，取第一个」这条约定。
 */

/** 造一个候选。 */
function cand(from: NodeCandidate['from'], exec: string): NodeCandidate {
    return { from, exec }
}

describe('pickPtcNode', () => {
    it('取第一个候选（优先级由调用方排好）', () => {
        const picked = pickPtcNode([
            cand('DSH_NODE', 'C:/a/node.exe'),
            cand('runtime-system', 'C:/b/node.exe')
        ])
        expect(picked?.exec).toBe('C:/a/node.exe')
    })

    it('只有一个候选时返回它', () => {
        const picked = pickPtcNode([cand('deployed', 'C:/n/node.exe')])
        expect(picked?.from).toBe('deployed')
    })

    it('空候选返回 null（没有真 node，dsh 本身也起不来）', () => {
        expect(pickPtcNode([])).toBeNull()
    })
})

describe('isValidNodeExecutable', () => {
    it('接受当前平台的绝对路径', () => {
        // path.isAbsolute 是平台相关的：Windows 盘符路径在 Linux 上**不是**绝对路径，
        // 断言必须跟随平台，否则 CI（ubuntu）必红。用 path.resolve 造当前平台的绝对路径。
        expect(isValidNodeExecutable(path.resolve('node.exe'))).toBe(true)
        // POSIX 绝对路径在 Windows 上也判为绝对（root-relative），两端都成立。
        expect(isValidNodeExecutable('/usr/local/bin/node')).toBe(true)
        // 盘符路径只在 Windows 上是绝对路径。
        expect(isValidNodeExecutable('C:\\Program Files\\nodejs\\node.exe')).toBe(process.platform === 'win32')
    })

    it('拒绝空值与相对路径（dsh 侧会借此提前失败）', () => {
        expect(isValidNodeExecutable('')).toBe(false)
        expect(isValidNodeExecutable(null)).toBe(false)
        expect(isValidNodeExecutable(undefined)).toBe(false)
        expect(isValidNodeExecutable('node.exe')).toBe(false)
        expect(isValidNodeExecutable('./node')).toBe(false)
    })
})

describe('mergePtcNodePatch', () => {
    /** 从 patch 文本里读回 ptc-runtime 的 nodeExecutable。 */
    function readExec(text: string): string | undefined {
        const rows = parse(text) as Array<{ id?: string; config?: Record<string, unknown> }> | null
        return rows?.find((r) => r.id === 'ptc-runtime')?.config?.nodeExecutable as string | undefined
    }

    it('空文件时生成只含 ptc-runtime 的 patch，且以换行结尾', () => {
        const yaml = mergePtcNodePatch('', 'C:/nodejs/node.exe')
        expect(yaml).toContain('- id: ptc-runtime')
        expect(readExec(yaml)).toBe('C:/nodejs/node.exe')
        expect(yaml.endsWith('\n')).toBe(true)
    })

    it('文件里没有 ptc-runtime 时追加一条，不动已有条目', () => {
        const yaml = mergePtcNodePatch('- id: my-plugin\n  config:\n    keep: true\n', 'C:/nodejs/node.exe')
        expect(yaml).toContain('- id: my-plugin')
        expect(yaml).toContain('keep: true')
        expect(readExec(yaml)).toBe('C:/nodejs/node.exe')
    })

    it('已有 ptc-runtime 时原地更新，保留同一条目的其它字段与注释', () => {
        const before = [
            '# 用户自己的 patch',
            '- id: ptc-runtime',
            '  config:',
            '    nodeExecutable: "old.exe"',
            '    timeoutMs: 60000',
            ''
        ].join('\n')
        const yaml = mergePtcNodePatch(before, 'C:/nodejs/node.exe')
        expect(yaml).toContain('# 用户自己的 patch')
        expect(readExec(yaml)).toBe('C:/nodejs/node.exe')
        expect(yaml).toContain('timeoutMs: 60000')
    })

    it('幂等：同一值再合并一次文本不变（不触发 dsh 文件监听）', () => {
        const once = mergePtcNodePatch('', 'C:/nodejs/node.exe')
        expect(mergePtcNodePatch(once, 'C:/nodejs/node.exe')).toBe(once)
    })

    it('含空格 / 反斜杠 / 单引号的路径往返后仍是原值', () => {
        const paths = ['C:\\Program Files\\nodejs\\node.exe', "/tmp/it's/node", 'C:\\a b\\c\\node.exe']
        for (const exec of paths) {
            expect(readExec(mergePtcNodePatch('', exec))).toBe(exec)
        }
    })
})

describe('constants', () => {
    it('patch 文件名是 dsh 认的 cordis.patch.yml', () => {
        expect(HOME_PATCH_FILENAME).toBe('cordis.patch.yml')
    })
})
