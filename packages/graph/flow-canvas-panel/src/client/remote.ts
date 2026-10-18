/**
 * Browser-side definition of the `flowCanvas` Remote namespace.
 *
 * The contribution is built by hand because this plugin lives outside the DSH
 * workspace that generates `./remote` artifacts. It mirrors the Host service's
 * six endpoints with strict codecs; the Host resolves the same methods through
 * its runtime decorator markers. Only public canvas projections and single-use
 * approval answers cross the wire — never a kernel event.
 *
 * `flowCanvas` Remote 命名空间的浏览器侧定义。本插件位于生成 `./remote` 工件的 DSH
 * 工作区之外，因此手工构造该 contribution，用严格 codec 对应宿主服务的六个端点；宿主通过
 * 运行时装饰器标记解析同名方法。跨线缆的只有画布公开投影与一次性授权回答，绝不是内核事件。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/remote
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type {
    TypertRemoteCodecSpec,
    TypertRemoteMethodSpec,
    TypertRemoteParameterSpec,
    TypertRemoteSpec,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
    CanvasFlow,
    CanvasNodeRuntime,
    CanvasNodeStatusChange,
    CanvasRunSnapshot,
} from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowCanvasFrame, FlowCanvasRemoteApi } from '../types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteNamespaceMap {
        /** Canvas projections and live run frames, mounted by this plugin's `apply`. */
        flowCanvas: FlowCanvasRemoteApi
    }
}

/** Host service key bound by `TypertRemoteService`; the wire namespace is `flowCanvas`. */
const SERVICE = 'flowCanvasController'

/** Object predicate shared by the loose wire validators. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accept the essential static-projection fields; the Host produced the rest. */
function isCanvasFlow(value: unknown): value is CanvasFlow {
    return isRecord(value)
        && value['schemaVersion'] === 1
        && typeof value['flowId'] === 'string'
        && Array.isArray(value['nodes'])
        && Array.isArray(value['edges'])
}

/** Accept the essential snapshot fields; node records stay structural. */
function isSnapshot(value: unknown): value is CanvasRunSnapshot {
    return isRecord(value)
        && value['schemaVersion'] === 1
        && typeof value['flowId'] === 'string'
        && typeof value['runId'] === 'string'
        && typeof value['status'] === 'string'
        && isRecord(value['nodes'])
        && (value['result'] === null || isRecord(value['result']))
}

/** Accept one status transition; the canvas runtime fields are optional. */
function isChange(value: unknown): value is CanvasNodeStatusChange {
    return isRecord(value)
        && typeof value['flowId'] === 'string'
        && typeof value['runId'] === 'string'
        && typeof value['nodeId'] === 'string'
        && typeof value['status'] === 'string'
}

/** One strict codec over a Zod schema factory. */
function codec(typeSymbol: string, create: () => z.ZodType): TypertRemoteCodecSpec {
    return { mode: 'strict', typeSymbol, create }
}

/** One required JSON parameter keyed by its Host parameter name. */
function parameter(name: string, typeSymbol: string, create: () => z.ZodType): TypertRemoteParameterSpec {
    const spec = codec(typeSymbol, create)
    return { name, wire: name, source: 'json', codec: spec, strictCodec: spec }
}

/** The empty named request of `list`. */
const EMPTY_REQUEST = z.strictObject({})

/** Request shared by `project` and `run`. */
const FLOW_REQUEST = z.strictObject({ flowId: z.string() })

/** Request of `subscribe`. */
const RUN_REQUEST = z.strictObject({ runId: z.string() })

/** Request of `answer`. */
const ANSWER_REQUEST = z.strictObject({
    runId: z.string(),
    requestId: z.string(),
    decision: z.union([z.literal('allow'), z.literal('deny')]),
    actor: z.string().optional(),
})

/** Answer of `answer` and `cancel`. */
const ACK_RESULT = z.strictObject({ ok: z.literal(true) })

/** Result of `list`: engine summaries stay structurally open. */
const LIST_RESULT = z.looseObject({
    flows: z.array(z.looseObject({
        id: z.string(),
        nodes: z.number(),
        edges: z.number(),
        outputs: z.array(z.string()),
    })),
})

/** Result of `run`: identity plus the synchronous hydration snapshot. */
const RUN_RESULT = z.looseObject({
    runId: z.string(),
    flowId: z.string(),
    snapshot: z.custom<CanvasRunSnapshot>(isSnapshot),
})

/** One stream item: hydration/final snapshot or a status change. */
const FRAME = z.discriminatedUnion('type', [
    z.object({ type: z.literal('snapshot'), snapshot: z.custom<CanvasRunSnapshot>(isSnapshot) }),
    z.object({ type: z.literal('change'), change: z.custom<CanvasNodeStatusChange>(isChange) }),
])

/** Build one direct method spec; stream methods declare carrier cancellation. */
function method(
    exportName: string,
    description: string,
    parameters: readonly TypertRemoteParameterSpec[],
    result: TypertRemoteCodecSpec,
    stream = false,
): Record<string, TypertRemoteMethodSpec> {
    return {
        [`flowCanvas/${exportName}`]: {
            service: SERVICE,
            description,
            invocation: { kind: 'direct' },
            parameters: [...parameters],
            result,
            ...stream ? { mode: 'stream', cancellation: { parameter: 'signal' } } : {},
        },
    }
}

/** The mountable contribution, mounted by `apply` through `ctx.remote.$mount`. */
export const flowCanvasRemote = createTypertRemoteInfo({
    package: '@deepseek-ai/dsh-graph-flow-canvas-panel',
    methods: {
        ...method('list', 'List every registered flow.', [
            parameter('request', 'flow-canvas:list:request', () => EMPTY_REQUEST),
        ], codec('flow-canvas:list:result', () => LIST_RESULT)),
        ...method('project', 'Project one registered flow into the canvas shape.', [
            parameter('request', 'flow-canvas:project:request', () => FLOW_REQUEST),
        ], codec('flow-canvas:project:result', () => z.custom<CanvasFlow>(isCanvasFlow))),
        ...method('run', 'Start one run and return its initial snapshot.', [
            parameter('request', 'flow-canvas:run:request', () => FLOW_REQUEST),
        ], codec('flow-canvas:run:result', () => RUN_RESULT)),
        ...method('answer', 'Answer one pending node approval (single use, run-scoped).', [
            parameter('request', 'flow-canvas:answer:request', () => ANSWER_REQUEST),
        ], codec('flow-canvas:answer:result', () => ACK_RESULT)),
        ...method('cancel', 'Cancel a live run; a pending approval is withdrawn.', [
            parameter('request', 'flow-canvas:cancel:request', () => RUN_REQUEST),
        ], codec('flow-canvas:cancel:result', () => ACK_RESULT)),
        ...method('subscribe', 'Stream one run: snapshot, changes, final snapshot.', [
            parameter('request', 'flow-canvas:subscribe:request', () => RUN_REQUEST),
        ], codec('flow-canvas:subscribe:result', () => FRAME), true),
    } as TypertRemoteSpec['methods'],
}, z)

/** Unused structural reference: keeps the canvas node type on the public client face. */
export type { CanvasNodeRuntime, FlowCanvasFrame }
