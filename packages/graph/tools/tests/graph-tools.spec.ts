/**
 * graph 工具的组合测试：真实 Loader 组合（内核 + 引擎 + 本插件）配替身工具
 * 注册表，覆盖 list / run / status 三条路径、未知 name/runId 的结构化失败、
 * runTimeoutMs 预算到期后的轮询，以及卸载逆序清理（HMR 安全）。
 *
 * Composition tests for the graph tools: a real-Loader stack (kernel + engine +
 * this plugin) over a stand-in tool registry, covering the list / run / status
 * paths, the structured failures for an unknown name or run id, polling after
 * the runTimeoutMs budget expires, and reverse-order cleanup (HMR safety).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { provideValue } from '@veren/core'
import { apply as kernelPlugin } from '@veren/graph-core'
import { registerNodeHandler } from '@veren/graph-flow-api'
import type { FlowDefinition, NodeHandler } from '@veren/graph-flow-api'
import { apply as enginePlugin, FlowEngineToken } from '@veren/graph-flow-engine'
import * as graphTools from '../src/index.js'
import type { GraphListPayload, GraphRunPayload } from '../src/index.js'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 最小执行上下文（工具只读 signal）/ the minimal execution context (the tools read only the signal) */
const execContext = (): ToolRunContext => ({ signal: new AbortController().signal }) as ToolRunContext

/** 替身工具注册表：记录注册并回传精确 disposer / stand-in registry: records registrations, returns the exact disposer */
function toolRegistry() {
    const tools = new Map<string, ToolDefinition>()
    const register = (definition: ToolDefinition): (() => void) => {
        tools.set(definition.name, definition)
        return () => void tools.delete(definition.name)
    }
    return { tools, register }
}

/** slow 节点：让 run 超过预算 / a slow node that outlives the budget */
const slowHandler: NodeHandler = {
    type: 'slow',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: async () => {
        await sleep(150)
        return { ok: true }
    },
}

const DEMO: FlowDefinition = {
    id: 'demo',
    nodes: [{ id: 'src', type: 'echo', config: { message: 'hi' } }],
    edges: [],
    output: { said: '${src.message}' },
}

const fibers: Fiber[] = []
afterEach(async () => {
    await Promise.allSettled(fibers.map((fiber) => fiber.dispose()))
    fibers.length = 0
})

/** 组合栈：替身注册表 + 内核 + 引擎 + 本插件 / the stack: stand-in registry, kernel, engine, this plugin */
async function makeStack(runTimeoutMs = 5_000) {
    const ctx = new Context()
    const registry = toolRegistry()
    provideValue(ctx, 'tools' as never, registry as never)
    // 能力先落地再注册节点/工具：await 每个 fiber，顺序才对 inject 可见
    // Settle each capability fiber before registering nodes/tools, so inject sees them.
    const kernelFiber: Fiber = ctx.plugin(kernelPlugin)
    fibers.push(kernelFiber)
    await kernelFiber
    const engineFiber: Fiber = ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5_000 })
    fibers.push(engineFiber)
    await engineFiber
    const toolsFiber: Fiber = ctx.plugin(graphTools as never, { runTimeoutMs })
    fibers.push(toolsFiber)
    await toolsFiber
    registerNodeHandler(ctx, slowHandler)
    const engine = ctx.get(FlowEngineToken)!
    await engine.registerFlow(DEMO)
    return { ctx, registry, engine, toolsFiber }
}

const tool = (registry: ReturnType<typeof toolRegistry>, name: string): ToolDefinition => {
    const definition = registry.tools.get(name)
    if (definition === undefined) throw new Error(`tool ${name} is not registered`)
    return definition
}

describe('graph tools composition (real Loader)', () => {
    it('registers exactly the three model-facing tools', async () => {
        const { registry } = await makeStack()
        expect([...registry.tools.keys()].sort()).toEqual(['graph_list', 'graph_run', 'graph_status'])
    })

    it('graph_list reports every registered flow with its shape', async () => {
        const { registry } = await makeStack()
        const value = (await tool(registry, 'graph_list').execute({}, execContext())) as GraphListPayload
        expect(value.flows).toEqual([{ id: 'demo', nodes: 1, edges: 0, outputs: ['said'] }])
    })

    it('graph_run executes a flow and returns output plus node states', async () => {
        const { registry } = await makeStack()
        const value = (await tool(registry, 'graph_run').execute({ name: 'demo' }, execContext())) as GraphRunPayload
        expect(value).toMatchObject({ flowId: 'demo', status: 'completed', output: { said: 'hi' } })
        // canonical 值必须无损 JSON：成功的节点不得带 error 属性
        // A canonical value must be lossless JSON: a successful node carries no `error` property.
        expect(value.nodes).toEqual([{ id: 'src', status: 'completed' }])
        expect(value.runId).not.toBe('')
    })

    it('graph_run fails loud on an unknown flow name and names the available flows', async () => {
        const { registry } = await makeStack()
        await expect(tool(registry, 'graph_run').execute({ name: 'ghost' }, execContext()))
            .rejects.toMatchObject({ code: 'GRAPH_FLOW_NOT_FOUND' })
        await expect(tool(registry, 'graph_run').execute({ name: 'ghost' }, execContext())).rejects.toThrow(/demo/u)
    })

    it('graph_run rejects a non-object input instead of guessing', async () => {
        const { registry } = await makeStack()
        await expect(tool(registry, 'graph_run').execute({ name: 'demo', input: [1, 2] }, execContext()))
            .rejects.toMatchObject({ code: 'GRAPH_INPUT_INVALID' })
    })

    it('graph_run hands back "running" on budget expiry and graph_status reports the finish', async () => {
        const { registry, engine } = await makeStack(20)
        await engine.registerFlow({ id: 'slow-flow', nodes: [{ id: 's', type: 'slow' }], edges: [] })
        const started = (await tool(registry, 'graph_run').execute({ name: 'slow-flow' }, execContext())) as GraphRunPayload
        expect(started.status).toBe('running')
        await sleep(250)
        const finished = (await tool(registry, 'graph_status').execute({ runId: started.runId }, execContext())) as GraphRunPayload
        expect(finished).toMatchObject({ status: 'completed', flowId: 'slow-flow' })
        expect(finished.nodes).toMatchObject([{ id: 's', status: 'completed' }])
    })

    it('graph_status fails loud on an unknown run id', async () => {
        const { registry } = await makeStack()
        await expect(tool(registry, 'graph_status').execute({ runId: 'ghost-run' }, execContext()))
            .rejects.toMatchObject({ code: 'GRAPH_RUN_NOT_FOUND' })
    })

    it('disposing the plugin fiber removes every tool registration (HMR safety)', async () => {
        const { registry, toolsFiber } = await makeStack()
        expect(registry.tools.size).toBe(3)
        await toolsFiber.dispose()
        expect(registry.tools.size).toBe(0)
    })
})
