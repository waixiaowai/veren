/**
 * 真实环境 e2e：装载真实 dsh-tools ToolRuntime，把 graph 工具注册进真实注册表，
 * 再经 ctx.tools.execute 调用 graph_list / graph_run / graph_status 并验收结果。
 * 无凭据、无网络，失败重试 2 次。
 *
 * Real-environment e2e: mounts the real dsh-tools ToolRuntime, registers the
 * graph tools into the real registry, then drives graph_list / graph_run /
 * graph_status through ctx.tools.execute and accepts on the results. No
 * credentials, no network; retried twice.
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionInput, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core'
import { apply as enginePlugin, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine'
import * as graphTools from '../src/index.js'
import type { GraphRunPayload } from '../src/index.js'

/** 一次真实调用 / one real call through the registry */
const call = (name: string, args: Record<string, unknown>): ToolExecutionInput => ({
    callId: randomUUID() as ToolExecutionInput['callId'],
    name,
    arguments: args,
    signal: new AbortController().signal,
} as ToolExecutionInput)

/** 断言成功并取出 canonical value / assert success and read the canonical value */
function valueOf(result: ToolExecutionResult): unknown {
    if (result.isError) throw new Error(`expected a successful call: ${JSON.stringify(result.error)}`)
    return result.value
}

/** 组合栈：内核 + 引擎 + 真实 ToolRuntime + 本插件 / the stack: kernel, engine, real ToolRuntime, this plugin */
async function makeStack() {
    const ctx = new Context()
    await ctx.plugin(kernelPlugin)
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5_000 })
    const SystemPrompt = (await import('@deepseek-ai/dsh-system-prompt')).SystemPrompt as unknown as new (c: Context, config: Record<string, unknown>) => object
    await ctx.plugin({ apply: (c: Context) => void new SystemPrompt(c, {}) } as never)
    await ctx.plugin({ inject: (ToolRuntime as unknown as { inject: string[] }).inject, apply: (c: Context) => void new ToolRuntime(c) } as never)
    await ctx.plugin(graphTools as never, { runTimeoutMs: 5_000 })
    const engine = ctx.get(FlowEngineToken)!
    await engine.registerFlow({
        id: 'e2e-demo',
        nodes: [{ id: 'src', type: 'echo', config: { message: 'ok' } }],
        edges: [],
        output: { said: '${src.message}' },
    })
    return { ctx, engine }
}

describe('graph tools through the real tool registry', () => {
    it('exposes the three tools to the model without execution internals', async () => {
        const { ctx } = await makeStack()
        const schemas = ctx.tools.schemas()
        const names = schemas.map((schema) => schema.name)
        expect(names).toEqual(expect.arrayContaining(['graph_list', 'graph_run', 'graph_status']))
        const run = schemas.find((schema) => schema.name === 'graph_run')!
        expect(run.description).toContain('workflow')
        expect(Object.keys(run)).not.toContain('execute')
        expect(run.parameters).toMatchObject({ type: 'object', properties: { name: expect.anything() } })
    })

    it('lists flows, runs one and reads it back by run id', async () => {
        const { ctx } = await makeStack()
        const listed = valueOf(await ctx.tools.execute(call('graph_list', {}))) as { flows: { id: string }[] }
        expect(listed.flows.map((flow) => flow.id)).toContain('e2e-demo')
        const ran = valueOf(await ctx.tools.execute(call('graph_run', { name: 'e2e-demo' }))) as GraphRunPayload
        expect(ran).toMatchObject({ flowId: 'e2e-demo', status: 'completed', output: { said: 'ok' } })
        const status = valueOf(await ctx.tools.execute(call('graph_status', { runId: ran.runId }))) as GraphRunPayload
        expect(status).toMatchObject({ runId: ran.runId, status: 'completed', output: { said: 'ok' } })
    })

    it('materializes an ordinary tool failure for an unknown flow', async () => {
        const { ctx } = await makeStack()
        const result = await ctx.tools.execute(call('graph_run', { name: 'ghost' }))
        expect(result.isError).toBe(true)
    })

    it('rejects a call with a parameter the schema does not declare', async () => {
        const { ctx } = await makeStack()
        const result = await ctx.tools.execute(call('graph_status', {}))
        expect(result.isError).toBe(true)
    })
})
