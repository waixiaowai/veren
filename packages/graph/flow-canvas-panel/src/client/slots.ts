/**
 * Slot contract of the canvas panel.
 *
 * `flow.canvas.node` is the per-node-type renderer hole: the panel dispatches
 * by `node.type` and falls back to its own card for unclaimed keys. A separate
 * plugin can register `key: '<node type>'` without importing the panel's
 * components; the slot's owner props are plain data plus one callback.
 *
 * 画布面板的槽位契约。`flow.canvas.node` 是按节点类型的渲染器洞：面板按 `node.type`
 * 分发，未注册的 key 回落到自己的卡片。独立插件可以注册 `key: '<节点类型>'` 而不导入
 * 面板组件；槽位 owner props 是普通数据加一个回调。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/slots
 */

import type { CanvasNode, CanvasNodeRuntime } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowApprovalAudit, FlowApprovalDecision } from '@deepseek-ai/dsh-graph-flow-api'
import type {
    HostObservable,
    InjectFace,
    PropsLocale,
    PropsRenderSlots,
    PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowCanvasKey } from './locales.ts'
import type { FlowCanvasViewState } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Canvas panel copy. */
        flowCanvas: FlowCanvasKey
    }

    interface SlotMap {
        /**
         * One node card, dispatched by the node's declared `type`. The owner
         * passes the static node, its live runtime record (if any), selection,
         * and the selection callback. Unclaimed types render the panel's
         * default card.
         */
        'flow.canvas.node': {
            kind: 'keyed'
            scope: 'root'
            owner: FlowCanvasNodeOwnerProps
        }
    }
}

/** Owner currency of one node card. */
export interface FlowCanvasNodeOwnerProps {
    /** Static node projection: display label, subtitle, config and policy. */
    readonly node: CanvasNode
    /** Live record for this node, absent before the run creates it. */
    readonly runtime: CanvasNodeRuntime | undefined
    /** Whether this card is the inspected node. */
    readonly selected: boolean
    /** Inspect this node in the panel. */
    readonly onSelect: (nodeId: string) => void
    /**
     * The still-pending approval of this node, when it is blocked on a human.
     * A third-party renderer draws its own card from this and answers through
     * {@link FlowCanvasNodeOwnerProps.onApprovalDecision}; the panel's
     * full-width approval dock renders the shared `NodeApprovalCard` for the
     * same data. A node-sized card should use its own compact UI instead.
     */
    readonly pendingApproval: FlowApprovalAudit | undefined
    /** Every approval raised for this node (pending or settled), for audit display. */
    readonly approvals: readonly FlowApprovalAudit[]
    /** Answer a pending approval of this node (single use, run-scoped). */
    readonly onApprovalDecision: (requestId: string, decision: FlowApprovalDecision) => void
}

/** What the panel's inject factory supplies to its component. */
export interface FlowCanvasPanelInjected {
    /** One observable of the canvas view state, bound as `useFlow`. */
    readonly hooks: {
        readonly flow: HostObservable<FlowCanvasViewState>
    }
    /** Show one registered flow. */
    readonly onSelectFlow: (flowId: string) => void
    /** Start a run of the selected flow. */
    readonly onRun: () => void
    /** Inspect (or clear) one node. */
    readonly onSelectNode: (nodeId: string | undefined) => void
    /** Answer the pending approval of a node. */
    readonly onAnswerApproval: (requestId: string, decision: FlowApprovalDecision) => void
    /** Cooperatively cancel the current run. */
    readonly onCancelRun: () => void
    /** Re-read the flow list. */
    readonly onRefresh: () => void
}

/** Full props of the main-panel component. */
export type FlowCanvasPanelProps =
    PropsRuntime<'main'>
    & PropsRenderSlots<'flow.canvas.node'>
    & PropsLocale<'flowCanvas'>
    & InjectFace<FlowCanvasPanelInjected>
