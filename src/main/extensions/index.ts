import { installStaticExts, type StaticExt } from './loader/sources'
import { systemExtensions } from './system'
import { builtinExtensions } from './builtin'

/**
 * 扩展层的总入口。
 *
 * 职责只有一件：把**静态登记**的扩展表（系统 + 内置）汇总后交给加载器。
 * 加载器自己去扫外部扩展目录 —— 那条路径上的东西是运行期才知道的，
 * 与这里的「编译期已知」正好互补。
 *
 * 为什么要有这个中间层：加载器（loader/）不该 import 任何具体扩展，
 * 否则「加载器删掉、扩展还在」的依赖方向就反转了。具体扩展由本文件汇总，
 * loader 只接收一张抽象的表。
 */
export function setupStaticExtensions(): void {
    const all: StaticExt[] = [...systemExtensions, ...builtinExtensions]
    installStaticExts(all)
}
