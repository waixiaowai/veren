/**
 * Host-side boundary: the service names this out-of-tree plugin addresses by
 * name, and the demo definitions the Host registers through the public engine
 * API.
 *
 * 宿主侧边界：这个仓库外插件按名称寻址的服务名，以及宿主通过公开引擎 API 注册的演示定义。
 */

import { describe, expect, it } from 'vitest'
import { FlowCanvasToken, projectFlow } from '@deepseek-ai/dsh-graph-flow-canvas'
import { FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine'
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api'
import { FLOW_APPROVAL_SERVICE, FLOW_CANVAS_SERVICE, FLOW_ENGINE_SERVICE } from '../src/tokens.ts'
import { demoFlows } from '../src/demo.ts'

describe('Host service names', () => {
    it('match the authoritative canvas, engine and approval tokens', () => {
        expect(FLOW_CANVAS_SERVICE).toBe(FlowCanvasToken)
        expect(FLOW_ENGINE_SERVICE).toBe(FlowEngineToken)
        expect(FLOW_APPROVAL_SERVICE).toBe(FlowApprovalToken)
    })
})

describe('demo flows', () => {
    it('covers recovered, retry and predicate behavior', () => {
        const flows = demoFlows()
        expect(flows.map(flowDef => flowDef.id)).toEqual(['canvas-demo', 'canvas-demo-pacing', 'canvas-demo-predicate'])
        expect(flows[0]?.nodes.some(node => node.onError === 'errorBranch')).toBe(true)
        expect(flows[1]?.nodes.filter(node => node.type === 'fail').every(node => node.retry !== undefined)).toBe(true)
        expect(flows[2]?.edges.some(edge => edge.when !== undefined)).toBe(true)
    })

    it('projects through the public canvas layer', () => {
        const projected = projectFlow(demoFlows()[0]!)
        expect(projected.meta).toEqual({ nodeCount: 6, edgeCount: 5 })
        expect(projected.edges.some(edge => edge.condition.kind === 'port' && edge.condition.port === 'error')).toBe(true)
        expect(projected.edges.some(edge => edge.condition.kind === 'error-branch-default')).toBe(true)
    })
})
