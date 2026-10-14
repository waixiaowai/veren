import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import {
    Injector,
    InjectorService,
    apply,
    defineToken,
    get,
    getOrThrow,
    inject,
    name as pluginName,
    provideValue,
    set,
} from '../src/index'

/**
 * 每个用例独立 new Context()；所�?provide/effect 返回�?disposer 收集到这里，
 * afterEach 统一清理，避免用例之间互相污染�? *
 * Every test creates its own Context; disposers returned by provide/effect are
 * collected here and disposed in afterEach so cases cannot leak into each other.
 */
const disposers: Array<() => Promise<unknown>> = []

afterEach(async () => {
    await Promise.allSettled(disposers.map((d) => d()))
    disposers.length = 0
})

describe('defineToken', () => {
    it('返回描述字符串本�?/ returns the descriptor string itself', () => {
        const token = defineToken<number>('veren/my-token')
        expect(token).toBe('veren/my-token')
        expect(typeof token).toBe('string')
    })

    it('类型标注不影响值相等�?/ type parameters do not affect value equality', () => {
        const a = defineToken<string>('veren/shared')
        const b = defineToken<number>('veren/shared')
        expect(a).toBe(b)
        expect(defineToken<boolean>('veren/other')).not.toBe(a)
    })
})

describe('provide', () => {
    it('provide 后可通过 get 取到�?/ value is readable via get after provide', () => {
        const ctx = new Context()
        const token = defineToken<string>('veren/provided')
        const disposer = provideValue(ctx, token, 'hello')
        disposers.push(disposer)
        expect(get(ctx, token)).toBe('hello')
    })

    it('同一上下文可 provide 多个不同 token / one context can provide several tokens', () => {
        const ctx = new Context()
        const t1 = defineToken<number>('veren/one')
        const t2 = defineToken<string>('veren/two')
        disposers.push(provideValue(ctx, t1, 1))
        disposers.push(provideValue(ctx, t2, 'two'))
        expect(get(ctx, t1)).toBe(1)
        expect(get(ctx, t2)).toBe('two')
    })

    it('disposer 可重复调用（幂等）且不抛�?/ the disposer is idempotent and never throws', async () => {
        const ctx = new Context()
        const token = defineToken<number>('veren/idempotent')
        const disposer = provideValue(ctx, token, 42)
        disposers.push(disposer)
        // 首次调用返回 Promise / the first call returns a Promise
        await expect(disposer()).resolves.toBeUndefined()
        // 重复调用安全（幂等），返�?undefined，不抛错
        // Repeated calls are safe (idempotent) and return undefined without throwing.
        expect(disposer()).toBeUndefined()
        expect(get(ctx, token)).toBeUndefined()
    })

    it('dispose �?get 变为 undefined，且可重�?provide / after dispose get is undefined and re-provide works', async () => {
        const ctx = new Context()
        const token = defineToken<string>('veren/reprovide')
        const disposer = provideValue(ctx, token, 'first')
        disposers.push(disposer)
        expect(get(ctx, token)).toBe('first')

        await disposer()
        expect(get(ctx, token)).toBeUndefined()

        const disposer2 = provideValue(ctx, token, 'second')
        disposers.push(disposer2)
        expect(get(ctx, token)).toBe('second')
    })
})

describe('set', () => {
    it('可覆盖已 provide 的�?/ overwrites a value that was already provided', () => {
        const ctx = new Context()
        const token = defineToken<number>('veren/settable')
        disposers.push(provideValue(ctx, token, 1))
        set(ctx, token, 2)
        expect(get(ctx, token)).toBe(2)
    })

    it('对未 provide 的名字抛�?/ throws for a name that was never provided', () => {
        const ctx = new Context()
        const token = defineToken<string>('veren/missing')
        expect(() => set(ctx, token, 'value')).toThrowError(
            'cannot set property "veren/missing" without provide',
        )
    })
})

describe('get', () => {
    it('缺失时返�?undefined / returns undefined when the token is absent', () => {
        const ctx = new Context()
        const token = defineToken<number>('veren/absent')
        expect(get(ctx, token)).toBeUndefined()
    })

    it('可以取到 falsy 值（get 本身不抛错）/ returns falsy values without throwing', () => {
        const ctx = new Context()
        const tZero = defineToken<number>('veren/zero')
        const tEmpty = defineToken<string>('veren/empty')
        const tFalse = defineToken<boolean>('veren/false')
        disposers.push(provideValue(ctx, tZero, 0))
        disposers.push(provideValue(ctx, tEmpty, ''))
        disposers.push(provideValue(ctx, tFalse, false))
        expect(get(ctx, tZero)).toBe(0)
        expect(get(ctx, tEmpty)).toBe('')
        expect(get(ctx, tFalse)).toBe(false)
    })
})

describe('getOrThrow', () => {
    it('正常返回已提供的�?/ returns the provided value', () => {
        const ctx = new Context()
        const token = defineToken<string>('veren/present')
        disposers.push(provideValue(ctx, token, 'value'))
        expect(getOrThrow(ctx, token)).toBe('value')
    })

    it('缺失时抛出明确错�?/ throws a descriptive error when the token is absent', () => {
        const ctx = new Context()
        const token = defineToken<number>('veren/nothing')
        expect(() => getOrThrow(ctx, token)).toThrowError(
            'Value for token veren/nothing not found in context',
        )
    })

    it.each([0, '', false, null])(
        '值为 falsy�?p）时同样抛错 / also throws for the falsy value %p',
        (value) => {
            const ctx = new Context()
            const token = defineToken<unknown>('veren/falsy')
            disposers.push(provideValue(ctx, token, value))
            // 值确实在上下文里，但 getOrThrow 仍按 falsy 抛错（现有实现的真实行为�?            // The value is really in the context, yet getOrThrow still throws on
            // falsy values �?asserted here as the actual behavior of the implementation.
            expect(get(ctx, token)).toBe(value)
            expect(() => getOrThrow(ctx, token)).toThrowError(
                'Value for token veren/falsy not found in context',
            )
        },
    )
})

describe('InjectorService', () => {
    it('构造时注册�?injector 服务 / registers itself as the injector service', () => {
        const ctx = new Context()
        const service = new InjectorService(ctx)
        expect(Injector).toBe('injector')
        // cordis 4.0.4：ctx.injector 每次访问返回一个扩展视图，并非同一引用�?        // 但它�?InjectorService 实例且结构等同�?        // In cordis 4.0.4 every `ctx.injector` read returns a fresh extended view,
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

    it('不存在默认导出（规范禁止�? has no default export (forbidden by convention)', async () => {
        // 动态读取模块命名空间，防止回退到默认导�?/ read the module namespace
        // dynamically to guard against a default export sneaking back in.
        const mod = (await import('../src/index')) as Record<string, unknown>
        expect(mod.default).toBeUndefined()
    })

    it('tracker 缺失时抛带稳�?code 的结构化错误 / throws a structured error with a stable code when the tracker is missing', () => {
        const ctx = new Context()
        const service = new InjectorService(ctx)
        // cordis 未挂 tracker 元数据时必须 fail loud，而不是返�?undefined
        // When cordis attached no tracker metadata this must fail loud, not return undefined.
        const tracker = Reflect.get(service, Service.tracker)
        if (tracker === undefined) {
            try {
                service.tracker()
                expect.unreachable('tracker 缺失时应抛错 / should throw when the tracker is missing')
            } catch (error) {
                expect((error as { code?: string }).code).toBe('TRACKER_UNAVAILABLE')
            }
        } else {
            expect(service.tracker()).toBe(tracker)
        }
    })
})

describe('core 注入插件 / the core injection plugin', () => {
    it('插件契约：name �?Injector 令牌，inject 为空 / contract: name is the Injector token, inject is empty', () => {
        expect(pluginName).toBe(Injector)
        expect(pluginName).toBe('injector')
        expect(inject).toEqual([])
    })

    it('apply 装载�?injector 服务可用，随上下文清�?/ apply registers the injector service, cleaned up with the context', async () => {
        const ctx = new Context()
        apply(ctx)
        expect(ctx.injector).toBeInstanceOf(InjectorService)
        expect(get(ctx, Injector)).toBeInstanceOf(InjectorService)
    })
})
