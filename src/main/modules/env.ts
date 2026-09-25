import type { InstallKind, InstalledVersions } from '@shared/types'
import type { NodeDeployProgress, OperationProgress } from '@shared/types'
import { defineModule } from '../kernel/module'
import { broadcast } from '../kernel/runtime'
import { trackedOperation, cancelActive } from '../kernel/operations'
import { loadSettings, normalizeNpmSource } from '../app/settings'
import {
    listInstalledDshVersions,
    useDshVersion,
    removeInstalledDshVersion
} from '../dsh/manage'
import { findSystemNode, findSystemNpm, nodeVersionOf, localNodeExecPath } from '../dsh/tools'
import { deployLocalNode, listNodeVersions, nodeStatus, listInstalledNodeVersions, useNodeVersion, removeInstalledNodeVersion } from '../dsh/nodeenv'
import { listNpmVersions, npmStatus, updateNpm, ensureBundledNpmReady, listInstalledNpmVersions, useNpmVersion, removeInstalledNpmVersion } from '../dsh/npmRunner'
import { listPnpmVersions, pnpmStatus, updatePnpm, ensureBundledPnpmReady, listInstalledPnpmVersions, usePnpmVersion, removeInstalledPnpmVersion } from '../dsh/pnpmRunner'
import { measureRegistrySpeed } from '../dsh/speed'

/** 进度广播落点。 */
const emitProgress = (channel: string, payload: OperationProgress | NodeDeployProgress): void => broadcast(channel, payload as never)

/** 版本化安装对象（node / npm / pnpm / dsh）的入参校验。 */
function asInstallKind(v: unknown): InstallKind | null {
    return v === 'node' || v === 'npm' || v === 'pnpm' || v === 'dsh' ? v : null
}

/** 已安装 / 生效的版本列表。 */
function versionsFor(kind: InstallKind): InstalledVersions {
    if (kind === 'node') return listInstalledNodeVersions()
    if (kind === 'npm') return listInstalledNpmVersions()
    if (kind === 'pnpm') return listInstalledPnpmVersions()
    return listInstalledDshVersions()
}

/**
 * 运行环境与包管理器：Node / npm / pnpm 的状态、版本列表、下载部署、生效切换与删除，
 * 以及 registry 测速与安装取消。
 *
 * 这四条链路（node / npm / pnpm / 插件）共用 `trackedOperation`：进度进注册表（切页可恢复）
 * 且按 kind 分流广播（不串台）。取消走 kernel 的单活动令牌集合。
 */
export default defineModule({
    id: 'env',
    routes: {
        GET: {
            '/env': async () => {
                const nodePath = findSystemNode()
                const localPath = localNodeExecPath()
                return {
                    platform: process.platform,
                    arch: process.arch,
                    node: { present: !!nodePath, version: nodePath ? await nodeVersionOf(nodePath) : null },
                    npm: !!findSystemNpm(),
                    local: { present: !!localPath, version: localPath ? await nodeVersionOf(localPath) : null }
                }
            },
            '/node/status': () => nodeStatus(),
            '/node/versions': ({ query }) => listNodeVersions(query?.includeNonLts === true),
            '/npm/status': () => npmStatus(),
            '/npm/versions': ({ query }) => listNpmVersions(loadSettings(), query?.prerelease === true),
            '/pnpm/status': () => pnpmStatus(),
            '/pnpm/versions': ({ query }) => listPnpmVersions(loadSettings(), query?.prerelease === true),
            '/versions/:kind': ({ params }) => {
                const kind = asInstallKind(params.kind)
                return kind ? versionsFor(kind) : { installed: [], active: null }
            }
        },
        POST: {
            '/registries/speed': () => measureRegistrySpeed(),
            '/installs/cancel': () => cancelActive(),
            '/node/deploy': ({ body }) => {
                const version = typeof body?.version === 'string' && body.version ? body.version : undefined
                return trackedOperation('node', emitProgress, (onProgress) => deployLocalNode(onProgress, version))
            },
            '/npm/update': ({ body }) =>
                trackedOperation('npm', emitProgress, (onProgress) =>
                    updateNpm(
                        {
                            source: normalizeNpmSource(body?.source),
                            version: typeof body?.version === 'string' && body.version ? body.version : undefined
                        },
                        onProgress
                    )
                ),
            '/npm/ensure': ({ body }) =>
                trackedOperation('npm', emitProgress, (onProgress) =>
                    ensureBundledNpmReady(
                        { version: typeof body?.version === 'string' && body.version ? body.version : undefined },
                        onProgress
                    )
                ),
            // pnpm（dsh 插件安装用；来源同 npm 一样可选：系统自带 / 内置）
            '/pnpm/update': ({ body }) =>
                trackedOperation('pnpm', emitProgress, (onProgress) =>
                    updatePnpm(
                        {
                            source: body?.source === 'system' ? 'system' : 'bundled',
                            version: typeof body?.version === 'string' && body.version ? body.version : undefined
                        },
                        onProgress
                    )
                ),
            '/pnpm/ensure': ({ body }) =>
                trackedOperation('pnpm', emitProgress, (onProgress) =>
                    ensureBundledPnpmReady(
                        { version: typeof body?.version === 'string' && body.version ? body.version : undefined },
                        onProgress
                    )
                )
        },
        PUT: {
            '/versions/:kind/active': ({ params, body }) => {
                const kind = asInstallKind(params.kind)
                const version = body?.version
                if (!kind || typeof version !== 'string' || !version) return { ok: false, message: '参数不合法', version: null }
                if (kind === 'node') return useNodeVersion(version)
                if (kind === 'npm') return useNpmVersion(version)
                if (kind === 'pnpm') return usePnpmVersion(version)
                return useDshVersion(version)
            }
        },
        DELETE: {
            '/versions/:kind/:version': ({ params }) => {
                const kind = asInstallKind(params.kind)
                const version = params.version
                if (!kind || !version) return { ok: false, message: '参数不合法', version: null }
                if (kind === 'node') return removeInstalledNodeVersion(version)
                if (kind === 'npm') return removeInstalledNpmVersion(version)
                if (kind === 'pnpm') return removeInstalledPnpmVersion(version)
                return removeInstalledDshVersion(version)
            }
        }
    }
})
