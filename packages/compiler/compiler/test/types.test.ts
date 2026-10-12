import { afterEach, describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import { defineToken, getOrThrow, provide } from '@veren/core'
import { Compiler, type CompileInput, type EmitResult, type TypeMetadata, type TypeMetadataKind } from '../src/types'

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
 * TestCompiler 专用的本地测试令牌，仅用于给这个最小子类注入依赖，
 * 与被测包导出的真实 `veren*` 令牌无关。
 * Local fixtures used only to wire this minimal subclass; they are unrelated
 * to the real `veren*` tokens exported by the packages under test.
 */
const OptionsToken = defineToken<ts.CompilerOptions>('test/compilerOptions')
const ProgramToken = defineToken<ts.Program>('test/program')
const CheckerToken = defineToken<ts.TypeChecker>('test/typeChecker')

/**
 * 最小具体子类：实现五个抽象阶段，并用公开数组记录阶段调用顺序，
 * 便于断言模板方法 compile 的流水线编排与各查询接口的行为。
 * A minimal concrete subclass implementing the five abstract stages while
 * recording stage call order in a public array, so the template-method
 * pipeline and the query APIs can be asserted.
 */
class TestCompiler extends Compiler {
    /** 阶段调用顺序记录 */
    /** Recorded stage call order */
    readonly calls: string[] = []

    /** analyze 阶段上报诊断的类别（默认 Warning，可按用例调整） */
    /** Diagnostic category reported during analyze (defaults to Warning; adjustable per test) */
    analyzeCategory: ts.DiagnosticCategory = ts.DiagnosticCategory.Warning

    constructor(private readonly ctx: Context) {
        super()
    }

    get options(): ts.CompilerOptions {
        return getOrThrow(this.ctx, OptionsToken)
    }

    get program(): ts.Program {
        return getOrThrow(this.ctx, ProgramToken)
    }

    get checker(): ts.TypeChecker {
        return getOrThrow(this.ctx, CheckerToken)
    }

    protected load(inputs: readonly CompileInput[]): readonly ts.SourceFile[] {
        this.calls.push('load')
        return inputs.map((input) => {
            if (input.content === undefined) {
                throw new Error(`TestCompiler: ${input.fileName} 未提供 content`)
            }
            return ts.createSourceFile(input.fileName, input.content, ts.ScriptTarget.ES2022, /* setParentNodes */ true)
        })
    }

    protected parse(_files: readonly ts.SourceFile[]): ts.Program {
        this.calls.push('parse')
        return this.program
    }

    protected analyze(): void {
        this.calls.push('analyze')
        this.report(makeDiagnostic(this.analyzeCategory, 'analyze-first'))
        this.report(makeDiagnostic(this.analyzeCategory, 'analyze-second'))
    }

    protected collect(files: readonly ts.SourceFile[]): void {
        this.calls.push('collect')
        for (const sf of files) {
            // 每个文件调用两次 addMetadata，验证多次归档的累加语义
            // Call addMetadata twice per file to verify the append semantics of repeated archiving
            this.addMetadata(sf.fileName, [makeMetadata('interface', 'I', sf.fileName)])
            this.addMetadata(sf.fileName, [makeMetadata('type-alias', 'T', sf.fileName)])
        }
    }

    protected emit(): EmitResult {
        this.calls.push('emit')
        return { metadata: [...this.metadataRegistry.values()].flat(), output: 'test-emit' }
    }
}

/** 构造一条仅含必要字段的最小诊断（按 ts.Diagnostic 形状收窄） */
/** Build a minimal diagnostic carrying only the required fields (narrowed to ts.Diagnostic) */
const makeDiagnostic = (category: ts.DiagnosticCategory, messageText: string): ts.Diagnostic =>
    ({ category, code: 5000, messageText }) as ts.Diagnostic

/** 构造一条最小类型元数据 */
/** Build a minimal TypeMetadata entry */
const makeMetadata = (kind: TypeMetadataKind, name: string, fileName: string): TypeMetadata => ({
    kind,
    name,
    span: { fileName, start: 0, end: 0, line: 0, character: 0 },
})

/** 常规编译输入（含 content，走内存源码路径） */
/** A regular compile input (with content; the in-memory source path) */
const input = (fileName: string, content = 'export interface A { x: number }'): CompileInput => ({ fileName, content })

/**
 * 每个用例独立的 Context：提供 options/program/checker 三个服务后构造 TestCompiler。
 * 每次调用都 new 一个 Context，避免跨用例复用导致 "service already registered"。
 * A fresh Context per test: provide the options/program/checker services, then
 * build TestCompiler. Always a new Context so services never collide across tests.
 */
const setup = (): TestCompiler => {
    const ctx = new Context()
    const options: ts.CompilerOptions = {}
    const program = ts.createProgram([], options)
    disposers.push(provide(ctx, OptionsToken, options))
    disposers.push(provide(ctx, ProgramToken, program))
    disposers.push(provide(ctx, CheckerToken, program.getTypeChecker()))
    return new TestCompiler(ctx)
}

describe('Compiler 抽象类（模板方法流水线）', () => {
    it('compile 按 load→parse→analyze→collect→emit 顺序执行，并返回 emit 的结果', () => {
        const compiler = setup()
        const result = compiler.compile([input('a.ts')])

        expect(compiler.calls).toEqual(['load', 'parse', 'analyze', 'collect', 'emit'])
        // 返回值即 emit 阶段产物：registry 展平 + 自定义 output
        // The return value is exactly the emit product: flattened registry plus custom output
        expect(result.output).toBe('test-emit')
        expect(result.metadata).toEqual(compiler.getMetadata('a.ts'))
        expect(result.metadata).toHaveLength(2)
    })

    it('compile 幂等：重复编译先 reset，不残留上一次的 registry 与 diagnostics', () => {
        const compiler = setup()
        compiler.compile([input('a.ts')])
        compiler.compile([input('b.ts')])

        // 第一次的归档与诊断已被清空，只余第二次的结果
        // The first run's archive and diagnostics were reset; only the second run remains
        expect(compiler.getMetadata('a.ts')).toEqual([])
        expect(compiler.getMetadata('b.ts')).toHaveLength(2)
        expect(compiler.getDiagnostics()).toHaveLength(2)
    })

    it('getMetadata 在 compile 之前调用时抛错（parseDone 状态守卫）', () => {
        const compiler = setup()
        expect(() => compiler.getMetadata('a.ts')).toThrowError('Compiler: parse 尚未完成，请先调用 compile()')
    })

    it('compile 后 getMetadata：未知文件返回空数组，归档文件返回全部条目（多次 addMetadata 累加）', () => {
        const compiler = setup()
        compiler.compile([input('a.ts')])

        // collect 对 a.ts 调用了两次 addMetadata，两条都应保留且按序
        // collect called addMetadata twice for a.ts; both entries must be kept in order
        expect(compiler.getMetadata('a.ts').map((m) => m.kind)).toEqual(['interface', 'type-alias'])
        expect(compiler.getMetadata('a.ts').map((m) => m.name)).toEqual(['I', 'T'])
        // 从未归档的文件返回空数组
        // Unknown files yield an empty array
        expect(compiler.getMetadata('unknown.ts')).toEqual([])
    })

    it('getDiagnostics 初始为空，report 后按上报顺序返回；Warning 级不算错误', () => {
        const compiler = setup()
        expect(compiler.getDiagnostics()).toEqual([])
        expect(compiler.hasErrors()).toBe(false)

        compiler.compile([input('a.ts')])
        expect(compiler.getDiagnostics().map((d) => d.messageText)).toEqual(['analyze-first', 'analyze-second'])
        expect(compiler.hasErrors()).toBe(false)
    })

    it('hasErrors 仅在存在 Error 级诊断时为 true（Warning/Suggestion/Message 都不算）', () => {
        for (const category of [ts.DiagnosticCategory.Warning, ts.DiagnosticCategory.Suggestion, ts.DiagnosticCategory.Message]) {
            const compiler = setup()
            compiler.analyzeCategory = category
            compiler.compile([input('a.ts')])
            expect(compiler.getDiagnostics()).toHaveLength(2)
            expect(compiler.hasErrors()).toBe(false)
        }

        const errored = setup()
        errored.analyzeCategory = ts.DiagnosticCategory.Error
        errored.compile([input('a.ts')])
        expect(errored.hasErrors()).toBe(true)
    })

    it('load 抛错时异常向上传播，且 parseDone 保持 false（getMetadata 仍抛错）', () => {
        const compiler = setup()
        expect(() => compiler.compile([{ fileName: 'missing.ts' }])).toThrowError(/missing\.ts/)
        // 流水线在 load 阶段即中断，诊断未被污染
        // The pipeline halts at the load stage and diagnostics stay untouched
        expect(compiler.calls).toEqual(['load'])
        expect(compiler.getDiagnostics()).toEqual([])
        expect(() => compiler.getMetadata('missing.ts')).toThrowError('parse 尚未完成')
    })
})
