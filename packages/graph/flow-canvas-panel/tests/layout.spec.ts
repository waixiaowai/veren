/**
 * Layout contracts: left-to-right ranks, compact node boxes, branch fan-out
 * order, and label collision avoidance.
 *
 * 布局契约：从左到右的 rank、紧凑节点框、分支扇出顺序，以及标签避让。
 */

import { describe, expect, it } from 'vitest'
import { projectFlow } from '@deepseek-ai/dsh-graph-flow-canvas'
import { demoFlows } from '../src/demo.ts'
import {
    hasConditionalEdges,
    layoutFlow,
    NODE_HEIGHT,
    NODE_WIDTH,
} from '../src/client/layout.ts'
import { estimateEdgeLabelWidth, placeEdgeLabels } from '../src/client/edgeLabels.ts'

describe('layoutFlow', () => {
    it('lays the demo out in columns and keeps the graph wide but short', () => {
        const flow = projectFlow(demoFlows()[0]!)
        const layout = layoutFlow(flow)
        const start = layout.nodes['start']!
        const gate = layout.nodes['gate']!
        const recover = layout.nodes['recover']!
        const normal = layout.nodes['normal']!
        const fatal = layout.nodes['fatal']!
        expect(start.rank).toBe(0)
        expect(gate.rank).toBe(1)
        expect(recover.rank).toBe(2)
        expect(normal.rank).toBe(2)
        expect(fatal.rank).toBe(3)
        expect(gate.x).toBeGreaterThan(start.x)
        expect(recover.x).toBe(normal.x)
        expect(recover.y).toBeLessThan(normal.y)
        expect(start.width).toBe(NODE_WIDTH)
        expect(start.height).toBe(NODE_HEIGHT)
        expect(layout.width).toBeGreaterThan(layout.height * 4)
    })

    it('fans branches out in target order, so they do not cross', () => {
        const flow = projectFlow(demoFlows()[0]!)
        const layout = layoutFlow(flow)
        const gateRecover = layout.edges.find(edge => edge.from === 'gate' && edge.to === 'recover')!
        const gateNormal = layout.edges.find(edge => edge.from === 'gate' && edge.to === 'normal')!
        const startY = (path: string): number => Number(path.split(' ')[2])
        expect(startY(gateRecover.path)).toBeLessThan(startY(gateNormal.path))
        expect(hasConditionalEdges(flow.edges)).toBe(true)
    })

    it('routes every edge to the next rank with an arrow-ready path', () => {
        const flow = projectFlow(demoFlows()[0]!)
        const layout = layoutFlow(flow)
        expect(layout.edges).toHaveLength(flow.edges.length)
        for (const edge of layout.edges) expect(edge.path.startsWith('M ')).toBe(true)
        const labelCount = layout.edges.filter(edge => edge.condition.kind !== 'always').length
        expect(labelCount).toBe(2)
    })
})

describe('edge label placement', () => {
    it('estimates wider pills for CJK text', () => {
        expect(estimateEdgeLabelWidth('默认分支')).toBeGreaterThan(estimateEdgeLabelWidth('ok'))
    })

    it('nudges overlapping labels apart and keeps them off node boxes', () => {
        const placed = placeEdgeLabels(
            [
                { id: 'a', x: 100, y: 100, width: 80, height: 20 },
                { id: 'b', x: 100, y: 102, width: 80, height: 20 },
            ],
            [{ x: 60, y: 80, width: 80, height: 40 }],
            { width: 400, height: 300 },
        )
        expect(placed).toHaveLength(2)
        expect(placed[0]!.y).not.toBe(placed[1]!.y)
        const first = placed[0]!
        const second = placed[1]!
        const overlaps = Math.abs(first.x - second.x) * 2 < first.width + second.width + 6
            && Math.abs(first.y - second.y) * 2 < first.height + second.height + 6
        expect(overlaps).toBe(false)
    })
})
