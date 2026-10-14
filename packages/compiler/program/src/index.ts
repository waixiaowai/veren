import * as ts from 'typescript';
import z from '@deepseek-ai/schemastery';
import { defineToken, getOrThrow, provideValue } from '@veren/core';
import type { Context } from '@deepseek-ai/cordis';
import { name as CompilerOptionsToken } from '@veren/compiler-options';
import { name as CompilerHostToken } from '@veren/compiler-host';

/**
 * 程序 Provider —— 基于编译选项与编译宿主构建 ts.Program,提供到上下文。
 *
 * Program Provider — builds a ts.Program from the compiler options and
 * compiler host services, then provides it to the context.
 */

/** 程序令牌,各 Provider 包统一导出名 name,ProgramToken 为等价别名 / Program token, uniformly exported as `name` by provider packages, with `ProgramToken` as an equivalent alias */
export const name = defineToken<ts.Program>('verenProgram')
export const ProgramToken = name

/** 插件配置校验 / Plugin config validation */
export const Config = z.object({
    rootNames: z.array(z.string()).default([]),
})
export interface Config {
    /** 编译入口(根文件名)列表 / Compilation entry points (root file names) */
    rootNames?: readonly string[];
}

/** 依赖的编译选项与编译宿主服务 / Required compiler options and compiler host services */
export const inject = [CompilerOptionsToken, CompilerHostToken]

export const apply = (ctx: Context, config?: Config) => {
    const options = getOrThrow(ctx, CompilerOptionsToken)
    const host = getOrThrow(ctx, CompilerHostToken)
    const program = ts.createProgram(config?.rootNames ?? [], options, host)
    return provideValue(ctx, ProgramToken, program)
}
