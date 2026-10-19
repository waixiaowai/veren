import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { Context } from '@deepseek-ai/cordis'
import {
    Compiler,
    DefaultCompiler,
    type CompileInput,
} from '@veren/compiler-compiler'

/**
 * 包外扩展示例：只从包入口 import，继承 DefaultCompiler 并覆写 analyze，
 * 加一条"禁止 any"的防呆规则，然后调用默认的 compile。
 *
 * External extension: import only from the package entry, subclass
 * DefaultCompiler, override analyze with a "no any" guard, and run the default
 * compile pipeline.
 */
class NoAnyCompiler extends DefaultCompiler {
    protected override analyze(): void {
        super.analyze()
        for (const file of this.program.getSourceFiles()) {
            if (file.isDeclarationFile) continue
            const match = /:\s*any\b/.exec(file.text)
            if (!match) continue
            this.report({
                category: ts.DiagnosticCategory.Warning,
                code: 9001,
                file,
                start: match.index,
                length: match[0].length,
                messageText: '禁止使用 any / avoid any',
            })
        }
    }
}

/** 只提供 options 服务；有输入时 compile 会自建 Program / Only the options service is needed; compile builds a Program from the inputs */
const createCompiler = (): NoAnyCompiler => {
    const ctx = new Context()
    ctx.provide('verenCompilerOptions', { target: ts.ScriptTarget.ES2022 })
    return new NoAnyCompiler(ctx)
}

describe('external compiler extension', () => {
    it('继承 Compiler 的默认实现，跑通 compile 并拿到非空 metadata', () => {
        const compiler = createCompiler()
        const inputs: CompileInput[] = [
            {
                fileName: '/virtual/rule.ts',
                content: 'export interface Shape { x: number }\nexport const bad: any = 1',
            },
        ]

        const result = compiler.compile(inputs)

        expect(compiler).toBeInstanceOf(Compiler)
        expect(result.metadata.map((entry) => entry.name)).toEqual(['Shape'])
        expect(result.metadata[0]?.typeText).toBeTruthy()
        expect(compiler.getDiagnostics().some((diagnostic) => diagnostic.code === 9001)).toBe(true)
    })

    it('同一个 compile 换源码内容，metadata 不同', () => {
        const compiler = createCompiler()
        const first = compiler.compile([{ fileName: '/virtual/a.ts', content: 'export interface A { a: number }' }])
        const second = compiler.compile([{ fileName: '/virtual/a.ts', content: 'export interface B { b: string }' }])

        expect(first.metadata.map((entry) => entry.name)).toEqual(['A'])
        expect(second.metadata.map((entry) => entry.name)).toEqual(['B'])
    })
})
