import * as ts from 'typescript';
import z from '@deepseek-ai/schemastery';
import { defineToken, getOrThrow, provideValue } from '@veren/core';
import type { Context } from '@deepseek-ai/cordis';
import { name as CompilerOptionsToken } from '@veren/compiler-options';

/**
 * 编译宿主 Provider —— 基于编译选项创建 ts.CompilerHost,提供到上下文;
 * 同时从包入口导出内存宿主工厂,供虚拟源码场景直接复用。
 *
 * Compiler Host Provider — creates a ts.CompilerHost from the compiler
 * options service and provides it to the context; the in-memory host factory
 * is re-exported from the package entry for virtual-source scenarios.
 */

/** 内存宿主工厂:包外可直接从入口取用 / In-memory host factory, available from the package entry */
export { createMemoryCompilerHost } from './memory-host.js'

/** 编译宿主令牌 / Compiler host token */
export const name = defineToken<ts.CompilerHost>('verenCompilerHost')

/** 插件配置校验 / Plugin config validation */
export const Config = z.object({
    setParentNodes: z.boolean().default(false),
})
export interface Config {
    /** 是否在 SourceFile 上维护 parent 链,位置计算需要 / Whether to keep the parent chain on SourceFiles, required for position computations */
    setParentNodes?: boolean;
}

/** 依赖的编译选项服务 / Required compiler options service */
export const inject = [CompilerOptionsToken]

export const apply = (ctx: Context, config: Config) => {
    const options = getOrThrow(ctx, CompilerOptionsToken)
    const host = ts.createCompilerHost(options, config.setParentNodes)
    return provideValue(ctx, name, host)
}
