import { afterEach, describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import { get, provide } from '@veren/core'
import { apply as applyOptions, name as CompilerOptionsToken } from '@veren/compiler-options'
import { name as CompilerHostToken } from '@veren/compiler-host'
import { apply, Config, inject, name, ProgramToken } from '../src/index'

/**
 * 每个用例创建的 Context 及其 disposer 收集到这里，afterEach 统一清理。
 * Contexts and disposers created by each test are collected here and disposed in afterEach.
 */
const disposers: Array<() => unknown> = []

afterEach(async () => {
    await Promise.allSettled(disposers.map((d) => d()))
    disposers.length = 0
})

/** 内存源码的绝对路径与文本 / Absolute path and text of the in-memory source. */
const VIRTUAL_FILE = '/virtual/sum.ts'
const VIRTUAL_SOURCE = 'export function sum(a: number, b: number): number { return a + b; }'

/**
 * 只启用到内存源码的编译选项:noLib 避免从磁盘读取 lib,types: [] 阻止
 * 自动引入 node_modules/@types/*(缺 lib 时它们会产生大量无关诊断)。
 * Compiler options that keep the compilation in memory: `noLib` avoids reading
 * lib files from disk and `types: []` stops the automatic inclusion of
 * node_modules/@types/*, which would otherwise flood diagnostics without a lib.
 */
const OPTIONS: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, noLib: true, types: [] }

/**
 * 构造一个只服务内存源码的 CompilerHost（其余回落到默认磁盘实现）。
 * Build a CompilerHost that serves the in-memory source first and falls back
 * to the default disk-based host for everything else.
 */
function createInMemoryHost(): { host: ts.CompilerHost; source: ts.SourceFile } {
    const source = ts.createSourceFile(VIRTUAL_FILE, VIRTUAL_SOURCE, ts.ScriptTarget.ES2022, true)
    const base = ts.createCompilerHost(OPTIONS, /* setParentNodes */ true)
    const host: ts.CompilerHost = {
        ...base,
        getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
            return fileName === VIRTUAL_FILE
                ? source
                : base.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
        },
        fileExists(fileName) {
            return fileName === VIRTUAL_FILE || base.fileExists(fileName)
        },
        readFile(fileName) {
            return fileName === VIRTUAL_FILE ? VIRTUAL_SOURCE : base.readFile(fileName)
        },
    }
    return { host, source }
}

describe('token', () => {
    it("name 是字符串 'verenProgram' / name is the string 'verenProgram'", () => {
        // 令牌加 `veren` 前缀以避免跨包重名。
        // The token carries the `veren` prefix to avoid collisions between packages.
        expect(name).toBe('verenProgram')
    })

    it('ProgramToken 与 name 同值 / ProgramToken is an alias of name', () => {
        expect(ProgramToken).toBe(name)
    })

    it('inject 依赖编译选项与编译宿主 / inject declares the compiler-options and compiler-host services', () => {
        expect(inject).toHaveLength(2)
        expect(inject).toEqual([CompilerOptionsToken, CompilerHostToken])
    })
})

describe('Config', () => {
    it('rootNames 默认空数组 / rootNames defaults to an empty array', () => {
        expect(Config({})).toEqual({ rootNames: [] })
        expect(Config(undefined)).toEqual({ rootNames: [] })
    })

    it('合法 rootNames 原样保留 / valid rootNames are preserved', () => {
        expect(Config({ rootNames: [VIRTUAL_FILE] })).toEqual({ rootNames: [VIRTUAL_FILE] })
    })

    it('非法 rootNames 抛错 / an invalid rootNames value throws', () => {
        expect(() => Config({ rootNames: 'not-an-array' as unknown as string[] })).toThrow()
        expect(() => Config({ rootNames: [1] as unknown as string[] })).toThrow()
    })
})

describe('apply', () => {
    it('缺少编译选项时抛错 / throws when the compiler options are missing', () => {
        const ctx = new Context()
        expect(() => apply(ctx)).toThrowError(
            `Value for token ${CompilerOptionsToken} not found in context`,
        )
    })

    it('缺少编译宿主时抛错 / throws when the compiler host is missing', () => {
        const ctx = new Context()
        disposers.push(applyOptions(ctx, OPTIONS))

        expect(() => apply(ctx)).toThrowError(
            `Value for token ${CompilerHostToken} not found in context`,
        )
    })

    it('不传 config 时构建空根集的 Program / builds a Program with an empty root set when config is omitted', () => {
        const ctx = new Context()
        const { host } = createInMemoryHost()
        disposers.push(applyOptions(ctx, OPTIONS))
        disposers.push(provide(ctx, CompilerHostToken, host))

        const disposer = apply(ctx)
        disposers.push(disposer)

        const program = get(ctx, name)
        expect(program).toBeDefined()
        expect(program!.getRootFileNames()).toEqual([])
        // 未列入 rootNames 的内存文件不会被 Program 加载。
        // The in-memory file is not part of rootNames, so the Program does not load it.
        expect(program!.getSourceFile(VIRTUAL_FILE)).toBeUndefined()
    })

    it('按 rootNames 构建 Program 并命中内存源码 / builds the Program from rootNames and serves the in-memory source', () => {
        const ctx = new Context()
        const { host, source } = createInMemoryHost()
        disposers.push(applyOptions(ctx, OPTIONS))
        disposers.push(provide(ctx, CompilerHostToken, host))

        const disposer = apply(ctx, { rootNames: [VIRTUAL_FILE] })
        disposers.push(disposer)

        const program = get(ctx, name)!
        expect(program.getRootFileNames()).toEqual([VIRTUAL_FILE])
        expect(program.getSourceFile(VIRTUAL_FILE)).toBe(source)
        expect(program.getCompilerOptions().target).toBe(ts.ScriptTarget.ES2022)
    })

    it('合法源码不产生语义错误 / valid source produces no semantic diagnostics', () => {
        const ctx = new Context()
        const { host } = createInMemoryHost()
        disposers.push(applyOptions(ctx, OPTIONS))
        disposers.push(provide(ctx, CompilerHostToken, host))
        disposers.push(apply(ctx, { rootNames: [VIRTUAL_FILE] }))

        const program = get(ctx, name)!
        expect(program.getSemanticDiagnostics()).toEqual([])
        expect(program.getSyntacticDiagnostics()).toEqual([])
    })

    it('返回的 disposer 注销 Program 服务 / the returned disposer unregisters the Program service', async () => {
        const ctx = new Context()
        const { host } = createInMemoryHost()
        disposers.push(applyOptions(ctx, OPTIONS))
        disposers.push(provide(ctx, CompilerHostToken, host))

        const disposer = apply(ctx, { rootNames: [VIRTUAL_FILE] })
        disposers.push(disposer)
        expect(get(ctx, name)).toBeDefined()

        await disposer()
        expect(get(ctx, name)).toBeUndefined()
    })

    it('dispose 之后可重新 apply / apply can run again after disposal', async () => {
        const ctx = new Context()
        const { host } = createInMemoryHost()
        disposers.push(applyOptions(ctx, OPTIONS))
        disposers.push(provide(ctx, CompilerHostToken, host))

        const first = apply(ctx, { rootNames: [VIRTUAL_FILE] })
        disposers.push(first)
        await first()
        expect(get(ctx, name)).toBeUndefined()

        const second = apply(ctx, { rootNames: [VIRTUAL_FILE] })
        disposers.push(second)
        expect(get(ctx, name)!.getRootFileNames()).toEqual([VIRTUAL_FILE])
    })
})
