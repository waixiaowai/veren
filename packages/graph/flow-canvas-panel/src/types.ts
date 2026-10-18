/**
 * Wire vocabulary shared by the Host Remote service and the browser half.
 *
 * The Host exposes the canvas data source's public projections; the browser
 * consumes exactly these values. Run output is not copied into the runtime
 * records — it stays on `CanvasRunSnapshot.result.nodes[id].output`.
 *
 * 宿主 Remote 服务与浏览器半边共享的线缆词汇。宿主只暴露画布数据源的公开投影；
 * 运行 output 不复制进运行时记录，仍只位于 `CanvasRunSnapshot.result.nodes[id].output`。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/types
 */

import type { CanvasFlow, CanvasNodeStatusChange, CanvasRunSnapshot } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowSummary } from '@deepseek-ai/dsh-graph-flow-engine'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Registered-flow summaries returned by `flowCanvas/list`. */
export interface FlowCanvasListValue {
    readonly flows: readonly FlowSummary[]
}

/** Request of every flow-id addressed endpoint. */
export interface FlowCanvasFlowRequest {
    readonly flowId: string
}

/** Request of `flowCanvas/subscribe`. */
export interface FlowCanvasRunRequest {
    readonly runId: string
}

/** Request of `flowCanvas/answer`: answer one pending node approval. */
export interface FlowCanvasAnswerRequest {
    readonly runId: string
    /** The single-use request id shown on the node card. */
    readonly requestId: string
    readonly decision: 'allow' | 'deny'
    /** Who answered, for the audit minimum; defaults to the canvas user. */
    readonly actor?: string
}

/** Answer of `flowCanvas/answer` and `flowCanvas/cancel`. */
export interface FlowCanvasAck {
    readonly ok: true
}

/** Immediate answer of `flowCanvas/run`: identity plus the synchronous hydration snapshot. */
export interface FlowCanvasRunStart {
    readonly runId: string
    readonly flowId: string
    readonly snapshot: CanvasRunSnapshot
}

/**
 * One frame of `flowCanvas/subscribe`: the hydration snapshot first, status
 * changes while the run is live, and one final snapshot once it settles.
 */
export type FlowCanvasFrame =
    | { readonly type: 'snapshot'; readonly snapshot: CanvasRunSnapshot }
    | { readonly type: 'change'; readonly change: CanvasNodeStatusChange }

/**
 * The mounted browser face of the `flowCanvas` Remote namespace.
 *
 * `subscribe` is an async iterable; breaking out of the loop disposes the
 * carrier stream. The Client never sees kernel events — only these projections.
 */
export interface FlowCanvasRemoteApi {
    /** Registered flows, sorted by id by the engine. */
    list(request: Record<string, never>): Promise<RemoteResult<FlowCanvasListValue>>
    /** Static projection of one registered flow. */
    project(request: FlowCanvasFlowRequest): Promise<RemoteResult<CanvasFlow>>
    /** Start one run and return its initial snapshot. */
    run(request: FlowCanvasFlowRequest): Promise<RemoteResult<FlowCanvasRunStart>>
    /**
     * Answer one pending approval shown on a node card. A request is
     * single-use and only valid for the run it was raised in.
     * @param request - run, request id, decision and answering actor.
     */
    answer(request: FlowCanvasAnswerRequest): Promise<RemoteResult<FlowCanvasAck>>
    /**
     * Cooperatively cancel a live run; a pending approval is withdrawn.
     * @param request - the run to cancel.
     */
    cancel(request: FlowCanvasRunRequest): Promise<RemoteResult<FlowCanvasAck>>
    /**
     * Subscribe to a run started by `run` (including an already-settled run).
     * @param request - the run identity.
     * @param signal - cancels the carrier stream.
     */
    subscribe(request: FlowCanvasRunRequest, signal?: AbortSignal): AsyncIterable<FlowCanvasFrame>
}
