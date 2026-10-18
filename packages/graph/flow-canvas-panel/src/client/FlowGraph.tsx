/**
 * Pan/zoom graph view. Presentation only: layout is computed from the static
 * projection, each node card comes from the `flow.canvas.node` slot dispatch
 * supplied by the panel, and the viewport transform is local state.
 *
 * The graph is left-to-right (the n8n / Dify / Coze convention) so it uses the
 * wide panel instead of a narrow vertical strip. Drag pans, the wheel zooms
 * around the cursor, and the controls offer zoom out / reset / zoom in / fit.
 *
 * 可平移缩放的图视图。只负责展示：布局从静态投影计算，每张节点卡片来自面板提供的
 * `flow.canvas.node` 槽位分发，视口变换是本地状态。图从左到右（n8n / Dify / Coze 的习惯），
 * 因此使用宽面板而不是窄竖带。拖拽平移、滚轮以光标为锚点缩放，控件提供缩小/重置/放大/适应屏幕。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/FlowGraph
 */

import { useMemo, type ReactNode } from 'react'
import type { CanvasFlow, CanvasNode, CanvasNodeRuntime } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RunView } from './store.ts'
import { GraphEdges } from './GraphEdges.tsx'
import { layoutFlow } from './layout.ts'
import { useCanvasViewport } from './useCanvasViewport.ts'
import { zoomPercent } from './view.ts'
import css from './panel.module.css'

/** Inputs of the graph view. */
export interface FlowGraphProps {
    /** Static projection to draw. */
    readonly flow: CanvasFlow
    /** Current run, when one exists. */
    readonly run: RunView | undefined
    /** Inspected node id. */
    readonly selectedNodeId: string | undefined
    /** Render one node card through the node-renderer slot. */
    readonly renderNode: (node: CanvasNode, runtime: CanvasNodeRuntime | undefined, selected: boolean) => ReactNode
    /** Clear the selection when the empty canvas is clicked. */
    readonly onClearSelection?: () => void
    /** Panel translator. */
    readonly t: TranslateNS<'flowCanvas'>
}

/**
 * Draw the graph.
 * @param props - projection, run, selection, clear callback and node renderer.
 * @returns the graph surface.
 */
export function FlowGraph({ flow, run, selectedNodeId, renderNode, onClearSelection, t }: FlowGraphProps) {
    const layout = useMemo(() => layoutFlow(flow), [flow])
    const viewport = useCanvasViewport(layout, flow.flowId, selectedNodeId, onClearSelection)
    return (
        <div
            ref={viewport.ref}
            className={[css.graphViewport, viewport.dragging ? css.graphViewportDragging : ''].filter(Boolean).join(' ')}
            aria-label={t('panel.title')}
            onPointerDown={viewport.onPointerDown}
            onPointerMove={viewport.onPointerMove}
            onPointerUp={viewport.onPointerEnd}
            onPointerCancel={viewport.onPointerEnd}
            onDoubleClick={viewport.onDoubleClick}
        >
            <div
                className={css.graphContent}
                style={{
                    width: layout.width,
                    height: layout.height,
                    transform: `translate(${viewport.view.x}px, ${viewport.view.y}px) scale(${viewport.view.zoom})`,
                }}
            >
                <GraphEdges layout={layout} run={run} t={t} />
                {flow.nodes.map((node) => {
                    const box = layout.nodes[node.id]
                    if (box === undefined) return null
                    const selected = node.id === selectedNodeId
                    return (
                        <div
                            key={node.id}
                            data-flow-node={node.id}
                            className={css.nodeSlot}
                            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
                        >
                            {renderNode(node, run?.nodes[node.id], selected)}
                        </div>
                    )
                })}
            </div>
            {flow.nodes.length === 0
                ? <p className={css.emptyGraph}>{t('panel.emptyGraph')}</p>
                : null}
            <div className={css.canvasHint} data-canvas-control>
                {t('canvas.hint')}
            </div>
            <div className={css.zoomControls} data-canvas-control>
                <button type="button" className={css.zoomButton} aria-label={t('canvas.zoomOut')} title={t('canvas.zoomOut')} onClick={() => { viewport.zoomBy(1 / 1.2) }}>−</button>
                <button type="button" className={css.zoomValue} aria-label={t('canvas.zoomReset')} title={t('canvas.zoomReset')} onClick={viewport.reset}>{zoomPercent(viewport.view)}%</button>
                <button type="button" className={css.zoomButton} aria-label={t('canvas.zoomIn')} title={t('canvas.zoomIn')} onClick={() => { viewport.zoomBy(1.2) }}>+</button>
                <span className={css.zoomDivider} aria-hidden="true" />
                <button type="button" className={css.fitButton} aria-label={t('canvas.fit')} title={t('canvas.fit')} onClick={viewport.fit}>
                    <span aria-hidden="true">⛶</span>
                    {t('canvas.fit')}
                </button>
            </div>
        </div>
    )
}

/** Kept for the panel's prop typing. */
export type { FlowGraphProps as FlowGraphComponentProps }
