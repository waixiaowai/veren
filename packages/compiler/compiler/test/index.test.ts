import { afterEach, describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyOptions, name as CompilerOptionsToken } from '@veren/compiler-options'
import { apply as applyHost, name as CompilerHostToken } from '@veren/compiler-host'
import { apply as applyProgram, name as ProgramToken } from '@veren/compiler-program'
import { apply as applyChecker, name as TypeCheckerToken } from '@veren/compiler-type-checker'
import { Compiler } from '../src/compiler'
import type { CompileInput, EmitResult, TypeMetadata, TypeMetadataKind } from '../src/types'
import { DefaultCompiler, apply as applyCompiler, inject, name } from '../src/index'

/**
 * 每个用例各自创建的 Context 所产生的 disposer，统一在 afterEach 清理。
 * Disposers produced by the per-test Context, cleaned up together in afterEach.
 */
const disposers: Array<() => unknown> = []

afterEach(async () => {
    await Promise.allSettled(disposers.map((d) => d()))
    disposers.length = 0
})

/**
 * 按依赖顺序搭建完整服务链：options → host → program → checker；
 * rootNames 可为空数组（DefaultCompiler.parse 只返回该 program，
 * 不影响 load 阶段的内存源码）。每次调用都 new 一个 Context，
 * 避免跨用例复用导致 "service already registered"。
 * Build the full service chain in dependency order: options → host →
 * program → checker; rootNames may be empty (DefaultCompiler.parse just
 * returns the provided program, which does not affect load's in-memory
 * sources). Always a fresh Context so services never collide across tests.
 */
const setupCtx = (options: ts.CompilerOptions = {}, rootNames: readonly string[] = []): Context => {
    const ctx = new Context()
    disposers.push(applyOptions(ctx, options))
    disposers.push(applyHost(ctx, { setParentNodes: true }))
    disposers.push(applyProgram(ctx, { rootNames }))
    disposers.push(applyChecker(ctx))
    return ctx
}

/** 把 protected 的 load/parse 以公开方法转发出来，便于单独测试这两个阶段 */
/** Re-expose the protected load/parse as public methods so both stages can be tested in isolation */
class ProbeCompiler extends DefaultCompiler {
    load(inputs: readonly CompileInput[]) {
        return super.load(inputs)
    }

    parse(files: readonly ts.SourceFile[]) {
        return super.parse(files)
    }
}

/** 只覆写 analyze 的子类：用于触发默认 collect 的抛错路径 */
/** Subclass overriding only analyze: triggers the default collect's throwing path */
class AnalyzeOnlyCompiler extends DefaultCompiler {
    protected override analyze(): void {}
}

/** 覆写 analyze/collect 的子类：用于观察默认 emit 的返回值 */
/** Subclass overriding analyze/collect: observes the default emit's return value */
class NoopStagesCompiler extends DefaultCompiler {
    protected override analyze(): void {}

    protected override collect(_files: readonly ts.SourceFile[]): void {}
}

/**
 * 完整流水线子类：analyze 置空；collect 借助源码文本按文件归档
 * interface 与 type-alias 各一条；emit 展平 registry 并生成可序列化 output。
 * A full-pipeline subclass: analyze is a no-op; collect archives one
 * interface and one type-alias entry per file (names parsed from the source
 * text); emit flattens the registry into a serializable output.
 */
class PipelineCompiler extends DefaultCompiler {
    protected override analyze(): void {}

    protected override collect(files: readonly ts.SourceFile[]): void {
        for (const sf of files) {
            const span = { fileName: sf.fileName, start: 0, end: sf.end, line: 0, character: 0 }
            const interfaceName = /\binterface\s+(\w+)/.exec(sf.text)?.[1] ?? ''
            const typeName = /\btype\s+(\w+)/.exec(sf.text)?.[1] ?? ''
            this.addMetadata(sf.fileName, [makeEntry('interface', interfaceName, span)])
            this.addMetadata(sf.fileName, [makeEntry('type-alias', typeName, span)])
        }
    }

    protected override emit(): EmitResult {
        return {
            metadata: [...this.metadataRegistry.values()].flat(),
            output: JSON.stringify({ files: [...this.metadataRegistry.keys()] }),
        }
    }
}

/** 构造一条最小类型元数据 */
/** Build a minimal TypeMetadata entry */
const makeEntry = (kind: TypeMetadataKind, name: string, span: TypeMetadata['span']): TypeMetadata => ({
    kind,
    name,
    span,
})

describe('DefaultCompiler', () => {
    it("name 令牌为 'verenCompiler'，inject 为 options/program/typeChecker 三个服务令牌，且各令牌互不重名", () => {
        expect(name).toBe('verenCompiler')
        expect(inject).toEqual([CompilerOptionsToken, ProgramToken, TypeCheckerToken])
        // 令牌统一加 `veren` 前缀以避免跨包重名：六个包的令牌必须两两不同。
        // All tokens carry the `veren` prefix to avoid collisions: the tokens of
        // the six packages must be pairwise distinct.
        const tokens = [
            name,
            CompilerOptionsToken,
            CompilerHostToken,
            ProgramToken,
            TypeCheckerToken,
        ]
        expect(new Set(tokens).size).toBe(tokens.length)
        expect(tokens.every((token) => token.startsWith('veren'))).toBe(true)
    })

    it('getter options/program/checker 返回上下文中的同一服务引用，且 checker 与 program 同源', () => {
        const ctx = setupCtx()
        const compiler = new DefaultCompiler(ctx)

        expect(compiler.options).toBe(ctx.get(CompilerOptionsToken))
        expect(compiler.program).toBe(ctx.get(ProgramToken))
        expect(compiler.checker).toBe(ctx.get(TypeCheckerToken))
        // 同源校验：type-checker 服务即 program.getTypeChecker() 的缓存实例
        // Same-source check: the typeChecker service is program.getTypeChecker()'s cached instance
        expect(compiler.checker).toBe(compiler.program.getTypeChecker())
    })

    it('缺任一服务时访问对应 getter 抛错（fail-fast，消息含令牌名）', () => {
        // 空 Context：三个服务都未提供
        // Empty Context: none of the three services is provided
        const compiler = new DefaultCompiler(new Context())
        expect(() => compiler.options).toThrowError(
            `Value for token ${CompilerOptionsToken} not found in context`,
        )
        expect(() => compiler.program).toThrowError(
            `Value for token ${ProgramToken} not found in context`,
        )
        expect(() => compiler.checker).toThrowError(
            `Value for token ${TypeCheckerToken} not found in context`,
        )
    })

    it('load 对缺 content 的输入抛错，消息包含该 fileName 与 未提供 content', () => {
        const compiler = new DefaultCompiler(setupCtx())
        let error: unknown
        try {
            compiler.compile([{ fileName: 'missing.ts' }])
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toContain('missing.ts')
        expect((error as Error).message).toContain('未提供 content')
    })

    it('load 有 content 时产出 SourceFile：fileName 与输入一致，且 setParentNodes 维护 parent 链', () => {
        const compiler = new ProbeCompiler(setupCtx())
        const [sf] = compiler.load([{ fileName: 'a.ts', content: 'export interface A { x: number }' }])

        expect(sf.fileName).toBe('a.ts')
        expect(sf.statements).toHaveLength(1)
        // setParentNodes=true：语句的 parent 指回所属 SourceFile
        // setParentNodes=true: a statement's parent points back to its SourceFile
        expect(sf.statements[0]!.parent).toBe(sf)
    })

    it('load 的 target 取 options.target，缺省回退 ES2022', () => {
        const withTarget = new ProbeCompiler(setupCtx({ target: ts.ScriptTarget.ES2020 }))
        const [sf2020] = withTarget.load([{ fileName: 't0.ts', content: 'const x: number = 1' }])
        expect(sf2020.languageVersion).toBe(ts.ScriptTarget.ES2020)
        expect(sf2020.statements).toHaveLength(1)

        // 未提供 target 时回退默认 ES2022
        // Falls back to the default ES2022 when no target is provided
        const withoutTarget = new ProbeCompiler(setupCtx())
        const [sfDefault] = withoutTarget.load([{ fileName: 't1.ts', content: 'const y: number = 2' }])
        expect(sfDefault.languageVersion).toBe(ts.ScriptTarget.ES2022)
    })

    it('parse 返回上下文中的 program（同一引用）', () => {
        const ctx = setupCtx()
        const compiler = new ProbeCompiler(ctx)
        expect(compiler.parse([])).toBe(ctx.get(ProgramToken))
    })

    it('直接 compile 会在 load→parse 成功后于 analyze 阶段抛错', () => {
        // load 用 this.options、parse 用 this.program，因此三个服务都需先提供
        // load reads this.options and parse reads this.program, so all three services must be provided first
        const compiler = new DefaultCompiler(setupCtx())
        expect(() => compiler.compile([{ fileName: 'a.ts', content: 'export const x = 1' }])).toThrowError(
            'DefaultCompiler.analyze: 尚未实现',
        )
    })

    it('仅覆写 analyze 时，默认 collect 抛错', () => {
        const compiler = new AnalyzeOnlyCompiler(setupCtx())
        expect(() => compiler.compile([{ fileName: 'a.ts', content: 'export const x = 1' }])).toThrowError(
            'DefaultCompiler.collect: 尚未实现',
        )
    })

    it('覆写 analyze/collect 后，默认 emit 返回空 metadata，且 compile 后查询接口可用', () => {
        const compiler = new NoopStagesCompiler(setupCtx())
        const result = compiler.compile([{ fileName: 'a.ts', content: 'export const x = 1' }])

        expect(result).toEqual({ metadata: [] })
        expect(compiler.getMetadata('a.ts')).toEqual([])
    })

    it('完整流水线（PipelineCompiler）：compile 成功、getMetadata 可读、二次 compile 幂等', () => {
        const compiler = new PipelineCompiler(setupCtx())
        const inputs: CompileInput[] = [
            { fileName: 'a.ts', content: 'export interface A { x: number }\nexport type B = string | number' },
            { fileName: 'b.ts', content: 'export interface C { y: string }\nexport type D = number[]' },
        ]

        const first = compiler.compile(inputs)
        // 每个文件归档 interface 与 type-alias 各一条，registry 按插入序展平
        // One interface + one type-alias per file; the registry flattens in insertion order
        expect(first.metadata.map((m) => `${m.kind}:${m.name}`)).toEqual([
            'interface:A',
            'type-alias:B',
            'interface:C',
            'type-alias:D',
        ])
        expect(first.output).toBe(JSON.stringify({ files: ['a.ts', 'b.ts'] }))

        expect(compiler.getMetadata('a.ts')).toEqual(first.metadata.slice(0, 2))
        expect(compiler.getMetadata('b.ts')).toEqual(first.metadata.slice(2))
        expect(compiler.getMetadata('missing.ts')).toEqual([])

        // 二次 compile 幂等：registry 先清空再重建，条目不会翻倍
        // The second compile is idempotent: the registry is cleared then rebuilt, entries never double
        const second = compiler.compile(inputs)
        expect(second.metadata).toHaveLength(4)
        expect(second.output).toBe(first.output)
        expect(compiler.getMetadata('a.ts')).toHaveLength(2)
    })
})

describe('provider (apply)', () => {
    it('apply 将 DefaultCompiler 实例提供到上下文，且 instanceof Compiler 成立', () => {
        const ctx = setupCtx()
        disposers.push(applyCompiler(ctx))

        const provided = ctx.get(name) as DefaultCompiler
        expect(provided).toBeInstanceOf(DefaultCompiler)
        expect(provided).toBeInstanceOf(Compiler)
    })
})
