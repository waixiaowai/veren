import { afterEach, describe, expect, it } from 'vitest'
import { DefaultCompiler } from '../src/index'
import type { CompileInput, TypeMetadata } from '../src/index'
import { AnalyzeOnlyCompiler, NoopStagesCompiler, PipelineCompiler, disposeTracked, setupCtx } from './helpers'

afterEach(async () => {
    await disposeTracked()
})

/**
 * compile 全流程：load → parse → analyze → collect → emit 的默认实现行为、
 * 诊断上报、checker 反解与自定义流水线子类。
 * The full compile flow: default behavior of load → parse → analyze →
 * collect → emit, diagnostic reporting, checker resolution and custom
 * pipeline subclasses.
 */
describe('DefaultCompiler', () => {
    it('compile 跑完全程：返回非空 metadata 与可序列化 output', () => {
        const compiler = new DefaultCompiler(setupCtx())
        const result = compiler.compile([
            { fileName: 'a.ts', content: 'export interface A { x: number }\nexport type B = string | number' },
        ])

        expect(result.metadata.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
            'interface:A',
            'type-alias:B',
        ])
        expect(result.output).toBeTypeOf('string')
        const parsed = JSON.parse(result.output!) as { files: string[]; metadata: TypeMetadata[] }
        expect(parsed.files).toEqual(['a.ts'])
        expect(parsed.metadata).toEqual(result.metadata)
        expect(compiler.getMetadata('a.ts')).toEqual(result.metadata)
    })

    it('同一个 compile 换源码内容，metadata 随之改变', () => {
        const compiler = new DefaultCompiler(setupCtx())
        const first = compiler.compile([{ fileName: 'same.ts', content: 'export interface First { a: number }' }])
        const second = compiler.compile([{ fileName: 'same.ts', content: 'export interface Second { b: string }' }])

        expect(first.metadata.map((entry) => entry.name)).toEqual(['First'])
        expect(second.metadata.map((entry) => entry.name)).toEqual(['Second'])
    })

    it('analyze 上报输入源码的语法/语义诊断，诊断随内容变化', () => {
        const compiler = new DefaultCompiler(setupCtx())
        const valid = compiler.compile([{ fileName: 'ok.ts', content: 'export interface Ok { x: number }' }])
        expect(valid.metadata).toHaveLength(1)
        expect(compiler.hasErrors()).toBe(false)

        compiler.compile([{ fileName: 'bad.ts', content: 'export interface {' }])
        expect(compiler.getDiagnostics().length).toBeGreaterThan(0)
        expect(compiler.hasErrors()).toBe(true)
    })

    it('collect 通过 checker 反解泛型、成员与继承', () => {
        const compiler = new DefaultCompiler(setupCtx())
        const result = compiler.compile([
            {
                fileName: 'model.ts',
                content:
                    'export interface Base { id: number }\n' +
                    'export interface Box<T extends object> extends Base { value: T; read(): string }',
            },
        ])

        const box = result.metadata.find((entry) => entry.name === 'Box')
        expect(box?.typeParameters?.[0]?.name).toBe('T')
        expect(box?.members?.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
            'property:value',
            'method:read',
        ])
        expect(box?.baseTypes).toEqual(['Base'])
    })

    it('仅覆写 analyze 且不调用 super 时，默认 collect 没有目标，产出空 metadata', () => {
        const compiler = new AnalyzeOnlyCompiler(setupCtx())
        const result = compiler.compile([{ fileName: 'a.ts', content: 'export const x = 1' }])

        expect(result.metadata).toEqual([])
    })

    it('覆写 analyze/collect 后，默认 emit 汇总仓库（空）并给出 output', () => {
        const compiler = new NoopStagesCompiler(setupCtx())
        const result = compiler.compile([{ fileName: 'a.ts', content: 'export const x = 1' }])

        expect(result.metadata).toEqual([])
        expect(result.output).toBe(JSON.stringify({ files: [], metadata: [] }))
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
