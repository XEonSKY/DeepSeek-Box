import os from 'node:os'
import path from 'node:path'
import { PATCH_FILENAME } from './cordisPatch'

/**
 * dsh 的 **harness home** 与 **profile** 位置（纯路径计算，不碰 fs、不 import electron）。
 *
 * 0.1.7 起的目录约定（见 dsh 的 `dsh-home-paths` / `dsh-app-boot/profile`）：
 *
 * ```
 * $DSH_HOME/                       # 默认 ~/.dsh
 *   cordis.patch.yml               # home 级 patch 层：对所有 profile 生效，优先级最高
 *   .credentials.yaml              # 凭据（密钥不出主进程）
 *   profiles/<name>/
 *     package.json                 # 清单：dsh.profile.bundles 有序组合包列表
 *     cordis.patch.yml             # 该 profile 的用户 patch 层（dsh UI 也写这里）
 *     cordis.yml                   # profile 根（空列表，永远不要手改）
 * ```
 *
 * 组合顺序（低 → 高）：bundle 层 → profile 的 `cordis.patch.yml` → home 的
 * `cordis.patch.yml` → `--patch` 覆盖层。**home 层压过 profile 层**，所以 Box 只在
 * home 层写「全局覆盖」（如 ptc-runtime 的 nodeExecutable），用户可见的偏好
 * （主题 / 语言）必须写 profile 层，否则 dsh 自己的设置表单会因被覆盖而拒绝写入。
 */

/** Box 启动 dsh 时使用的 profile：命令行 `dsh web` 等价于 `dsh --profile web`。 */
export const DSH_PROFILE = 'web'

/**
 * 展开 `~` / `~/` / `~\` 前缀（与 dsh 的 `dsh-home-paths` 同一套语义）。
 * 不展开的话，用户写 `DSH_HOME=~/myhome` 会得到一个字面量波浪号路径，全部读写都会落空。
 */
function expandHomePath(p: string): string {
    if (p === '~') return os.homedir()
    if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
    return p
}

/**
 * dsh harness home：`$DSH_HOME`，未设置时 `~/.dsh`。
 *
 * 语义对齐 dsh 自己的 `resolveDshHome`（`@deepseek-ai/dsh-home-paths`）：
 *  - **空串 / 纯空白视为未设置** —— 否则一个空覆盖会把 home 解析成当前工作目录，
 *    所有配置读写都会落到别处；
 *  - 支持 `~` 前缀展开；
 *  - 结果规范化成绝对路径，避免依赖进程 cwd。
 */
export function dshHomeDir(): string {
    const fromEnv = process.env.DSH_HOME
    const selected = fromEnv !== undefined && fromEnv.trim().length > 0
        ? fromEnv
        : path.join(os.homedir(), '.dsh')
    return path.resolve(expandHomePath(selected))
}

/** home 级 patch 文件（`$DSH_HOME/cordis.patch.yml`），对所有 profile 生效。 */
export function homePatchFile(): string {
    return path.join(dshHomeDir(), PATCH_FILENAME)
}

/** 所有 profile 的根目录（`$DSH_HOME/profiles`）。 */
export function profilesRoot(): string {
    return path.join(dshHomeDir(), 'profiles')
}

/** 单个 profile 目录（`$DSH_HOME/profiles/<name>`）。 */
export function profileDir(name: string): string {
    return path.join(profilesRoot(), name)
}

/** Box 承载的那个 profile 的目录。 */
export function hostProfileDir(): string {
    return profileDir(DSH_PROFILE)
}

/** 某个 profile 的用户 patch 层（`profiles/<name>/cordis.patch.yml`）。 */
export function profilePatchFile(name: string = DSH_PROFILE): string {
    return path.join(profileDir(name), PATCH_FILENAME)
}

/** 某个 profile 的清单文件（`profiles/<name>/package.json`）。 */
export function profileManifestFile(name: string = DSH_PROFILE): string {
    return path.join(profileDir(name), 'package.json')
}

/**
 * 解析 profile 的组合包（bundle）时该查找的候选根目录，顺序与 dsh 一致：
 * **先 dsh 安装目录的 `node_modules`，再 profile 目录的 `node_modules`**
 * （见 dsh 的 `resolveBundleDir`：anchor 顺序是 `[installAnchor, profileDir]`）。
 *
 * @param installNodeModules dsh 安装目录下的 `node_modules`；解析不到时传 null。
 */
export function bundleRoots(installNodeModules: string | null): string[] {
    const roots: string[] = []
    if (installNodeModules) roots.push(installNodeModules)
    roots.push(path.join(hostProfileDir(), 'node_modules'))
    return roots
}

/**
 * 从某个已安装包的目录推出它所属的 `node_modules` 根。
 *
 * **不要用 `path.dirname()` 数层数**：包名可能是 scoped 的（`node_modules/@scope/pkg`
 * 要去掉「包名 + scope」两层），也可能是普通的（`node_modules/pkg` 只去一层）。
 * 按最后一段 `node_modules` 来切才对两种布局都成立。
 */
export function nodeModulesRootOf(packageDir: string): string {
    const at = packageDir.lastIndexOf(`${path.sep}node_modules${path.sep}`)
    return at < 0 ? path.dirname(packageDir) : `${packageDir.slice(0, at)}${path.sep}node_modules`
}
