import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { defineToken, get } from '@veren/core'
import { apply, inject, name } from '../src/index'

/**
 * 令牌在上下文中的服务名：加 `veren` 前缀以避免跨包重名。
 * The service name of the token: prefixed with `veren` to avoid collisions
 * between packages.
 */
const TOKEN_VALUE = 'verenCompilerOptions'

/**
 * 每个用例各自创建的 Context 所产生的 disposer，统一在 afterEach 清理。
 * Disposers produced by the Context created in each test, cleaned up in afterEach.
 */
const disposers: Array<() => unknown> = []

afterEach(async () => {
    await Promise.allSettled(disposers.map((d) => d()))
    disposers.length = 0
})

describe('token', () => {
    it('name 是字符串 verenCompilerOptions，且与 defineToken 的结果相等 / name is the string verenCompilerOptions and equals defineToken(TOKEN_VALUE)', () => {
        expect(name).toBe(TOKEN_VALUE)
        expect(name).toBe(defineToken(TOKEN_VALUE))
    })

    it('inject 是空数组（无依赖）/ inject is an empty array (no dependencies)', () => {
        expect(Array.isArray(inject)).toBe(true)
        expect(inject).toEqual([])
        expect(inject).toHaveLength(0)
    })
})

describe('apply', () => {
    it('不传 config 时默认提供空对象 {} / provides an empty object when config is omitted', () => {
        const ctx = new Context()
        const disposer = apply(ctx)
        disposers.push(disposer)

        expect(get(ctx, name)).toEqual({})
    })

    it('字符串键与 token name 等价 / the plain string key is equivalent to the token', () => {
        const ctx = new Context()
        const disposer = apply(ctx, { strict: true })
        disposers.push(disposer)

        expect(ctx.get(TOKEN_VALUE)).toBe(get(ctx, name))
        expect(ctx.get(name)).toBe(get(ctx, name))
    })

    it('提供的是 config 的浅拷贝而非同一引用 / the provided options are a shallow copy, not the same reference', () => {
        const ctx = new Context()
        const config = { strict: true, lib: ['es2020'] }
        const disposer = apply(ctx, config)
        disposers.push(disposer)

        const provided = get(ctx, name)
        expect(provided).not.toBe(config)
        expect(provided).toEqual(config)
        // 浅拷贝语义：顶层字段被复制，嵌套对象仍共享同一引用。
        // Shallow-copy semantics: top-level fields are copied while nested
        // objects keep sharing the original reference.
        expect(provided?.lib).toBe(config.lib)
    })

    it('apply 之后修改原 config 不影响已提供的值（浅层字段）/ later mutations of the original config do not affect the provided value (top-level fields)', () => {
        const ctx = new Context()
        const config = { strict: true, lib: ['es2020'] }
        const disposer = apply(ctx, config)
        disposers.push(disposer)

        // 只修改浅层字段 / 新增字段
        // Only mutate top-level fields and add a new one.
        config.strict = false
        config.noEmit = true
        ;(config as Record<string, unknown>).extra = 1

        const provided = get(ctx, name)
        expect(provided).toEqual({ strict: true, lib: ['es2020'] })
        expect(provided?.strict).toBe(true)
        expect(provided?.noEmit).toBeUndefined()
        expect((provided as Record<string, unknown> | undefined)?.extra).toBeUndefined()
    })

    it('返回的 disposer 调用后服务被注销 / calling the returned disposer unregisters the service', async () => {
        const ctx = new Context()
        const disposer = apply(ctx, { strict: true })
        disposers.push(disposer)

        expect(get(ctx, name)).toEqual({ strict: true })

        await disposer()

        expect(get(ctx, name)).toBeUndefined()
        expect(ctx.get(TOKEN_VALUE)).toBeUndefined()
    })

    it('dispose 之后可重新 provide / the service can be provided again after disposal', async () => {
        const ctx = new Context()
        const first = apply(ctx, { strict: true })
        disposers.push(first)

        await first()
        expect(get(ctx, name)).toBeUndefined()

        const second = apply(ctx, { strict: false, target: 7 })
        disposers.push(second)

        expect(get(ctx, name)).toEqual({ strict: false, target: 7 })
    })
})
