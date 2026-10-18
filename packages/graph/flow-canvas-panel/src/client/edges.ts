/**
 * Edge presentation mapping: condition kind → palette, short label and a
 * localized tooltip. Unconditional edges stay unlabelled; port, predicate and
 * error-branch default edges remain distinguishable at a glance.
 *
 * 边的展示映射：条件种类 → 色板、短标签与本地化 tooltip。无条件边不加标签；
 * 端口、谓词与 errorBranch 默认边一眼可区分。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/edges
 */

import type { CanvasEdgeCondition } from '@deepseek-ai/dsh-graph-flow-canvas'
import type { FlowCanvasKey } from './locales.ts'

/** Edge label key plus its values; `undefined` means the edge stays unlabelled. */
export interface EdgeLabel {
    readonly key: FlowCanvasKey
    readonly params: Readonly<Record<string, string | number>>
}

/** Edge palette key (one CSS class per condition kind). */
export type EdgeTone = CanvasEdgeCondition['kind']

/** Everything the graph needs to draw one edge. */
export interface EdgeVisual {
    readonly tone: EdgeTone
    readonly label: EdgeLabel | undefined
    readonly title: string
    readonly titleKey: FlowCanvasKey | undefined
    readonly dashed: boolean
}

/**
 * Condition edge → visual facts. Unconditional edges stay unlabelled; the
 * built-in `error` port gets a readable branch name, while a custom port keeps
 * its declared name.
 * @param condition - the projected condition.
 * @returns palette key, optional label, tooltip, and dashed flag.
 */
export function edgeVisual(condition: CanvasEdgeCondition): EdgeVisual {
    switch (condition.kind) {
        case 'port': {
            const port = condition.port ?? '?'
            const known = port === 'error'
            return {
                tone: 'port',
                label: known
                    ? { key: condition.hasPredicate ? 'edge.errorPortPredicate' : 'edge.errorPort', params: {} }
                    : {
                        key: condition.hasPredicate ? 'edge.portPredicate' : 'edge.port',
                        params: { port },
                    },
                title: condition.summary,
                titleKey: known ? 'edge.errorPortTitle' : 'edge.portTitle',
                dashed: false,
            }
        }
        case 'predicate':
            return {
                tone: 'predicate',
                label: { key: 'edge.predicate', params: {} },
                title: condition.summary,
                titleKey: 'edge.predicateTitle',
                dashed: false,
            }
        case 'error-branch-default':
            return {
                tone: 'error-branch-default',
                label: { key: condition.hasPredicate ? 'edge.defaultPredicate' : 'edge.default', params: {} },
                title: condition.summary,
                titleKey: 'edge.defaultTitle',
                dashed: true,
            }
        case 'always':
            return {
                tone: 'always',
                label: undefined,
                title: condition.summary,
                titleKey: undefined,
                dashed: false,
            }
        default:
            return assertNever(condition.kind)
    }
}

/** Closed-union exhaustiveness fence. */
function assertNever(value: never): never {
    throw new Error(`unhandled edge condition: ${String(value)}`)
}
