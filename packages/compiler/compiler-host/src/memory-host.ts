import * as ts from 'typescript';

/**
 * 创建支持"内存源码"的 CompilerHost:
 * 内存 SourceFile 优先命中,其余回落到磁盘默认实现。
 *
 * A CompilerHost that serves in-memory SourceFiles first and falls back
 * to the default disk-based host for everything else.
 *
 * 注意:内存源码的 fileName 必须是绝对路径才能被模块解析命中。
 * Note: in-memory file names must be absolute paths for module
 * resolution to hit them.
 */
export function createMemoryCompilerHost(options: ts.CompilerOptions, sources: readonly ts.SourceFile[]): ts.CompilerHost {
    const byFile = new Map(sources.map((f) => [f.fileName, f] as const))
    const base = ts.createCompilerHost(options, /* setParentNodes */ true)
    return {
        ...base,
        getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
            return byFile.get(fileName)
                ?? base.getSourceFile?.(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
        },
        getSourceFileByPath(fileName, path, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
            return byFile.get(fileName)
                ?? base.getSourceFileByPath?.(fileName, path, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
        },
        fileExists(fileName) {
            return byFile.has(fileName) || base.fileExists(fileName)
        },
        readFile(fileName) {
            return byFile.get(fileName)?.text ?? base.readFile?.(fileName)
        },
    }
}
