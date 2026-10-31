import { afterEach, describe, expect, it } from 'vitest'
import { Compiler, DefaultCompiler, apply as applyCompiler, name } from '../src/index'
import { disposeTracked, setupCtx, trackDisposer } from './helpers'

afterEach(async () => {
    await disposeTracked()
})

/**
 * provider（apply）：把接线好的 DefaultCompiler 提供到上下文。
 * The provider (apply): provides the wired DefaultCompiler to the context.
 */
describe('provider (apply)', () => {
    it('apply 将 DefaultCompiler 实例提供到上下文，且 instanceof Compiler 成立', () => {
        const ctx = setupCtx()
        trackDisposer(applyCompiler(ctx))

        const provided = ctx.get(name) as DefaultCompiler
        expect(provided).toBeInstanceOf(DefaultCompiler)
        expect(provided).toBeInstanceOf(Compiler)
    })
})
