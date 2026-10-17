/**
 * @deepseek-ai/dsh-graph-tools —— flow 引擎的模型可见工具面。
 *
 * @deepseek-ai/dsh-graph-tools — the model-facing tool surface of the flow engine.
 *
 * 三个工具只看 FlowEngine 能力（不碰存储、不碰内核）：
 *   - graph_list   返回已注册 flow 的清单
 *   - graph_run    按名启动一次运行并等待（受 runTimeoutMs 预算约束）
 *   - graph_status 按 runId 读运行状态与结果
 * The three tools consume the FlowEngine capability only (no storage, no
 * kernel): graph_list returns the registered flows, graph_run starts one run by
 * name and waits within the runTimeoutMs budget, and graph_status reads one run
 * by its run id.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { FlowId, RunId } from '@deepseek-ai/dsh-graph-flow-api'
import type { FlowEngine, FlowRunDetail, FlowRunHandle, FlowRunResult } from '@deepseek-ai/dsh-graph-flow-engine'
import type { GraphListPayload, GraphNodeItem, GraphRunPayload } from './types.js'

/** 错误块 schema（工具输出面）/ the error-block schema (tool output surface) */
const ERROR_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: { code: { type: 'string' }, message: { type: 'string' } },
} as const

/** flow 清单项 schema / the flow list item schema */
const FLOW_ITEM_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        id: { type: 'string' },
        nodes: { type: 'integer' },
        edges: { type: 'integer' },
        outputs: { type: 'array', items: { type: 'string' } },
    },
} as const

/** 节点状态项 schema / the node status item schema */
const NODE_ITEM_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: { id: { type: 'string' }, status: { type: 'string' }, error: ERROR_SCHEMA },
} as const

/** graph_list 输出 schema / the graph_list output schema */
const LIST_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: { flows: { type: 'array', items: FLOW_ITEM_SCHEMA } },
} as const

/** graph_run / graph_status 输出 schema / the graph_run and graph_status output schema */
const RUN_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        flowId: { type: 'string' },
        runId: { type: 'string' },
        status: { type: 'string' },
        output: { type: 'object', additionalProperties: true },
        nodes: { type: 'array', items: NODE_ITEM_SCHEMA },
        error: ERROR_SCHEMA,
    },
} as const

/** 文本投影：模型看到的就是这份 JSON / the text projection: this JSON is what the model reads */
const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]

/** 工具边界：引擎的运行产出按契约就是 JSON 值 / the tool boundary: the engine's run output is JSON by contract */
function jsonRecord(output: Record<string, unknown>): Record<string, JsonValue> {
    return output as Record<string, JsonValue>
}

/** 结构化工具错误：稳定 code + 机器可读字段 / a structured tool error: stable code + machine-readable fields */
function graphToolError(code: string, message: string, details?: Record<string, unknown>): Error & { code: string } {
    const error = new Error(details === undefined ? message : `${message}; ${JSON.stringify(details)}`) as Error & { code: string }
    error.code = code
    return error
}

/** 运行入参归一化：只接受 JSON 对象 / normalize run input: a JSON object only */
function toRunInput(input: JsonValue | undefined): Record<string, unknown> | undefined {
    if (input === undefined || input === null) return undefined
    if (typeof input !== 'object' || Array.isArray(input)) throw graphToolError('GRAPH_INPUT_INVALID', 'input must be a JSON object')
    return input as Record<string, unknown>
}

/** 运行结果 → 工具载荷：省略缺失字段（canonical 值必须是无损 JSON，undefined 属性非法）
    The run result as a tool payload: omit absent fields — a canonical value must be lossless JSON, so no `undefined` property. */
function toRunPayload(result: FlowRunResult): GraphRunPayload {
    const nodes: GraphNodeItem[] = Object.entries(result.nodes).map(([id, record]) =>
        record.error === undefined ? { id, status: record.status } : { id, status: record.status, error: record.error })
    const payload: GraphRunPayload = { flowId: String(result.flowId), runId: String(result.runId), status: result.status, output: jsonRecord(result.output), nodes }
    return result.error === undefined ? payload : { ...payload, error: result.error }
}

/** 运行详情 → 工具载荷（运行中只有状态）/ the run detail as a tool payload (status only while running) */
function toDetailPayload(detail: FlowRunDetail): GraphRunPayload {
    if (detail.result !== undefined) return toRunPayload(detail.result)
    return { flowId: String(detail.flowId), runId: String(detail.runId), status: detail.status, output: {}, nodes: [] }
}

/** 预算：到点让出，运行继续在后台跑 / the budget: give up waiting, the run keeps going in the background */
function expire(budgetMs: number): Promise<undefined> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), budgetMs)
        timer.unref()
    })
}

/** 调用被取消：协作式取消该运行并抛出 / the call was aborted: cooperatively cancel the run and throw */
function aborted(signal: AbortSignal, handle: FlowRunHandle): Promise<never> {
    return new Promise((_resolve, reject) => {
        const refuse = (): void => {
            handle.cancel()
            reject(graphToolError('GRAPH_RUN_ABORTED', 'the tool call was aborted; the run was asked to cancel'))
        }
        if (signal.aborted) refuse()
        else signal.addEventListener('abort', refuse, { once: true })
    })
}

/** 等待运行结束（受预算与 signal 约束）/ wait for the run, bounded by the budget and the signal */
async function settle(handle: FlowRunHandle, budgetMs: number, signal: AbortSignal): Promise<GraphRunPayload> {
    const finished = await Promise.race<FlowRunResult | undefined>([handle.awaitCompletion(), expire(budgetMs), aborted(signal, handle)])
    if (finished === undefined) return { flowId: String(handle.flowId), runId: String(handle.runId), status: 'running', output: {}, nodes: [] }
    return toRunPayload(finished)
}

/** graph_list：已注册 flow 清单 / graph_list: the registered flows */
function listTool(engine: FlowEngine): ToolDefinition {
    return defineTool({
        name: 'graph_list',
        description: 'List the workflows registered in the flow engine (id, node/edge counts, declared output names). Call it before graph_run to learn which flow names exist.',
        parameters: {},
        output: { schema: LIST_SCHEMA, render: (_args, value) => text(value) },
        async execute(): Promise<GraphListPayload> {
            const flows = engine.listFlows().map((flow) => ({ id: String(flow.id), nodes: flow.nodes, edges: flow.edges, outputs: flow.outputs }))
            return { flows }
        },
    })
}

/** graph_run：按名启动并等待 / graph_run: start by name and wait */
function runTool(engine: FlowEngine, runTimeoutMs: number): ToolDefinition {
    return defineTool({
        name: 'graph_run',
        description: `Start a registered workflow by name and wait up to ${String(runTimeoutMs)} ms for it to finish. Returns the run id, status, resolved output variables and per-node statuses; when the budget expires the run keeps going with status "running" — poll it with graph_status.`,
        parameters: {
            name: { type: 'string', required: true, description: 'Flow id, as returned by graph_list' },
            input: { type: 'json', description: 'Optional run input object, validated by the flow Start signature' },
        },
        output: { schema: RUN_SCHEMA, render: (_args, value) => text(value) },
        async execute(args, exec): Promise<GraphRunPayload> {
            const flowId = args.name as FlowId
            if (!engine.hasFlow(flowId)) {
                throw graphToolError('GRAPH_FLOW_NOT_FOUND', `flow "${args.name}" is not registered`, { available: engine.listFlows().map((flow) => String(flow.id)) })
            }
            return await settle(engine.run(flowId, { input: toRunInput(args.input) }), runTimeoutMs, exec.signal)
        },
    })
}

/** graph_status：按 runId 读状态 / graph_status: read one run by id */
function statusTool(engine: FlowEngine): ToolDefinition {
    return defineTool({
        name: 'graph_status',
        description: 'Read one workflow run by its run id: status, resolved output variables and per-node statuses once finished. Pass the run id returned by graph_run.',
        parameters: { runId: { type: 'string', required: true, description: 'Run id returned by graph_run' } },
        output: { schema: RUN_SCHEMA, render: (_args, value) => text(value) },
        async execute(args): Promise<GraphRunPayload> {
            const detail = engine.getRun(args.runId as RunId)
            if (detail === undefined) {
                const recent = engine.listRuns().slice(-5).map((run) => String(run.runId))
                throw graphToolError('GRAPH_RUN_NOT_FOUND', `run "${args.runId}" is unknown`, { recent })
            }
            return toDetailPayload(detail)
        },
    })
}

/**
 * 构建三个工具定义（注册由插件入口负责）/ build the three tool definitions
 * (registration belongs to the plugin entry).
 * @param engine - flow 引擎能力 / the flow engine capability.
 * @param runTimeoutMs - graph_run 的等待预算（毫秒）/ the graph_run wait budget in ms.
 * @returns graph_list / graph_run / graph_status 的定义 / the three definitions.
 */
export function createGraphTools(engine: FlowEngine, runTimeoutMs: number): ToolDefinition[] {
    return [listTool(engine), runTool(engine, runTimeoutMs), statusTool(engine)]
}
