/**
 * @veren/core - 轻量级令牌式依赖注入模块
 * 基于 @deepseek-ai/cordis 实现,提供类型安全的注入令牌(Token)定义、
 * 提供(provide)/设置(set)/获取(get, getOrThrow)工具函数,以及全局的 InjectorService 服务。
 *
 * @veren/core - Lightweight token-based dependency injection module.
 * Built on @deepseek-ai/cordis; provides type-safe token definitions,
 * provide/set/get/getOrThrow utilities, and a global InjectorService.
 */

import { Context, Service } from '@deepseek-ai/cordis';
const TOKEN = Symbol.for('@veren/core/token')
export type Token<T> = string & { readonly [TOKEN]?: T }
export const defineToken = <T>(desc: string): Token<T> => {
    return desc as Token<T>
}
/**
 * 提供一个值到上下文。
 * Provides a value to the context.
 *
 * @param ctx 目标上下文 / target context
 * @param token 注入令牌 / injection token
 * @param value 要提供的值 / value to provide
 * @returns 取消提供的 disposer，可重复调用且幂等
 *          a disposer that unregisters the value; idempotent and safe to call repeatedly
 */
export const provide = <T>(ctx: Context, token: Token<T>, value: T) => {
    return ctx.effect(() => ctx.provide(token, value), token)
}
/**
 * 更新设置一个值到上下文（仅对已 provide 且同 fiber 的名字有效）。
 * Updates a value in the context; only valid for a name that was already
 * provided in the same fiber, otherwise it throws.
 *
 * @param ctx 目标上下文 / target context
 * @param token 注入令牌 / injection token
 * @param value 新的值 / the new value
 * @returns void
 */
export const set = <T>(ctx: Context, token: Token<T>, value: T) => {
    return ctx.set(token, value)
}
/**
 * 从上下文中获取一个值。
 * Reads a value from the context.
 *
 * @param ctx 目标上下文 / target context
 * @param token 注入令牌 / injection token
 * @returns 获取到的值，或者 undefined / the stored value, or undefined when absent
 */
export const get = <T>(ctx: Context, token: Token<T>) => {
    return ctx.get(token) as T | undefined;
}
/**
 * 从上下文中获取一个值，取不到就抛出错误。
 * 注意：值为 falsy（0/''/false/null）时同样抛错。
 *
 * Reads a value from the context and throws when it is missing.
 * Note: falsy values (0/''/false/null) throw as well.
 *
 * @param ctx 目标上下文 / target context
 * @param token 注入令牌 / injection token
 * @returns 获取到的值（保证非空且非 falsy）/ the stored value (non-null and non-falsy)
 */
export const getOrThrow = <T>(ctx: Context, token: Token<T>) => {
    const value = get(ctx, token)
    if (!value) {
        throw new Error(`Value for token ${token} not found in context`)
    }
    return value
}

/** 全局注入服务令牌；其值就是 'injector'，没有 veren 前缀
 *  Token of the global injector service; its value is literally 'injector',
 *  without the `veren` prefix used by other packages. */
export const Injector = defineToken<InjectorService>('injector')
/**
 * 类型增强：让 `ctx.injector` 在类型层面可用。
 * 注意：每次访问 `ctx.injector` 都返回一个新的扩展视图（`===` 为 false），
 * 但它是 InjectorService 实例且结构等同。
 *
 * Type augmentation: makes `ctx.injector` visible to TypeScript.
 * Note: every `ctx.injector` read returns a fresh extended view (`===` is
 * false), yet it is an InjectorService instance and structurally equal.
 */
declare module '@deepseek-ai/cordis' {
    interface Context {
        injector: InjectorService
    }
}
/**
 * 注入服务：`new InjectorService(ctx)` 时即以 'injector' 注册为服务；
 * 实例方法只是把上面的工具函数转发到自己的 ctx。
 *
 * Injector service: constructing it registers the 'injector' service, and its
 * instance methods simply forward to the helpers above on its own context.
 */
export class InjectorService extends Service {
    constructor(ctx: Context) {
        super(ctx, Injector)
    }
    provide<T>(token: Token<T>, value: T) {
        return provide(this.ctx, token, value)
    }
    get<T>(token: Token<T>) {
        return get(this.ctx, token)
    }
    getOrThrow<T>(token: Token<T>) {
        return getOrThrow(this.ctx, token)
    }
}
export default InjectorService;