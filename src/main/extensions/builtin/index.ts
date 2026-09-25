import type { StaticExt } from '../loader/sources'
import * as boxExtensions from './box.extensions/main'

/**
 * 内置扩展登记表：源码在本目录，随构建产物发布。
 *
 * 与外部扩展的区别（这也是内置这一级存在的意义）：
 *  - 随安装包发布，用户**不能卸载**（但可以停用），因此适合放「外壳自带但可选」的能力；
 *  - 经编译期检查，不存在半成品代码的风险；
 *  - 可以通过设置面板贡献里的 `view` 指定**渲染层本地组件**（外部扩展不能，见
 *    renderer/extensions/panels.ts 的说明）；
 *  - 受崩溃计数与安全模式影响（与外部扩展同等待遇）—— 它有可能是我们在这一版引入的
 *    问题，用户仍需要一条「全部关掉」的自救路径。
 *
 * 迁入一个扩展 = 写一个目录 + 在这里加一行。
 */
export const builtinExtensions: StaticExt[] = [
    {
        kind: 'builtin',
        sourceDir: 'src/main/extensions/builtin/box.extensions',
        manifest: {
            id: 'box.extensions',
            name: '扩展管理',
            version: '1.0.0',
            apiVersion: 1,
            contributions: {
                settings: [{ key: 'extensions', titleKey: 'sv.nav.extensions', view: 'extensions' }]
            }
        },
        module: boxExtensions
    }
]
