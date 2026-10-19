/**
 * 用内存源码构建 ts.Program：输入内容决定分析对象。
 * Build a ts.Program from in-memory sources so the inputs decide what gets analyzed.
 */
import * as ts from 'typescript'
import { createMemoryCompilerHost } from '@veren/compiler-host'

/** 用能命中给定 SourceFile 的宿主创建 Program / Create a Program backed by a host that serves the given SourceFiles */
export function createProgramFromSources(
    options: ts.CompilerOptions,
    sources: readonly ts.SourceFile[],
): ts.Program {
    const host = createMemoryCompilerHost(options, sources)
    return ts.createProgram(sources.map((source) => source.fileName), options, host)
}
