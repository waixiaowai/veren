import * as ts from 'typescript';
import { defineToken, getOrThrow, provide } from '@veren/core';
import type { Context } from '@deepseek-ai/cordis';
import { Compiler, type CompileInput, type EmitResult } from './types.js';
import { name as CompilerOptionsToken } from '@veren/compiler-options';
import { name as ProgramToken } from '@veren/compiler-program';
import { name as TypeCheckerToken } from '@veren/compiler-type-checker';

/**
 * 编译器 Provider —— 把接线好的 Compiler 实例(流水线各阶段对接上下文服务)
 * 提供到上下文。analyze / collect 的搜集逻辑为 TODO,由后续迭代填充。
 *
 * Compiler Provider — provides a wired Compiler instance whose pipeline
 * stages resolve against context services. analyze / collect are TODO.
 */

/** 编译器令牌 / Compiler token */
export const name = defineToken<Compiler>('verenCompiler')

/** 依赖的编译选项、程序与类型检查器服务 / Required compiler options, program and type checker services */
export const inject = [CompilerOptionsToken, ProgramToken, TypeCheckerToken]

/** 默认编译器:模板方法的各阶段接线到上下文服务 / Default compiler: every template-method stage is wired to a context service */
export class DefaultCompiler extends Compiler {
    constructor(private readonly ctx: Context) {
        super()
    }

    /** 编译选项:直接取上下文中的 options 服务 / Compiler options: read the options service from the context */
    get options(): ts.CompilerOptions {
        return getOrThrow(this.ctx, CompilerOptionsToken)
    }

    /** TS 程序:直接取上下文中的 program 服务 / TS program: read the program service from the context */
    get program(): ts.Program {
        return getOrThrow(this.ctx, ProgramToken)
    }

    /**
     * 与 program 同源的检查器:直接取 type-checker 服务,
     * 该服务即 program.getTypeChecker() 的缓存实例。
     *
     * Checker from the same source as the program: it reads the type-checker
     * service, which is program.getTypeChecker()'s cached instance.
     */
    get checker(): ts.TypeChecker {
        return getOrThrow(this.ctx, TypeCheckerToken)
    }

    /**
     * 默认只支持内存源码;磁盘加载由子类或上层扩展。
     * 注意:缺少 content 时抛出的消息(含「未提供 content」)是代码字符串,
     * 属于对外消息契约,故保持中文、不随注释一起翻译。
     *
     * In-memory sources only by default; disk loading is left to subclasses or
     * callers. Note: the message thrown for a missing `content` (containing the
     * literal 「未提供 content」) is a code string — part of the message contract —
     * so it stays Chinese on purpose and is not translated along with comments.
     */
    protected load(inputs: readonly CompileInput[]): readonly ts.SourceFile[] {
        return inputs.map((input) => {
            if (input.content === undefined) {
                throw new Error(`DefaultCompiler: ${input.fileName} 未提供 content,默认加载器只支持内存源码`)
            }
            return ts.createSourceFile(input.fileName, input.content, this.options.target ?? ts.ScriptTarget.ES2022, /* setParentNodes: 维护 parent 链 */ true)
        })
    }

    /**
     * program 由 @veren/compiler-program 依据 rootNames 配置预先构建,
     * 本阶段只把它取回来,传入的 SourceFile 不参与构建。
     *
     * The program is pre-built by @veren/compiler-program from its rootNames
     * config; this stage just returns it and ignores the passed source files.
     */
    protected parse(_files: readonly ts.SourceFile[]): ts.Program {
        return this.program
    }

    /**
     * TODO 未实现:analyze 的搜集逻辑留待后续迭代填充。
     * 抛出的消息(含「尚未实现」)是代码字符串,既是流程标记也是对外可观测行为。
     *
     * TODO, not implemented: the analysis logic is left for a later iteration.
     * The thrown message (containing 「尚未实现」) is a code string and is both the
     * pipeline marker and the observable behaviour.
     */
    protected analyze(): void {
        throw new Error('DefaultCompiler.analyze: 尚未实现')
    }

    /**
     * TODO 未实现:collect 的搜集逻辑留待后续迭代填充。
     * 抛出的消息(含「尚未实现」)是代码字符串,既是流程标记也是对外可观测行为。
     *
     * TODO, not implemented: the collection logic is left for a later iteration.
     * The thrown message (containing 「尚未实现」) is a code string and is both the
     * pipeline marker and the observable behaviour.
     */
    protected collect(_files: readonly ts.SourceFile[]): void {
        throw new Error('DefaultCompiler.collect: 尚未实现')
    }

    /**
     * 默认产出空元数据:真正的汇总由覆写 analyze / collect 的子类负责。
     *
     * Empty metadata by default; real aggregation belongs to subclasses that
     * override analyze / collect.
     */
    protected emit(): EmitResult {
        return { metadata: [] }
    }
}

/** 把接线好的默认编译器 provide 到上下文 / Provide the wired default compiler to the context */
export const apply = (ctx: Context) => {
    return provide(ctx, name, new DefaultCompiler(ctx))
}
