import * as ts from 'typescript'
import { defineToken, getOrThrow, provideValue } from '@veren/core'
import type { Context } from '@deepseek-ai/cordis'
import { Compiler } from './compiler.js'
import { createProgramFromSources } from './memory-program.js'
import { findTargets, resolveTarget, type Target } from './collect.js'
import type { CompileInput, EmitResult, TypeMetadata } from './types.js'
import { name as CompilerOptionsToken } from '@veren/compiler-options'
import { name as ProgramToken } from '@veren/compiler-program'
import { name as TypeCheckerToken } from '@veren/compiler-type-checker'

/**
 * 编译器 Provider —— 把接线好的 Compiler 实例(流水线各阶段对接上下文服务)
 * 提供到上下文。compile 的输入源码会真正参与分析:输入不同,元数据与诊断就不同。
 *
 * Compiler Provider — provides a wired Compiler instance whose pipeline
 * stages resolve against context services. The sources passed to compile are
 * what gets analyzed, so different inputs yield different metadata and diagnostics.
 */

/** 抽象流水线再导出,供包外继承 / Re-export the abstract pipeline so it can be extended outside the package */
export { Compiler } from './compiler.js'

/** 流水线数据类型再导出,供包外实现自定义阶段 / Re-export pipeline data types for custom stages outside the package */
export type { CompileInput, EmitResult, SourceSpan, TypeMetadata, TypeMetadataKind } from './types.js'

/** 编译器令牌 / Compiler token */
export const name = defineToken<Compiler>('verenCompiler')

/** 依赖的编译选项、程序与类型检查器服务 / Required compiler options, program and type checker services */
export const inject = [CompilerOptionsToken, ProgramToken, TypeCheckerToken]

/** 默认编译器:模板方法的各阶段接线到上下文服务 / Default compiler: every template-method stage is wired to a context service */
export class DefaultCompiler extends Compiler {
    /** 本次 parse 产出的 Program;为空时回退到上下文服务 / The per-run Program; falls back to the context service when absent */
    private currentProgram?: ts.Program

    /** load 产出的源码,决定 analyze 的扫描范围 / Sources from load; they decide what analyze scans */
    private loadedFiles: readonly ts.SourceFile[] = []

    /** analyze 找到的待解析声明 / Declarations found by analyze, resolved later by collect */
    private targets: readonly Target[] = []

    constructor(private readonly ctx: Context) {
        super()
    }

    /** 编译选项:直接取上下文中的 options 服务 / Compiler options: read the options service from the context */
    get options(): ts.CompilerOptions {
        return getOrThrow(this.ctx, CompilerOptionsToken)
    }

    /** TS 程序:优先本次输入构建的 program,否则回退到 program 服务 / TS program: the per-run program when present, otherwise the program service */
    get program(): ts.Program {
        if (this.currentProgram) return this.currentProgram
        return getOrThrow(this.ctx, ProgramToken)
    }

    /** 检查器:始终与当前 program 同源 / Checker: always from the same source as the current program */
    get checker(): ts.TypeChecker {
        if (this.currentProgram) return this.currentProgram.getTypeChecker()
        return getOrThrow(this.ctx, TypeCheckerToken)
    }

    /**
     * 资源加载:有 content 用内存源码,没有则按 ts.sys 从磁盘读。
     * Resource loading: use in-memory content when present, otherwise read the
     * file from disk through ts.sys.
     */
    protected load(inputs: readonly CompileInput[]): readonly ts.SourceFile[] {
        return inputs.map((input) => {
            const content = input.content ?? readSource(input.fileName)
            return ts.createSourceFile(
                input.fileName,
                content,
                this.options.target ?? ts.ScriptTarget.ES2022,
                /* setParentNodes: 维护 parent 链 */ true,
            )
        })
    }

    /**
     * 解析:输入非空时用这些源码新建 Program;输入为空时回退到程序服务,
     * 以便 compile([]) 仍能分析上下文里预先构建好的工程。
     *
     * Parsing: build a new Program from the inputs when present; with no inputs
     * fall back to the program service, so compile([]) can still analyze the
     * project pre-built in the context.
     */
    protected parse(files: readonly ts.SourceFile[]): ts.Program {
        this.loadedFiles = files
        this.currentProgram = files.length > 0
            ? createProgramFromSources(this.options, files)
            : getOrThrow(this.ctx, ProgramToken)
        return this.currentProgram
    }

    /**
     * 扫描:上报本次源码的语法/语义诊断,并记录待解析的擦除声明。
     * Analysis: report syntax/semantic diagnostics for the inputs and record the
     * erased declarations to resolve.
     */
    protected analyze(): void {
        const files = this.analysisFiles()
        for (const file of files) {
            for (const diagnostic of this.program.getSyntacticDiagnostics(file)) this.report(diagnostic)
            for (const diagnostic of this.program.getSemanticDiagnostics(file)) this.report(diagnostic)
        }
        this.targets = files.flatMap(findTargets)
    }

    /**
     * 搜集:借助 checker 把 analyze 记录的声明解析成 TypeMetadata 并归档。
     * Collection: resolve the declarations recorded by analyze into TypeMetadata
     * through the checker and archive them.
     */
    protected collect(_files: readonly ts.SourceFile[]): void {
        const entries = new Map<string, TypeMetadata[]>()
        for (const target of this.targets) {
            const metadata = resolveTarget(target, this.checker)
            const list = entries.get(metadata.span.fileName) ?? []
            list.push(metadata)
            entries.set(metadata.span.fileName, list)
        }
        for (const [fileName, list] of entries) this.addMetadata(fileName, list)
    }

    /**
     * 产出:展平元数据仓库,并附一份可序列化的 JSON。
     * Emission: flatten the metadata registry and attach a serializable JSON.
     */
    protected emit(): EmitResult {
        const metadata = [...this.metadataRegistry.values()].flat()
        return {
            metadata,
            output: JSON.stringify({ files: [...this.metadataRegistry.keys()], metadata }),
        }
    }

    /**
     * 复位:除基类状态外,同时丢弃上一次的 Program / 源码 / 目标。
     * Reset: drop the previous Program, sources and targets in addition to the
     * base-class state.
     */
    protected override reset(): void {
        super.reset()
        this.currentProgram = undefined
        this.loadedFiles = []
        this.targets = []
    }

    /**
     * analyze 的扫描范围:有输入时只看输入文件;没有输入时看程序服务的非声明文件。
     * Scope of analyze: only the inputs when present; otherwise the program
     * service's non-declaration files.
     */
    private analysisFiles(): readonly ts.SourceFile[] {
        if (this.loadedFiles.length === 0) {
            return this.program.getSourceFiles().filter((file) => !file.isDeclarationFile)
        }
        return this.loadedFiles.map((file) => this.program.getSourceFile(file.fileName) ?? file)
    }
}

/** 读取磁盘源码;读不到时给出包含文件名的明确错误 / Read source from disk; fail with a clear error naming the file */
function readSource(fileName: string): string {
    const content = ts.sys.readFile(fileName)
    if (content === undefined) {
        throw new Error(`DefaultCompiler: 无法读取 ${fileName}，请提供 content 或确认文件存在`)
    }
    return content
}

/** 把接线好的默认编译器 provide 到上下文 / Provide the wired default compiler to the context */
export const apply = (ctx: Context) => {
    return provideValue(ctx, name, new DefaultCompiler(ctx))
}
