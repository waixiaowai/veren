/**
 * The echo renderer extension is one keyed registration: it appears for
 * `echo`, unregisters with its fiber (HMR safety), and its dictionaries stay
 * key-identical.
 *
 * echo 渲染器扩展只有一个 keyed 注册：它出现在 `echo` 上、随 fiber 卸载（HMR 安全），
 * 且两份词典键集合一致。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

/** A locale service with the three methods the plugin reads. */
function locale() {
    const dictionaries = new Map<string, unknown>()
    return {
        register(namespace: string, dictionary: unknown) {
            dictionaries.set(namespace, dictionary)
            return () => { dictionaries.delete(namespace) }
        },
        bind() {
            return (key: string) => key
        },
        subscribe() {
            return () => {}
        },
    }
}

describe('flow-canvas node echo renderer', () => {
    it('registers the echo key and withdraws it with the fiber', async () => {
        const ctx = new Context()
        await ctx.plugin(SlotRegistry).await()
        ctx.slots.register({
            name: 'root',
            children: { 'flow.canvas.node': { kind: 'keyed', scope: 'root' } },
        } as never, () => null)
        ctx.provide('locale', locale() as never)

        const fiber = ctx.plugin({ inject: [...inject], apply })
        await fiber.await()
        expect(ctx.slots.entries('flow.canvas.node').map(entry => entry.options.key)).toEqual(['echo'])

        await fiber.dispose()
        expect(ctx.slots.entries('flow.canvas.node')).toEqual([])
    })

    it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
        expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    })
})
