import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'
import { createMemoryCompilerHost } from '@veren/compiler-host'

/**
 * 包外验证 compiler-host 的入口导出：不再走相对源码路径。
 * External check of the compiler-host entry export: no relative source paths.
 */
describe('external compiler-host entry', () => {
    it('从包入口导出 createMemoryCompilerHost', () => {
        expect(createMemoryCompilerHost).toBeTypeOf('function')

        const options: ts.CompilerOptions = { noLib: true, types: [] }
        const source = ts.createSourceFile(
            '/virtual/mem.ts',
            'export const value: number = 1',
            ts.ScriptTarget.ES2022,
            true,
        )
        const host = createMemoryCompilerHost(options, [source])
        const program = ts.createProgram(['/virtual/mem.ts'], options, host)

        expect(program.getSourceFile('/virtual/mem.ts')?.statements).toHaveLength(1)
    })
})
