/**
 * kernel 对外暴露的**唯一整目录删除入口**。
 *
 * 为什么这层要放在 kernel、而不是让各处直接 `fs.rmSync(dir, { recursive: true })`：
 *
 *  - dsh / pnpm 的安装目录里**到处是符号链接与 Windows 目录联接（junction）** ——
 *    pnpm 就是用 junction 组织 node_modules 布局的。「删版本目录 / 卸载插件」会整棵删掉它们，
 *    一旦跟随链接就会把**链接指向的用户真实数据**一起删掉。
 *  - 一个版本目录动辄几万个小文件，同步 `rmSync` 会把主进程独占到界面卡死
 *    （「一些操作时整个程序会卡住」的主因之一）。
 *
 * 因此删除语义只有一份实现：`dsh/fsutil.ts` 的 `removeTree`（异步、不跟随链接 /
 * junction、每批让出事件循环）。本模块把它**收拢到 kernel 边界再导出**，于是：
 *
 *  1. 模块侧统一 `import { removeTree, removeQuietly } from '../kernel/treeops'`，
 *     不直接碰 `fs.rmSync(recursive)` —— 红线从「文档约定」变成「import 图」；
 *  2. 将来若换实现（rimraf / shell / 别的平台方案），只改 fsutil 一处，调用点不动。
 *
 * 唯一例外是**启动期的同步迁移**（`installs.ts` 的 `migrateLegacyDshDir` / `moveFlatInto`）：
 * 那两步整体是同步的、无法 await，故保留 `removeQuietlySync` —— 但它只用于清理
 * 「目标已有同名项时的重复项」，不承担删除用户数据目录的职责。
 */

export { removeTree, removeQuietly, removeQuietlySync, readPkgVersion, pathExists } from '../dsh/fsutil'
