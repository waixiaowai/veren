import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InjectorServiceDefault, {
    Injector,
    InjectorService,
    defineToken,
    get,
    getOrThrow,
    provide,
    set,
} from '../src/index'

/**
 * 每个用例独立 new Context()；所有 provide/effect 返回的 disposer 收集到这里，
 * afterEach 统一清理，避免用例之间互相污染。
 *
 * Every test creates its own Context; disposers returned by provide/effect are
 * collected here and disposed in afterEach so cases cannot leak into each other.
 */
const disposers: Array<() => Promise<unknown>> = []

afterEach(async () => {
    await Promise.allSettled(disposers.map((d) => d()))
    disposers.length = 0
})

describe('defineToken', () => {
    it('返回描述字符串本身 / returns the descriptor string itself', () => {
        const token = defineToken<number>('veren/my-token')
        expect(token).toBe('veren/my-token')
        expect(typeof token).toBe('string')
    })

    it('类型标注不影响值相等性 / type parameters do not affect value equality', () => {
        const a = defineToken<string>('veren/shared')
        const b = defineToken<number>('veren/shared')
        expect(a).toBe(b)
        expect(defineToken<boolean>('veren/other')).not.toBe(a)
    })
})

describe('provide', () => {
    it('provide 后可通过 get 取到值 / value is readable via get after provide', () => {
        const ctx = new Context()
        const token = defineToken<string>('veren/provided')
        const disposer = provide(ctx, token, 'hello')
        disposers.push(disposer)
        expect(get(ctx, token)).toBe('hello')
    })

    it('同一上下文可 provide 多个不同 token / one context can provide several tokens', () => {
        const ctx = new Context()
        const t1 = defineToken<number>('veren/one')
        const t2 = defineToken<string>('veren/two')
        disposers.push(provide(ctx, t1, 1))
        disposers.push(provide(ctx, t2, 'two'))
        expect(get(ctx, t1)).toBe(1)
        expect(get(ctx, t2)).toBe('two')
    })

    it('disposer 可重复调用（幂等）且不抛错 / the disposer is idempotent and never throws', async () => {
        const ctx = new Context()
        const token = defineToken<number>('veren/idempotent')
        const disposer = provide(ctx, token, 42)
        disposers.push(disposer)
        // 首次调用返回 Promise / the first call returns a Promise
        await expect(disposer()).resolves.toBeUndefined()
        // 重复调用安全（幂等），返回 undefined，不抛错
        // Repeated calls are safe (idempotent) and return undefined without throwing.
        expect(disposer()).toBeUndefined()
        expect(get(ctx, token)).toBeUndefined()
    })

    it('dispose 后 get 变为 undefined，且可重新 provide / after dispose get is undefined and re-provide works', async () => {
        const ctx = new Context()
        const token = defineToken<string>('veren/reprovide')
        const disposer = provide(ctx, token, 'first')
        disposers.push(disposer)
        expect(get(ctx, token)).toBe('first')

        await disposer()
        expect(get(ctx, token)).toBeUndefined()

        const disposer2 = provide(ctx, token, 'second')
        disposers.push(disposer2)
        expect(get(ctx, token)).toBe('second')
    })
})

describe('set', () => {
    it('可覆盖已 provide 的值 / overwrites a value that was already provided', () => {
        const ctx = new Context()
        const token = defineToken<number>('veren/settable')
        disposers.push(provide(ctx, token, 1))
        set(ctx, token, 2)
        expect(get(ctx, token)).toBe(2)
    })

    it('对未 provide 的名字抛错 / throws for a name that was never provided', () => {
        const ctx = new Context()
        const token = defineToken<string>('veren/missing')
        expect(() => set(ctx, token, 'value')).toThrowError(
            'cannot set property "veren/missing" without provide',
        )
    })
})

describe('get', () => {
    it('缺失时返回 undefined / returns undefined when the token is absent', () => {
        const ctx = new Context()
        const token = defineToken<number>('veren/absent')
        expect(get(ctx, token)).toBeUndefined()
    })

    it('可以取到 falsy 值（get 本身不抛错）/ returns falsy values without throwing', () => {
        const ctx = new Context()
        const tZero = defineToken<number>('veren/zero')
        const tEmpty = defineToken<string>('veren/empty')
        const tFalse = defineToken<boolean>('veren/false')
        disposers.push(provide(ctx, tZero, 0))
        disposers.push(provide(ctx, tEmpty, ''))
        disposers.push(provide(ctx, tFalse, false))
        expect(get(ctx, tZero)).toBe(0)
        expect(get(ctx, tEmpty)).toBe('')
        expect(get(ctx, tFalse)).toBe(false)
    })
})

describe('getOrThrow', () => {
    it('正常返回已提供的值 / returns the provided value', () => {
        const ctx = new Context()
        const token = defineToken<string>('veren/present')
        disposers.push(provide(ctx, token, 'value'))
        expect(getOrThrow(ctx, token)).toBe('value')
    })

    it('缺失时抛出明确错误 / throws a descriptive error when the token is absent', () => {
        const ctx = new Context()
        const token = defineToken<number>('veren/nothing')
        expect(() => getOrThrow(ctx, token)).toThrowError(
            'Value for token veren/nothing not found in context',
        )
    })

    it.each([0, '', false, null])(
        '值为 falsy（%p）时同样抛错 / also throws for the falsy value %p',
        (value) => {
            const ctx = new Context()
            const token = defineToken<unknown>('veren/falsy')
            disposers.push(provide(ctx, token, value))
            // 值确实在上下文里，但 getOrThrow 仍按 falsy 抛错（现有实现的真实行为）
            // The value is really in the context, yet getOrThrow still throws on
            // falsy values — asserted here as the actual behavior of the implementation.
            expect(get(ctx, token)).toBe(value)
            expect(() => getOrThrow(ctx, token)).toThrowError(
                'Value for token veren/falsy not found in context',
            )
        },
    )
})

describe('InjectorService', () => {
    it('构造时注册为 injector 服务 / registers itself as the injector service', () => {
        const ctx = new Context()
        const service = new InjectorService(ctx)
        expect(Injector).toBe('injector')
        // cordis 4.0.4：ctx.injector 每次访问返回一个扩展视图，并非同一引用，
        // 但它是 InjectorService 实例且结构等同。
        // In cordis 4.0.4 every `ctx.injector` read returns a fresh extended view,
        // so it is not reference-equal; it is still an InjectorService and structurally equal.
        expect(ctx.injector).toBeInstanceOf(InjectorService)
        expect(ctx.injector.name).toBe('injector')
        expect(ctx.injector).toEqual(service)
        expect(get(ctx, Injector)).toBeInstanceOf(InjectorService)
        expect(get(ctx, Injector)).toEqual(service)
    })

    it('provide / get / getOrThrow 转发到上下文 / instance methods forward to the context', async () => {
        const ctx = new Context()
        const service = new InjectorService(ctx)
        const token = defineToken<string>('veren/via-service')

        const disposer = service.provide(token, 'first')
        disposers.push(disposer)
        expect(service.get(token)).toBe('first')
        expect(service.getOrThrow(token)).toBe('first')

        set(ctx, token, 'second')
        expect(service.get(token)).toBe('second')

        await disposer()
        expect(service.get(token)).toBeUndefined()
        expect(() => service.getOrThrow(token)).toThrowError(
            'Value for token veren/via-service not found in context',
        )
    })

    it('默认导出即 InjectorService 类 / the default export is the InjectorService class', () => {
        expect(InjectorServiceDefault).toBe(InjectorService)
        expect(typeof InjectorServiceDefault).toBe('function')
        expect(new InjectorServiceDefault(new Context())).toBeInstanceOf(InjectorService)
    })
})
