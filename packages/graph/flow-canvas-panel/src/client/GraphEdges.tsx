/**
 * SVG edges and their pill labels. Kept separate from node cards so edge
 * routing, port dots, arrowheads and label collision avoidance can evolve on
 * their own.
 *
 * Edges leave from a visible source port and end at the target port. Conditional
 * edges keep their semantic colour; edges whose target never ran are muted and
 * dotted, so "skipped branch" reads differently from "error-branch default"
 * (which stays dashed).
 *
 * SVG 边与胶囊标签。它与节点卡片分开，便于独立演进边的路由、端口点、箭头与标签避让。
 * 连线从可见的起点端口出发、在终点端口结束。条件边保留语义色；目标未执行的边变灰并改用点线，
 * 因此“跳过分支”与“error 默认边”（仍是虚线）可以区分。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/GraphEdges
 */

import { useMemo } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { edgeVisual, type EdgeTone } from './edges.ts'
import {
    estimateEdgeLabelWidth,
    placeEdgeLabels,
    type LabelPlacement,
} from './edgeLabels.ts'
import type { FlowLayout } from './layout.ts'
import type { RunView } from './store.ts'
import css from './panel.module.css'

/** Inputs of the edge layer. */
export interface GraphEdgesProps {
    /** Laid-out graph. */
    readonly layout: FlowLayout
    /** Current run, used to distinguish executed from skipped branches. */
    readonly run: RunView | undefined
    /** Panel translator. */
    readonly t: TranslateNS<'flowCanvas'>
}

/** Paint tone: a condition tone plus the "not executed" state. */
type PaintTone = EdgeTone | 'skipped'

/** Edge tone → CSS class. */
function edgeClass(tone: PaintTone): string {
    const classes = {
        always: '',
        port: css.edgePort,
        predicate: css.edgePredicate,
        'error-branch-default': css.edgeErrorBranchDefault,
        skipped: css.edgeSkipped,
    } as const
    return classes[tone] ?? ''
}

/** Edge tone → label-pill class. */
function labelClass(tone: PaintTone): string {
    const classes = {
        always: '',
        port: css.edgeLabelPort,
        predicate: css.edgeLabelPredicate,
        'error-branch-default': css.edgeLabelErrorBranchDefault,
        skipped: css.edgeLabelSkipped,
    } as const
    return classes[tone] ?? ''
}

/** Edge tone → arrow-head CSS class. */
function arrowClass(tone: PaintTone): string {
    const classes = {
        always: css.arrowAlways,
        port: css.arrowPort,
        predicate: css.arrowPredicate,
        'error-branch-default': css.arrowErrorBranchDefault,
        skipped: css.arrowSkipped,
    } as const
    return classes[tone] ?? ''
}

/** Edge tone → port-dot CSS class. */
function portDotClass(tone: PaintTone): string {
    const classes = {
        always: css.portDotAlways,
        port: css.portDotPort,
        predicate: css.portDotPredicate,
        'error-branch-default': css.portDotErrorBranchDefault,
        skipped: css.portDotSkipped,
    } as const
    return classes[tone] ?? ''
}

/** One marker id per paint tone (including the skipped variant). */
function markerId(tone: PaintTone): string {
    return `flow-arrow-${tone}`
}

/** A target that never executed is a skipped/withdrawn branch. */
function isSkipped(run: RunView | undefined, nodeId: string): boolean {
    const status = run?.nodes[nodeId]?.status
    return status === 'skipped' || status === 'cancelled'
}

/** One rendered edge label. */
type RenderedLabel = LabelPlacement & {
    readonly text: string
    readonly tone: PaintTone
    readonly skipped: boolean
    readonly title: string
}

/**
 * Draw every edge and its label.
 * @param props - layout, run and translator.
 * @returns the SVG path layer plus HTML label pills.
 */
export function GraphEdges({ layout, run, t }: GraphEdgesProps) {
    const labels = useMemo<readonly RenderedLabel[]>(() => {
        const candidates: RenderedLabel[] = []
        for (const edge of layout.edges) {
            const visual = edgeVisual(edge.condition)
            if (visual.label === undefined) continue
            const skipped = isSkipped(run, edge.to)
            const text = t(visual.label.key, visual.label.params)
            candidates.push({
                id: edge.id,
                x: edge.labelX,
                y: edge.labelY,
                width: estimateEdgeLabelWidth(text),
                height: 21,
                text,
                tone: skipped ? 'skipped' : visual.tone,
                skipped,
                title: visual.titleKey === undefined ? visual.title : t(visual.titleKey, visual.label.params),
            })
        }
        const placed = placeEdgeLabels(
            candidates,
            Object.values(layout.nodes),
            { width: layout.width, height: layout.height },
        )
        const byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
        return placed.map((placement) => {
            const source = byId.get(placement.id)
            return {
                ...source,
                ...placement,
                text: source?.text ?? '',
                tone: source?.tone ?? 'always',
                skipped: source?.skipped ?? false,
                title: source?.title ?? '',
            }
        })
    }, [layout, run, t])

    const markerTones: readonly PaintTone[] = ['always', 'port', 'predicate', 'error-branch-default', 'skipped']
    return (
        <>
            <svg
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
                className={css.edgeLayer}
            >
                <defs>
                    {markerTones.map(tone => (
                        <marker
                            key={tone}
                            id={markerId(tone)}
                            viewBox="0 0 8 8"
                            refX="7"
                            refY="4"
                            markerWidth="7"
                            markerHeight="7"
                            orient="auto-start-reverse"
                        >
                            <path className={arrowClass(tone)} d="M 0 0 L 8 4 L 0 8 z" />
                        </marker>
                    ))}
                </defs>
                {layout.edges.map((edge) => {
                    const visual = edgeVisual(edge.condition)
                    const skipped = isSkipped(run, edge.to)
                    const tone: PaintTone = skipped ? 'skipped' : visual.tone
                    const dash = skipped ? '2 5' : visual.dashed ? '6 5' : undefined
                    return (
                        <g key={edge.id}>
                            <path
                                className={[css.edge, edgeClass(tone)].filter(Boolean).join(' ')}
                                d={edge.path}
                                strokeDasharray={dash}
                                markerEnd={`url(#${markerId(tone)})`}
                                data-edge-skipped={skipped ? 'true' : undefined}
                            >
                                <title>
                                    {visual.titleKey === undefined
                                        ? visual.title
                                        : t(visual.titleKey, visual.label?.params ?? {})}
                                </title>
                            </path>
                            <circle
                                cx={edge.fromX}
                                cy={edge.fromY}
                                r={3.5}
                                className={[css.portDot, portDotClass(tone)].join(' ')}
                                data-flow-port="source"
                            />
                            <circle
                                cx={edge.toX}
                                cy={edge.toY}
                                r={3}
                                className={[css.portDot, portDotClass(tone)].join(' ')}
                                data-flow-port="target"
                            />
                        </g>
                    )
                })}
            </svg>
            {labels.map(label => (
                <div
                    key={label.id}
                    className={css.edgeLabelAnchor}
                    style={{ transform: `translate(${label.x - label.width / 2}px, ${label.y - label.height / 2}px)` }}
                    title={label.title}
                >
                    <span className={[css.edgeLabel, labelClass(label.tone)].filter(Boolean).join(' ')}>{label.text}</span>
                </div>
            ))}
        </>
    )
}
