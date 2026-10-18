/**
 * Plugin wiring and HMR safety: the panel registers into the real `main` and
 * `sidebar.panellist` slots through `ctx.slots.inject`, declares its node
 * renderer child, and removes everything when the fiber disposes.
 *
 * 插件接线与 HMR 安全：面板经 `ctx.slots.inject` 注册进真实的 `main` 与
 * `sidebar.panellist` 槽位，声明节点渲染子槽位，并在 fiber 卸载时移除全部注册。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { CanvasFlow } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowId, NodeId } from '@deepseek-ai/dsh-graph-flow-api'
import type { FlowCanvasRemoteApi } from '../src/types.ts'
import { apply, inject, PANEL_ID } from '../src/client/index.ts'

/** A namespace face good enough for registration (the store loads lazily). */
function api(): FlowCanvasRemoteApi {
    return {
        async list() {
            return { ok: true, value: { flows: [{ id: 'flow-a' as FlowId, nodes: 1, edges: 0, outputs: [] }] } }
        },
        async project() {
            const flow: CanvasFlow = {
                schemaVersion: 1,
                flowId: 'flow-a' as FlowId,
                nodes: [{ id: 'a' as NodeId, type: 'echo', display: { label: 'A', subtitle: 'echo' }, onError: 'failFast', layout: null }],
                edges: [],
                output: {},
                hasInputSchema: false,
                layout: { viewport: null, nodes: {}, edges: {} },
                meta: { nodeCount: 1, edgeCount: 0 },
            }
            return { ok: true, value: flow }
        },
        async run() {
            return { ok: false, error: { code: 'NOT_USED', message: 'not used' } }
        },
        async answer() {
            return { ok: false, error: { code: 'NOT_USED', message: 'not used' } }
        },
        async cancel() {
            return { ok: false, error: { code: 'NOT_USED', message: 'not used' } }
        },
        subscribe() {
            return (async function* () {})()
        },
    }
}

/** A locale service with the three methods the plugin and the serializer read. */
function locale() {
    const dictionaries = new Map<string, unknown>()
    return {
        dictionaries,
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

/** Boot the real registry plus the two owner declarations the page needs. */
async function bench(): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
        name: 'root',
        children: {
            main: { kind: 'keyed', scope: 'root' },
            'sidebar.panellist': { kind: 'list', scope: 'root' },
        },
    } as never, () => null)
    ctx.provide('locale', locale() as never)
    const face = api()
    ctx.provide('remote', {
        async $mount() {
            // Stand in for the Gateway mount: provide the namespace service on
            // a child fiber so the returned disposer withdraws it like the real
            // `$mount` does.
            const holder = ctx.plugin({
                apply(scope: Context) { scope.provide('remote.flowCanvas', face) },
            } as never)
            await holder
            return async () => { await holder.dispose() }
        },
    } as never)
    return ctx
}

describe('flow-canvas panel wiring', () => {
    it('mounts into main and the sidebar list, and declares the node renderer child', async () => {
        const ctx = await bench()
        const fiber = ctx.plugin({ inject: [...inject], apply })
        await fiber.await()
        const main = ctx.slots.entries('main')
        expect(main.map(entry => entry.options.key)).toEqual([PANEL_ID])
        expect(ctx.slots.entries('sidebar.panellist').map(entry => entry.options.id)).toEqual([PANEL_ID])
        // The declared child is live but still unoccupied: the panel falls back.
        expect(ctx.slots.entriesOfSlot('flow.canvas.node')).toEqual([])
        await fiber.dispose()
        expect(ctx.slots.entries('main')).toEqual([])
        expect(ctx.slots.entries('sidebar.panellist')).toEqual([])
    })

    it('releases the namespace service and the store with the fiber', async () => {
        const ctx = await bench()
        const fiber = ctx.plugin({ inject: [...inject], apply })
        await fiber.await()
        expect(ctx.get('remote.flowCanvas')).toBeDefined()
        await fiber.dispose()
        expect(ctx.get('remote.flowCanvas')).toBeUndefined()
    })
})
