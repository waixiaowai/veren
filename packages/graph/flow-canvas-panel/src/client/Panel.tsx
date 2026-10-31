/**
 * Main-panel page of the canvas plugin.
 *
 * It is pure presentation over the inject face: one observable snapshot
 * (`useFlow`), the panel callbacks, child-slot `renderSlot`, and the locale `t`.
 * The page composes the header, the run status strip, the approval dock, the
 * pan/zoom graph, and an inspector that opens with the selected node. Page
 * chrome lives in `PanelChrome`, the viewport graph in `FlowGraph`.
 *
 * 画布插件的主面板页面。它只做注入面的展示：一个可观察快照（`useFlow`）、面板回调、
 * 子槽位 `renderSlot` 与语言 `t`。页面组合顶栏、运行状态条、授权坞、可平移缩放图，
 * 以及随选中节点打开的详情面板。页面框架在 `PanelChrome`，视口图在 `FlowGraph`。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/Panel
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CanvasFlow, CanvasNode, CanvasNodeRuntime } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowApprovalAudit, FlowApprovalDecision } from '@deepseek-ai/dsh-graph-flow-api'
import { ApprovalDock, type DecisionNotice } from './ApprovalDock.tsx'
import { DefaultNodeCard } from './DefaultNodeCard.tsx'
import { FlowGraph } from './FlowGraph.tsx'
import { Inspector } from './Inspector.tsx'
import { pendingApproval, runDigest } from './model.ts'
import { attentionNodes, pendingApprovals } from './present.ts'
import { PanelHeader, PanelLegend } from './PanelChrome.tsx'
import { StatusStrip } from './StatusStrip.tsx'
import type { FlowCanvasPanelProps, FlowCanvasNodeOwnerProps } from './slots.ts'
import type { RunView } from './store.ts'
import css from './panel.module.css'

/** One pending approval plus the node that owns it (a present.ts view). */
type PendingView = ReturnType<typeof pendingApprovals>[number]

/**
 * The approval card is the canvas focus: open the owning node once per
 * request so the inspector and the dock tell the same story. A new run owns a
 * new decision history; never show the previous run's result over it.
 * 授权卡是画布焦点：每个请求只自动打开一次所属节点，让检查器与授权坞讲同一个故事。
 * 新 run 拥有新的决定历史；上一 run 的结果不得盖在新 run 上。
 */
function useDecisionNotice(
    runId: string | undefined,
    flowId: string | undefined,
    active: PendingView | undefined,
    onSelectNode: FlowCanvasPanelProps['onSelectNode'],
): [DecisionNotice | undefined, (notice: DecisionNotice | undefined) => void] {
    const [notice, setNotice] = useState<DecisionNotice>()
    const autoFocused = useRef<string>()
    useEffect(() => {
        setNotice(undefined)
        autoFocused.current = undefined
    }, [runId, flowId])
    useEffect(() => {
        if (active === undefined) return
        const requestId = active.audit.request.id
        if (autoFocused.current === requestId) return
        autoFocused.current = requestId
        onSelectNode(active.nodeId)
    }, [active, onSelectNode])
    return [notice, setNotice]
}

/**
 * The decision notice only explains the request it answered; a different
 * active request hides it.
 * 决定通知只解释它回答的那条请求；活动请求变了就隐藏。
 */
function activeNotice(notice: DecisionNotice | undefined, active: PendingView | undefined): DecisionNotice | undefined {
    return notice !== undefined
        && (active === undefined || active.audit.request.id === notice.request.id)
        ? notice
        : undefined
}

/** The settled audit entry and node status matching the notice, once the stream has them. */
function settledFacts(
    run: RunView | undefined,
    notice: DecisionNotice | undefined,
): { settledAudit: FlowApprovalAudit | undefined; settledStatus: CanvasNodeRuntime['status'] | undefined } {
    if (notice === undefined || run === undefined) return { settledAudit: undefined, settledStatus: undefined }
    const node = run.nodes[notice.nodeId]
    return {
        settledAudit: node?.approvals?.find(audit => audit.request.id === notice.request.id),
        settledStatus: node?.status,
    }
}

/** Build the decision callback: record the local notice, then forward to the host. */
function makeDecider(
    pending: readonly PendingView[],
    setNotice: (notice: DecisionNotice | undefined) => void,
    onAnswerApproval: FlowCanvasPanelProps['onAnswerApproval'],
): (requestId: string, decision: FlowApprovalDecision) => void {
    return (requestId, decision) => {
        const view = pending.find(entry => entry.audit.request.id === requestId)
        if (view !== undefined) {
            setNotice({ nodeId: view.nodeId, request: view.audit.request, decision, at: Date.now() })
        }
        onAnswerApproval(requestId, decision)
    }
}

/** Build the node-slot renderer: owner props are derived shares, dispatched through the slot. */
function nodeRenderer(
    renderSlot: FlowCanvasPanelProps['renderSlot'],
    onSelectNode: FlowCanvasPanelProps['onSelectNode'],
    onAnswerApproval: FlowCanvasPanelProps['onAnswerApproval'],
    t: FlowCanvasPanelProps['t'],
): (node: CanvasNode, runtime: CanvasNodeRuntime | undefined, selected: boolean) => ReactNode {
    return (node, runtime, selected) => {
        // owner props 是派生共享：授权面随节点记录一起下传，
        // 第三方渲染器可以完全自定义卡片而不导入默认卡片。
        // Owner props are derived shares: the approval face
        // travels with the node record, so a third-party
        // renderer can replace the card entirely.
        const owner: FlowCanvasNodeOwnerProps = {
            node,
            runtime,
            selected,
            onSelect: onSelectNode,
            pendingApproval: pendingApproval(runtime),
            approvals: runtime?.approvals ?? [],
            onApprovalDecision: onAnswerApproval,
        }
        return renderSlot(
            'flow.canvas.node',
            owner,
            {
                entryKey: node.type,
                fallback: <DefaultNodeCard {...owner} t={t} />,
            },
        )
    }
}

/** Props of the page body: graph area plus inspector. */
interface PanelBodyProps {
    readonly flow: CanvasFlow | undefined
    readonly flowCount: number
    readonly run: RunView | undefined
    readonly selectedNodeId: string | undefined
    readonly selectedNode: CanvasNode | undefined
    readonly renderNode: (node: CanvasNode, runtime: CanvasNodeRuntime | undefined, selected: boolean) => ReactNode
    readonly onSelectNode: FlowCanvasPanelProps['onSelectNode']
    readonly t: FlowCanvasPanelProps['t']
}

/** The graph area (or its empty hint) and the inspector for the selected node. */
function PanelBody({
    flow, flowCount, run, selectedNodeId, selectedNode, renderNode, onSelectNode, t,
}: PanelBodyProps) {
    return (
        <div className={css.body}>
            <div className={css.graphArea}>
                {flow === undefined
                    ? <p className={css.muted}>{flowCount === 0 ? t('panel.emptyFlows') : t('panel.emptyGraph')}</p>
                    : (
                        <FlowGraph
                            flow={flow}
                            run={run}
                            selectedNodeId={selectedNodeId}
                            onClearSelection={() => { onSelectNode(undefined) }}
                            t={t}
                            renderNode={renderNode}
                        />
                    )}
            </div>
            {selectedNode === undefined
                ? null
                : (
                    <Inspector
                        node={selectedNode}
                        runtime={run?.nodes[selectedNode.id]}
                        run={run}
                        onClose={() => { onSelectNode(undefined) }}
                        t={t}
                    />
                )}
        </div>
    )
}

/** 授权坞需要的全部派生事实 / every derived fact the approval dock needs */
interface ApprovalDockState {
    /** The decision notice that still matches the active request. */
    readonly notice: DecisionNotice | undefined
    readonly settledAudit: FlowApprovalAudit | undefined
    readonly settledStatus: CanvasNodeRuntime['status'] | undefined
    readonly setNotice: (notice: DecisionNotice | undefined) => void
}

/** Decision-notice state (see {@link useDecisionNotice}) plus its settled facts (see {@link settledFacts}). */
function useApprovalDockState(
    run: RunView | undefined,
    runId: string | undefined,
    flowId: string | undefined,
    active: PendingView | undefined,
    onSelectNode: FlowCanvasPanelProps['onSelectNode'],
): ApprovalDockState {
    const [notice, setNotice] = useDecisionNotice(runId, flowId, active, onSelectNode)
    const noticeForActive = activeNotice(notice, active)
    return { notice: noticeForActive, ...settledFacts(run, noticeForActive), setNotice }
}

/**
 * Render the canvas page.
 * @param props - framework shares (runtime, child slots, locale) and the inject face.
 * @returns the page.
 */
export function FlowCanvasPanel({
    useFlow, renderSlot, t, onSelectFlow, onRun, onSelectNode, onAnswerApproval,
    onCancelRun, onRefresh,
}: FlowCanvasPanelProps) {
    const state = useFlow(snapshot => snapshot)
    const attention = useMemo(() => attentionNodes(state.flow, state.run), [state.flow, state.run])
    const pending = useMemo(() => pendingApprovals(state.flow, state.run), [state.flow, state.run])
    const { notice, settledAudit, settledStatus, setNotice } =
        useApprovalDockState(state.run, state.run?.runId, state.flowId, pending[0], onSelectNode)
    return (
        <section className={css.page} aria-label={t('panel.title')}>
            <PanelHeader
                flows={state.flows} flowId={state.flowId} running={state.run?.status === 'running'} canRun={state.flowId !== undefined}
                hasRun={state.run !== undefined} onSelectFlow={onSelectFlow} onRun={onRun} onCancelRun={onCancelRun} onRefresh={onRefresh} t={t}
            />
            <StatusStrip
                phase={state.phase} error={state.error} flowCount={state.flows.length} flow={state.flow} run={state.run}
                digest={state.run === undefined ? undefined : runDigest(state.run)}
                attention={attention} onSelectNode={onSelectNode} t={t}
            />
            <ApprovalDock
                pending={pending} notice={notice} settledAudit={settledAudit} settledStatus={settledStatus}
                onDecision={makeDecider(pending, setNotice, onAnswerApproval)} onDismiss={() => { setNotice(undefined) }} t={t}
            />
            <PanelBody
                flow={state.flow} flowCount={state.flows.length} run={state.run} selectedNodeId={state.selectedNodeId}
                selectedNode={state.flow?.nodes.find(node => node.id === state.selectedNodeId)}
                renderNode={nodeRenderer(renderSlot, onSelectNode, onAnswerApproval, t)} onSelectNode={onSelectNode} t={t}
            />
            <PanelLegend t={t} />
        </section>
    )
}
