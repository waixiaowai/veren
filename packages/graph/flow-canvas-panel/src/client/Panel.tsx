/**
 * Main-panel page of the canvas plugin.
 *
 * It is pure presentation over the inject face: one observable snapshot
 * (`useFlow`), the panel callbacks, child-slot `renderSlot`, and the locale `t`.
 * The page composes the header, the run status strip, the approval dock, the
 * pan/zoom graph, and an inspector that opens with the selected node.
 *
 * 画布插件的主面板页面。它只做注入面的展示：一个可观察快照（`useFlow`）、面板回调、
 * 子槽位 `renderSlot` 与语言 `t`。页面组合顶栏、运行状态条、授权坞、可平移缩放图，
 * 以及随选中节点打开的详情面板。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/Panel
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlowApprovalDecision } from '@deepseek-ai/dsh-graph-flow-api'
import { ApprovalDock, type DecisionNotice } from './ApprovalDock.tsx'
import { DefaultNodeCard } from './DefaultNodeCard.tsx'
import { FlowGraph } from './FlowGraph.tsx'
import { Inspector } from './Inspector.tsx'
import { pendingApproval, runDigest } from './model.ts'
import { attentionNodes, flowLabel, pendingApprovals } from './present.ts'
import { StatusStrip } from './StatusStrip.tsx'
import type { FlowCanvasPanelProps } from './slots.ts'
import css from './panel.module.css'

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
    const flow = state.flow
    const selectedNode = flow?.nodes.find(node => node.id === state.selectedNodeId)
    const running = state.run?.status === 'running'
    const digest = state.run === undefined ? undefined : runDigest(state.run)
    const attention = useMemo(() => attentionNodes(flow, state.run), [flow, state.run])
    const pending = useMemo(() => pendingApprovals(flow, state.run), [flow, state.run])
    const active = pending[0]
    const [notice, setNotice] = useState<DecisionNotice>()
    const autoFocused = useRef<string>()
    const runId = state.run?.runId

    // A new run owns a new decision history; never show the previous run's
    // "allowed / denied" result over it.
    useEffect(() => {
        setNotice(undefined)
        autoFocused.current = undefined
    }, [runId, state.flowId])

    // The approval card is the canvas focus: open the owning node once per
    // request so the inspector and the dock tell the same story.
    useEffect(() => {
        if (active === undefined) return
        const requestId = active.audit.request.id
        if (autoFocused.current === requestId) return
        autoFocused.current = requestId
        onSelectNode(active.nodeId)
    }, [active, onSelectNode])

    const noticeForActive = notice !== undefined
        && (active === undefined || active.audit.request.id === notice.request.id)
        ? notice
        : undefined
    const settledAudit = noticeForActive === undefined || state.run === undefined
        ? undefined
        : state.run.nodes[noticeForActive.nodeId]?.approvals?.find(audit => audit.request.id === noticeForActive.request.id)
    const settledStatus = noticeForActive === undefined || state.run === undefined
        ? undefined
        : state.run.nodes[noticeForActive.nodeId]?.status

    const decide = (requestId: string, decision: FlowApprovalDecision): void => {
        const view = pending.find(entry => entry.audit.request.id === requestId)
        if (view !== undefined) {
            setNotice({ nodeId: view.nodeId, request: view.audit.request, decision, at: Date.now() })
        }
        onAnswerApproval(requestId, decision)
    }

    return (
        <section className={css.page} aria-label={t('panel.title')}>
            <header className={css.header}>
                <div className={css.titleRow}>
                    <h1 className={css.title}>{t('panel.title')}</h1>
                    <span className={css.subtitle}>{t('panel.subtitle')}</span>
                </div>
                <div className={css.toolbar}>
                    <label className={css.fieldLabel} htmlFor="flow-canvas-select">{t('panel.flow')}</label>
                    <select
                        id="flow-canvas-select"
                        className={css.select}
                        value={state.flowId ?? ''}
                        disabled={state.flows.length === 0}
                        onChange={(event) => { onSelectFlow(event.target.value) }}
                    >
                        {state.flows.length === 0
                            ? <option value="">{t('panel.emptyFlows')}</option>
                            : state.flows.map(entry => (
                                <option key={entry.id} value={entry.id} title={entry.id}>
                                    {flowLabel(entry.id, t)}
                                </option>
                            ))}
                    </select>
                    {running
                        ? (
                            <button type="button" className={`${css.button} ${css.danger}`} onClick={onCancelRun}>
                                <span aria-hidden="true">■</span>
                                {t('panel.cancel')}
                            </button>
                        )
                        : (
                            <button
                                type="button"
                                className={`${css.button} ${css.primary}`}
                                disabled={state.flowId === undefined}
                                onClick={onRun}
                            >
                                <span aria-hidden="true">▶</span>
                                {state.run === undefined ? t('panel.run') : t('panel.rerun')}
                            </button>
                        )}
                    <button
                        type="button"
                        className={`${css.button} ${css.ghost}`}
                        title={t('panel.refreshHint')}
                        onClick={onRefresh}
                    >
                        <span aria-hidden="true">↻</span>
                        {t('panel.refresh')}
                    </button>
                </div>
            </header>
            <StatusStrip
                phase={state.phase}
                error={state.error}
                flowCount={state.flows.length}
                flow={flow}
                run={state.run}
                digest={digest}
                attention={attention}
                onSelectNode={onSelectNode}
                t={t}
            />
            <ApprovalDock
                pending={pending}
                notice={noticeForActive}
                settledAudit={settledAudit}
                settledStatus={settledStatus}
                onDecision={decide}
                onDismiss={() => { setNotice(undefined) }}
                t={t}
            />
            <div className={css.body}>
                <div className={css.graphArea}>
                    {flow === undefined
                        ? <p className={css.muted}>{state.flows.length === 0 ? t('panel.emptyFlows') : t('panel.emptyGraph')}</p>
                        : (
                            <FlowGraph
                                flow={flow}
                                run={state.run}
                                selectedNodeId={state.selectedNodeId}
                                onClearSelection={() => { onSelectNode(undefined) }}
                                t={t}
                                renderNode={(node, runtime, selected) => {
                                    // owner props 是派生共享：授权面随节点记录一起下传，
                                    // 第三方渲染器可以完全自定义卡片而不导入默认卡片。
                                    // Owner props are derived shares: the approval face
                                    // travels with the node record, so a third-party
                                    // renderer can replace the card entirely.
                                    const owner = {
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
                                }}
                            />
                        )}
                </div>
                {selectedNode === undefined
                    ? null
                    : (
                        <Inspector
                            node={selectedNode}
                            runtime={state.run?.nodes[selectedNode.id]}
                            run={state.run}
                            onClose={() => { onSelectNode(undefined) }}
                            t={t}
                        />
                    )}
            </div>
            <footer className={css.legend}>
                <span className={css.legendHint}>{t('legend.hint')}</span>
                <span className={css.legendDivider} aria-hidden="true" />
                <strong>{t('legend.title')}</strong>
                <span className={css.legendItem}><i className={`${css.legendLine} ${css.legendAlways}`} />{t('legend.edgeAlways')}</span>
                <span className={css.legendItem}><i className={`${css.legendLine} ${css.legendConditional}`} />{t('legend.edgeConditional')}</span>
                <span className={css.legendItem}><i className={`${css.legendLine} ${css.legendDashed}`} />{t('legend.edgeDashed')}</span>
            </footer>
        </section>
    )
}
