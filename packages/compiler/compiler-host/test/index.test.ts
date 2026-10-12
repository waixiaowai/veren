import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as ts from 'typescript'
import { fileURLToPath } from 'node:url'
import { name as CompilerOptionsToken } from '@veren/compiler-options'
import { apply, Config, inject, name } from '../src/index'

/**
 * 每个用例使用独立的 cordis Context;apply / ctx.provide 返回的 disposer
 * 统一收进 disposers,并在 afterEach 中全部清理,避免服务跨用例泄漏
 * (复用同一个 Context 会报 "service already registered")。
 *
 * Every test builds its own cordis Context. Disposers returned by apply /
 * ctx.provide are collected here and disposed in afterEach, so no service
 * leaks across cases (reusing one Context would fail with
 * "service already registered").
 */
const disposers: Array<() => unknown> = []

afterEach(async () => {
    await Promise.allSettled(disposers.map((dispose) => dispose()))
    disposers.length = 0
})

/** 创建一个已提供 compilerOptions 的 Context,并登记其清理函数。
 *  Create a Context with compilerOptions provided, registering its disposer. */
const createContextWithOptions = (options: ts.CompilerOptions = {}) => {
    const ctx = new Context()
    disposers.push(ctx.provide(CompilerOptionsToken, options))
    return ctx
}

describe('compilerHost provider', () => {
    it('name 是字符串 token,inject 依赖 compilerOptions / name is a string token and inject depends on compilerOptions', () => {
        // 令牌加 `veren` 前缀以避免跨包重名。
        // Tokens carry the `veren` prefix to avoid collisions between packages.
        expect(name).toBe('verenCompilerHost')
        expect(CompilerOptionsToken).toBe('verenCompilerOptions')
        expect(inject).toEqual([CompilerOptionsToken])
    })

    it('Config({}) 将 setParentNodes 归一化为默认值 false', () => {
        expect(Config({})).toEqual({ setParentNodes: false })
    })

    it('Config({ setParentNodes: true }) 原样通过', () => {
        expect(Config({ setParentNodes: true })).toEqual({ setParentNodes: true })
    })

    it('Config 校验失败(setParentNodes 不是 boolean)时抛错', () => {
        expect(() => Config({ setParentNodes: 'x' as any })).toThrow()
    })

    it('上下文缺少 compilerOptions 时 apply 抛错', () => {
        // 独立空 Context:没有提供任何 compilerOptions 服务。
        // A standalone empty Context without any compilerOptions service.
        const ctx = new Context()
        expect(() => apply(ctx, Config({}))).toThrowError(
            `Value for token ${CompilerOptionsToken} not found in context`,
        )
    })

    it('apply 基于 compilerOptions 创建 host 并提供到上下文', () => {
        const ctx = createContextWithOptions({ target: ts.ScriptTarget.ES2022 })
        disposers.push(apply(ctx, Config({})))

        const host = ctx.get(name) as ts.CompilerHost
        expect(host).toBeDefined()
        // 服务确实按令牌字符串 'verenCompilerHost' 注册,字符串键也能取到同一实例。
        // The service is registered under the token string 'verenCompilerHost', so
        // the plain string key resolves to the very same instance.
        expect(ctx.get('verenCompilerHost')).toBe(host)
        expect(host.getSourceFile).toBeTypeOf('function')
        expect(host.getCanonicalFileName).toBeTypeOf('function')
    })

    it('apply 返回 disposer,调用后取消提供', async () => {
        const ctx = createContextWithOptions({})
        const disposer = apply(ctx, Config({}))
        expect(typeof disposer).toBe('function')

        // 这里手动清理,不再放进 disposers,避免 afterEach 重复 dispose。
        // Dispose manually here and keep it out of `disposers` so afterEach
        // does not dispose it a second time.
        await disposer()
        expect(ctx.get(name)).toBeUndefined()
    })

    describe('setParentNodes 转发给 ts.createCompilerHost', () => {
        // 取一个真实存在的 .ts 文件:默认 host 会从磁盘读取后再解析。
        // Use a real .ts file: the default host reads it from disk first.
        const realFile = fileURLToPath(new URL('../src/index.ts', import.meta.url))

        const loadFirstStatement = (config: Config) => {
            const ctx = createContextWithOptions({})
            disposers.push(apply(ctx, config))
            const host = ctx.get(name) as ts.CompilerHost
            return host.getSourceFile!(realFile, ts.ScriptTarget.ES2022)!
        }

        it('setParentNodes: true 时子节点挂上 parent 链', () => {
            const sf = loadFirstStatement(Config({ setParentNodes: true }))
            expect(sf.statements.length).toBeGreaterThan(0)
            expect(sf.statements[0]!.parent).toBe(sf)
        })

        it('setParentNodes: false 时不维护 parent', () => {
            const sf = loadFirstStatement(Config({ setParentNodes: false }))
            expect(sf.statements.length).toBeGreaterThan(0)
            expect(sf.statements[0]!.parent).toBeUndefined()
        })
    })
})
