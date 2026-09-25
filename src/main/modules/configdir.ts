import type { Settings } from '@shared/types'
import { defineModule } from '../kernel/module'
import { configDirInfo, setConfigDir, revertConfigDir, runConfigMigration, cancelConfigMigration, readDiskSettings, loadSettings, persistSettings } from '../app/settings'
import { readModelsInfo, readCurrentBalance } from '../app/models'
import type { ModelsEnv } from '../app/models'
import { dshInstallNodeModules } from '../dsh/tools'
import { listAppIcons, currentAppIcon, saveUserIcon, deleteUserIcon } from '../app/appicon'

/**
 * 配置目录迁移 + 「模型」页数据 + 程序图标。
 *
 * 三者都是「外壳自身的数据面」：配置目录读写、模型 / 余额只读查询（密钥不出主进程）、
 * 图标文件管理。放在一起是因为都直接读写配置目录下的文件，且不涉及窗口或子进程。
 */
export default defineModule({
    id: 'configdir',
    routes: {
        GET: {
            '/config-dir': () => configDirInfo(),
            // 「设置 → 模型」：读取模型列表与各供应商用量（明文密钥绝不离开主进程）。
            // 未同意读取凭据时直接返回 no-consent，不读配置也不联网（与下面的余额接口同一开关）。
            '/models/info': () => readModelsInfo(loadSettings().modelsCredConsent === true, modelsEnv()),
            // 底部状态栏：当前供应商余额（未同意读取时直接返回 null，不读配置也不联网）。
            '/models/balance': () => readCurrentBalance(loadSettings().modelsCredConsent === true, modelsEnv()),
            // 程序图标（设置 → 外观）
            '/icons': () => listAppIcons(),
            '/icons/current': () => currentAppIcon()
        },
        PUT: {
            '/config-dir': ({ body }) => setConfigDir(typeof body?.dir === 'string' && body.dir ? body.dir : null)
        },
        POST: {
            // 撤销尚未执行的迁移：固定回原配置目录。
            '/config-dir/revert': () => revertConfigDir(),
            // 重启引导阶段由渲染层触发实际搬迁（异步，进度经 configdir:migration 广播）。
            '/config-dir/migration': () => {
                void runConfigMigration()
            },
            '/icons': ({ body }) => {
                const id = saveUserIcon(String(body?.name || 'icon'), body?.data as Uint8Array)
                return { id, list: listAppIcons() }
            }
        },
        DELETE: {
            // 请求取消正在执行的迁移（已搬内容回滚）。
            '/config-dir/migration': () => cancelConfigMigration(),
            '/icons/:id': ({ params }) => {
                deleteUserIcon(params.id)
                return listAppIcons()
            }
        }
    }
})

/**
 * 「模型」页需要的外部环境：dsh 安装目录下的 `node_modules`。
 * 随附 bundle（dsh-base / dsh-web-app）的默认配置就装在那里，模型页要靠它才能看到「开箱可用」
 * 的默认供应商；解析放在这里（而不是 models.ts）是为了让它保持「不依赖 electron」。
 */
function modelsEnv(): ModelsEnv {
    return { installNodeModules: dshInstallNodeModules(loadSettings()) }
}

// 供未来模块复用（如诊断 / 导出设置）。
export type { Settings }
export { readDiskSettings, persistSettings }
