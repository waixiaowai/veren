import * as ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProgramToken } from '@veren/compiler-program'
import { DefaultCompiler } from '../src/index'
import { ProbeCompiler, disposeTracked, setupCtx } from './helpers'

afterEach(async () => {
    await disposeTracked()
})

/**
 * load 与 parse 两个阶段：磁盘回读、内存源码、target 回退与 Program 选择。
 * The load and parse stages: disk fallback, in-memory sources, the target
 * fallback and Program selection.
 */
describe('DefaultCompiler', () => {
    it('缺 content 时从磁盘读取；文件不存在时给出明确错误', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'veren-compiler-'))
        try {
            const file = join(dir, 'disk.ts')
            await writeFile(file, 'export interface Disk { y: string }', 'utf8')

            const compiler = new DefaultCompiler(setupCtx())
            const result = compiler.compile([{ fileName: file }])
            expect(result.metadata.map((entry) => entry.name)).toContain('Disk')

            const missing = new DefaultCompiler(setupCtx())
            expect(() => missing.compile([{ fileName: join(dir, 'missing.ts') }])).toThrowError(/无法读取/)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
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

    it('parse([]) 回退到上下文 program；parse(files) 用输入源码新建 program', () => {
        const ctx = setupCtx()
        const compiler = new ProbeCompiler(ctx)
        expect(compiler.parse([])).toBe(ctx.get(ProgramToken))

        const [sf] = compiler.load([{ fileName: 'p.ts', content: 'export interface P { x: number }' }])
        const program = compiler.parse([sf])
        expect(program).not.toBe(ctx.get(ProgramToken))
        expect(program.getSourceFile('p.ts')?.text).toContain('interface P')
        expect(compiler.checker).toBe(program.getTypeChecker())
    })
})
