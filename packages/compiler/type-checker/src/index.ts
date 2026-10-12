import type * as ts from 'typescript';
import { defineToken, getOrThrow, provide } from '@veren/core';
import type { Context } from '@deepseek-ai/cordis';
import { name as ProgramToken } from '@veren/compiler-program';

/**
 * 类型检查器 Provider —— 从 ProgramToken 派生 TypeChecker,提供到上下文。
 * checker 与 program 天然同源(program.getTypeChecker())。
 *
 * Type Checker Provider — derives a TypeChecker from the provided
 * ts.Program, so checker and program are always from the same source.
 */

/** 类型检查器令牌 / Type checker token */
export const name = defineToken<ts.TypeChecker>('verenTypeChecker')

/** 依赖的程序服务 / Required program service */
export const inject = [ProgramToken]

/** 从 program 派生 checker(program.getTypeChecker())并 provide 到上下文 / Derive the checker from the program and provide it to the context */
export const apply = (ctx: Context) => {
    const program = getOrThrow(ctx, ProgramToken)
    return provide(ctx, name, program.getTypeChecker())
}
