import type * as ts from "typescript";
import { defineToken, provideValue } from "@veren/core";
import type { Context } from "@deepseek-ai/cordis";

/**
 * 编译选项 Provider —— 把 ts.CompilerOptions 原样提供到上下文。
 * Config 即选项对象本身,无 schema 校验。
 *
 * Compiler Options Provider — provides raw ts.CompilerOptions to the
 * context. The config is the options object itself; no schema applied.
 */

/** 编译选项令牌，值为 'verenCompilerOptions'
 *  Compiler options token; its value is 'verenCompilerOptions'. */
export const name = defineToken<ts.CompilerOptions>('verenCompilerOptions')

/** 无依赖的编译选项服务：不依赖任何其他服务，可最先激活
 *  Dependency-free compiler options service: it needs no other service, so it
 *  can be activated first in the pipeline. */
export const inject = []

/**
 * 把 ts.CompilerOptions 以浅拷贝形式提供到上下文。
 * 省略 config 时提供空对象；之后修改原对象不会影响已提供的值。
 *
 * Provides `ts.CompilerOptions` to the context as a shallow copy.
 * Omitting the config provides an empty object; later mutations of the original
 * object do not affect the provided value.
 */
export const apply = (ctx: Context, config: ts.CompilerOptions = {}) => {
    return provideValue(ctx, name, { ...config })
}
