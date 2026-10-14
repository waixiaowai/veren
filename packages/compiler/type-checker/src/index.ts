import type * as ts from 'typescript';
import { defineToken, getOrThrow, provideValue } from '@veren/core';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { name as ProgramToken } from '@veren/compiler-program';

/**
 * 类型检查器 Provider —— 从 ProgramToken 派生 TypeChecker，提供到上下文。
 * checker 与 program 天然同源（program.getTypeChecker()），保证同一实例。
 *
 * Type Checker Provider — derives a TypeChecker from the provided ts.Program
 * and provides it to the context; checker and program are always from the
 * same source (program.getTypeChecker()), guaranteed to be the same instance.
 */

/** 类型检查器令牌，各 Provider 包统一导出名 name / Type checker token, uniformly exported as `name` by provider packages */
export const name = defineToken<ts.TypeChecker>('verenTypeChecker')

/** 插件配置校验：本 Provider 无可配置项 / Plugin config validation: nothing is configurable */
export interface Config { }
export const Config: z<Config> = z.object({})

/** 依赖的程序服务 / Required program service */
export const inject = [ProgramToken]
/** 本插件提供类型检查器服务 / this plugin provides the type checker service */
export const provide = [name]

/** 从 program 派生 checker（program.getTypeChecker()）并 provideValue 到上下文 / Derive the checker from the program (program.getTypeChecker()) and provideValue it to the context */
export const apply = (ctx: Context) => {
    const program = getOrThrow(ctx, ProgramToken)
    // provideValue 助手内部即 ctx.effect(() => ctx.provide(...))，随 fiber 卸载自动清理。
    // The provideValue helper wraps ctx.effect(() => ctx.provide(...)); it unloads with the fiber.
    return provideValue(ctx, name, program.getTypeChecker())
}
