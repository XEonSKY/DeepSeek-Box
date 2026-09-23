import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { PATCH_FILENAME } from '@main/dsh/cordisPatch'
import {
    DSH_PROFILE,
    bundleRoots,
    dshHomeDir,
    homePatchFile,
    hostProfileDir,
    nodeModulesRootOf,
    profileDir,
    profileManifestFile,
    profilePatchFile,
    profilesRoot
} from '@main/dsh/dshHome'

/**
 * dsh harness home 与 profile 的路径计算。
 *
 * 这些路径决定了 Box 到底读写哪一份配置，写错就是「设置改了不生效」或者
 * 「把用户的配置写到别的地方去了」，所以按 dsh 的目录约定逐条钉住。
 *
 * home 的解析语义**对齐 dsh 自己的 `resolveDshHome`**（`@deepseek-ai/dsh-home-paths`）：
 * 空白覆盖视为未设置、支持 `~` 展开、结果规范化成绝对路径。期望值一律用 path.resolve /
 * path.join 构造，避免在 Windows 上被盘符与分隔符差异绊倒。
 */

afterEach(() => {
    vi.unstubAllEnvs()
})

/** 平台无关的绝对路径基准（os.tmpdir 在两端都是绝对路径）。 */
const TMP_HOME = path.join(os.tmpdir(), 'dsh-test-home')

describe('dshHomeDir', () => {
    it('$DSH_HOME 优先，并规范化成绝对路径', () => {
        vi.stubEnv('DSH_HOME', TMP_HOME)
        expect(dshHomeDir()).toBe(path.resolve(TMP_HOME))
    })

    it('未设置时回落 ~/.dsh', () => {
        delete process.env.DSH_HOME
        expect(dshHomeDir()).toBe(path.resolve(os.homedir(), '.dsh'))
    })

    it('空串 / 纯空白都视为未设置 —— 否则 home 会被解析成当前工作目录', () => {
        for (const blank of ['', '   ', '\t']) {
            vi.stubEnv('DSH_HOME', blank)
            expect(dshHomeDir(), JSON.stringify(blank)).toBe(path.resolve(os.homedir(), '.dsh'))
        }
    })

    it('展开 ~ / ~/ / ~\\ 前缀（不展开会得到字面量波浪号路径，读写全部落空）', () => {
        vi.stubEnv('DSH_HOME', '~')
        expect(dshHomeDir()).toBe(path.resolve(os.homedir()))

        // path.join('~', 'myhome') 在本平台给出 `~/myhome` 或 `~\myhome`，两种前缀都要认
        vi.stubEnv('DSH_HOME', path.join('~', 'myhome'))
        expect(dshHomeDir()).toBe(path.resolve(path.join(os.homedir(), 'myhome')))

        vi.stubEnv('DSH_HOME', '~\\myhome')
        expect(dshHomeDir()).toBe(path.resolve(path.join(os.homedir(), 'myhome')))
    })

    it('只有开头的 ~ 前缀会被展开，路径中间的不动', () => {
        const odd = path.join(TMP_HOME, '~not-a-prefix')
        vi.stubEnv('DSH_HOME', odd)
        expect(dshHomeDir()).toBe(path.resolve(odd))
    })
})

describe('目录与文件位置', () => {
    it('home patch 在 home 根目录下', () => {
        vi.stubEnv('DSH_HOME', TMP_HOME)
        expect(homePatchFile()).toBe(path.join(TMP_HOME, PATCH_FILENAME))
    })

    it('profiles 根与单个 profile 目录', () => {
        vi.stubEnv('DSH_HOME', TMP_HOME)
        expect(profilesRoot()).toBe(path.join(TMP_HOME, 'profiles'))
        expect(profileDir('tui')).toBe(path.join(TMP_HOME, 'profiles', 'tui'))
    })

    it('profile 的 patch 与清单文件', () => {
        vi.stubEnv('DSH_HOME', TMP_HOME)
        expect(profilePatchFile('tui')).toBe(path.join(TMP_HOME, 'profiles', 'tui', PATCH_FILENAME))
        expect(profileManifestFile('tui')).toBe(path.join(TMP_HOME, 'profiles', 'tui', 'package.json'))
    })

    it('不传 profile 名时用 Box 承载的那个 profile', () => {
        vi.stubEnv('DSH_HOME', TMP_HOME)
        expect(DSH_PROFILE).toBe('web')
        expect(hostProfileDir()).toBe(profileDir(DSH_PROFILE))
        expect(profilePatchFile()).toBe(path.join(TMP_HOME, 'profiles', 'web', PATCH_FILENAME))
        expect(profileManifestFile()).toBe(path.join(TMP_HOME, 'profiles', 'web', 'package.json'))
    })

    it('bundle 查找根：先 dsh 安装目录，再 profile 的 node_modules', () => {
        vi.stubEnv('DSH_HOME', TMP_HOME)
        expect(bundleRoots('/opt/dsh/node_modules')).toEqual([
            '/opt/dsh/node_modules',
            path.join(TMP_HOME, 'profiles', 'web', 'node_modules')
        ])
    })

    it('拿不到 dsh 安装目录时只剩 profile 的 node_modules', () => {
        vi.stubEnv('DSH_HOME', TMP_HOME)
        expect(bundleRoots(null)).toEqual([path.join(TMP_HOME, 'profiles', 'web', 'node_modules')])
    })
})

describe('nodeModulesRootOf', () => {
    // 这条曾经写错：@deepseek-ai/dsh 是 scoped 包，只取一次父目录会停在 `.../node_modules/@deepseek-ai`，
    // 于是 bundle 路径多一层、bundle 层全部解析不到 —— 模型页显示「共 0 个供应商」。
    it('scoped 包（@scope/pkg）要去掉「包名 + scope」两层', () => {
        const dir = path.join('/opt/app', 'node_modules', '@deepseek-ai', 'dsh')
        expect(nodeModulesRootOf(dir)).toBe(path.join('/opt/app', 'node_modules'))
    })

    it('普通包名只去掉一层', () => {
        const dir = path.join('/opt/app', 'node_modules', 'some-pkg')
        expect(nodeModulesRootOf(dir)).toBe(path.join('/opt/app', 'node_modules'))
    })

    it('嵌套 node_modules 取最后一段（内层优先）', () => {
        const dir = path.join('/opt/app', 'node_modules', 'a', 'node_modules', '@s', 'b')
        expect(nodeModulesRootOf(dir)).toBe(path.join('/opt/app', 'node_modules', 'a', 'node_modules'))
    })

    it('路径里没有 node_modules 时退化成父目录', () => {
        const dir = path.join('/opt', 'dsh')
        expect(nodeModulesRootOf(dir)).toBe(path.dirname(dir))
    })

    it('Box 安装的真实形态', () => {
        const root = path.join('/home/u/.dsbox/dev', 'dsh', '0.1.7-rc.1')
        expect(nodeModulesRootOf(path.join(root, 'node_modules', '@deepseek-ai', 'dsh'))).toBe(path.join(root, 'node_modules'))
    })
})
