import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyHost, name as CompilerHostToken } from '@veren/compiler-host'
import { name as CompilerOptionsToken } from '@veren/compiler-options'
import { name as ProgramToken } from '@veren/compiler-program'
import { name as TypeCheckerToken } from '@veren/compiler-type-checker'
import { DefaultCompiler, inject, name } from '../src/index'
import { disposeTracked, setupCtx } from './helpers'

afterEach(async () => {
    await disposeTracked()
})

/**
 * 令牌接线与服务解析：name/inject 的契约、getter 与上下文服务同源、
 * 缺服务时 fail-fast。
 * Token wiring and service resolution: the name/inject contract, getters
 * resolving the same service instances as the context, and fail-fast on
 * missing services.
 */
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
})
