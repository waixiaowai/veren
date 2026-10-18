/**
 * Browser half of the echo renderer demo.
 *
 * One locale dictionary and one keyed `flow.canvas.node` registration. No host
 * behavior, no transport: it is the smallest possible proof that the panel's
 * node extension point is real and HMR-safe.
 *
 * echo 渲染器演示的浏览器半边。一个语言词典加一个 keyed `flow.canvas.node` 注册。没有
 * 宿主行为、没有传输：这是面板节点扩展点真实存在且 HMR 安全的最小证明。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-node-echo/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-graph-flow-canvas-panel/client'
import { EchoNode } from './EchoNode.tsx'
import { en, NS, zh } from './locales.ts'

/** Client services this contribution reads. */
export const inject = ['slots', 'locale']

/**
 * Register the echo renderer for `flow.canvas.node`.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'flow-canvas-node-echo: dictionaries')
    ctx.slots.inject('flow.canvas.node', () => ctx.slots.register({
        name: 'flow.canvas.node',
        key: 'echo',
        locale: NS,
    }, EchoNode))
}
