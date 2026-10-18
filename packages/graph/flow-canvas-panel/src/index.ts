/**
 * Host half of the flow-canvas panel.
 *
 * It injects the canvas data source and the flow engine through their Cordis
 * service tokens, registers the demo flows when absent, and exposes the public
 * canvas API to the browser over the `flowCanvas` Remote namespace:
 * `list`, `project`, `run`, and a `subscribe` stream of run frames. The browser
 * never sees kernel events; only these projections cross the wire.
 *
 * 画布面板的宿主半边。它通过 Cordis 服务令牌注入画布数据源与 flow 引擎，在演示 flow
 * 缺失时注册它们，并用 `flowCanvas` Remote 命名空间把画布公开 API 暴露给浏览器：
 * `list`、`project`、`run` 以及运行帧的 `subscribe` 流。浏览器永远看不到内核事件，
 * 只有这些投影跨过线缆。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { FlowApprovalBroker, FlowId } from '@deepseek-ai/dsh-graph-flow-api'
import type { FlowEngine } from '@deepseek-ai/dsh-graph-flow-engine'
import type {
    CanvasFlow,
    CanvasRunProjection,
    FlowCanvas,
} from '@deepseek-ai/dsh-graph-flow-canvas'
import { demoFlows } from './demo.ts'
import { runFrames } from './host/subscription.ts'
import { FLOW_APPROVAL_SERVICE, FLOW_CANVAS_SERVICE, FLOW_ENGINE_SERVICE } from './tokens.ts'
import type {
    FlowCanvasAck,
    FlowCanvasAnswerRequest,
    FlowCanvasFlowRequest,
    FlowCanvasFrame,
    FlowCanvasListValue,
    FlowCanvasRunRequest,
    FlowCanvasRunStart,
} from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
    interface RemoteErrorDetailsMap {
        /** The referenced run is unknown to this Host (already released or never started). */
        'flow-canvas/run-not-found': { readonly runId: string }
        /** The referenced flow is not registered on this Host. */
        'flow-canvas/flow-not-found': { readonly flowId: string }
        /** The approval request is unknown, already answered, or belongs to another run. */
        'flow-canvas/approval-not-found': { readonly requestId: string }
        /** No approval broker is mounted in this Host. */
        'flow-canvas/approval-unavailable': { readonly requestId: string }
    }
}

export { FLOW_CANVAS_SERVICE, FLOW_ENGINE_SERVICE } from './tokens.ts'

/** Awaited services: the canvas projection, the engine summary/list surface, and Typert. */
export const inject = [FLOW_CANVAS_SERVICE, FLOW_ENGINE_SERVICE, 'typert'] as const

/** Plugin name used by the Loader row. */
export const name = 'graph-flow-canvas-panel'

/**
 * Read an injected service by name, failing loudly when it is absent.
 * @param ctx - the plugin context whose fiber waited for the service.
 * @param service - Cordis service name.
 * @returns the live service.
 * @throws {Error} when the service is not registered.
 */
function required<T>(ctx: Context, service: string): T {
    const value = ctx.get(service) as T | undefined
    if (value === undefined || value === null) {
        throw new Error(`flow-canvas-panel requires the "${service}" service`)
    }
    return value
}

/**
 * Remote owner of the `flowCanvas` namespace. It keeps the live run
 * projections started through it so a second `subscribe` call can attach to a
 * run even when the panel reopened mid-run.
 */
export class FlowCanvasController extends TypertRemoteService {
    private readonly runs = new Map<string, CanvasRunProjection>()

    /**
     * @param ctx - the plugin context, whose effect disposes the projections.
     * @param canvas - the canvas data source.
     * @param engine - the flow engine (public summary/list surface only).
     * @param approval - the approval broker, when the Host mounts one.
     */
    constructor(
        ctx: Context,
        private readonly canvas: FlowCanvas,
        private readonly engine: Pick<FlowEngine, 'listFlows'>,
        private readonly approval?: FlowApprovalBroker,
    ) {
        super(ctx, 'flowCanvasController', { namespace: 'flowCanvas' })
        ctx.effect(() => () => {
            for (const projection of this.runs.values()) projection.dispose()
            this.runs.clear()
        }, 'flow-canvas-panel: run projections')
    }

    /**
     * List every registered flow.
     * @param request - empty named request (kept for the Remote envelope).
     * @returns summaries sorted by id by the engine.
     */
    @Remote list(request: Record<string, never>): FlowCanvasListValue {
        // The request is empty; reading it keeps the SRC fallback's parameter
        // name aligned with the generated-style client wire name.
        void request
        return { flows: this.engine.listFlows() }
    }

    /**
     * Project one registered flow into the serializable canvas shape.
     * @param request - the flow to project.
     * @returns the static projection.
     */
    @Remote project(request: FlowCanvasFlowRequest): CanvasFlow {
        try {
            return this.canvas.project(request.flowId as FlowId)
        } catch (cause) {
            throw new RemoteError('flow-canvas/flow-not-found', messageOf(cause), { flowId: request.flowId })
        }
    }

    /**
     * Start one run and keep its projection for later subscriptions.
     * @param request - the flow to run.
     * @returns the run identity and its hydration snapshot.
     */
    @Remote run(request: FlowCanvasFlowRequest): FlowCanvasRunStart {
        let projection: CanvasRunProjection
        try {
            projection = this.canvas.run(request.flowId as FlowId)
        } catch (cause) {
            throw new RemoteError('flow-canvas/flow-not-found', messageOf(cause), { flowId: request.flowId })
        }
        this.runs.set(projection.runId, projection)
        return { runId: projection.runId, flowId: projection.flowId, snapshot: projection.snapshot() }
    }

    /**
     * Answer one pending node approval. The broker enforces single use and the
     * request's run scope; an unknown or already-answered request is reported
     * instead of being silently accepted.
     * @param request - run, request id, decision and answering actor.
     * @returns an acknowledgement once the answer consumed the request.
     */
    @Remote answer(request: FlowCanvasAnswerRequest): FlowCanvasAck {
        if (this.approval === undefined) {
            throw new RemoteError('flow-canvas/approval-unavailable', 'no flow approval service is mounted', {
                requestId: request.requestId,
            })
        }
        const consumed = this.approval.answer(request.requestId, {
            runId: request.runId,
            decision: request.decision,
            ...request.actor === undefined ? {} : { actor: request.actor },
        })
        if (!consumed) {
            throw new RemoteError('flow-canvas/approval-not-found', `approval "${request.requestId}" is not pending for this run`, {
                requestId: request.requestId,
            })
        }
        return { ok: true }
    }

    /**
     * Cooperatively cancel a run; a waiting approval is withdrawn by its
     * cancellation signal, so the node cannot stay suspended after the cancel.
     * @param request - the run to cancel.
     * @returns an acknowledgement once the run handle accepted the cancel.
     */
    @Remote cancel(request: FlowCanvasRunRequest): FlowCanvasAck {
        const projection = this.runs.get(request.runId)
        if (projection === undefined) {
            throw new RemoteError('flow-canvas/run-not-found', `run "${request.runId}" is not known to this Host`, {
                runId: request.runId,
            })
        }
        projection.handle.cancel()
        return { ok: true }
    }

    /**
     * Stream a run: one hydration snapshot, each status change while live, and
     * one final snapshot once it settles. Cancelling or breaking the iteration
     * releases this subscriber (the run itself keeps going).
     * @param request - the run to subscribe to.
     * @param signal - carrier cancellation.
     * @returns the frame sequence of this subscription.
     */
    @Remote({ mode: 'stream' })
    subscribe(request: FlowCanvasRunRequest, signal: AbortSignal): AsyncIterable<FlowCanvasFrame> {
        const projection = this.runs.get(request.runId)
        if (projection === undefined) {
            throw new RemoteError('flow-canvas/run-not-found', `run "${request.runId}" is not known to this Host`, {
                runId: request.runId,
            })
        }
        // Each subscriber owns only its callback; the shared projection (and its
        // engine listeners) stays alive for other subscribers and for a page
        // that reloads and re-subscribes with the same runId.
        return runFrames(projection, signal)
    }
}

/**
 * Message of an unknown thrown value.
 * @param cause - the thrown value.
 * @returns a single-line message.
 */
function messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Register the demo flows that are absent and mount the Remote service.
 * @param ctx - plugin context.
 * @returns completion after the demo registrations settle.
 */
export async function apply(ctx: Context): Promise<void> {
    const canvas = required<FlowCanvas>(ctx, FLOW_CANVAS_SERVICE)
    const engine = required<FlowEngine>(ctx, FLOW_ENGINE_SERVICE)
    // 授权能力可选：未装载时运行仍会 fail-closed，画布只放弃 answer 端点。
    // The approval capability is optional: without it runs still fail closed
    // and only the answer endpoint is unavailable.
    const approval = ctx.get(FLOW_APPROVAL_SERVICE) as FlowApprovalBroker | undefined
    await registerDemoFlows(engine)
    new FlowCanvasController(ctx, canvas, engine, approval)
}

/**
 * Register each demo flow when its id is still absent.
 * @param engine - the flow engine.
 * @returns completion of the last registration.
 */
async function registerDemoFlows(engine: FlowEngine): Promise<void> {
    for (const flow of demoFlows()) {
        if (engine.hasFlow(flow.id)) continue
        await engine.registerFlow(flow)
    }
}
