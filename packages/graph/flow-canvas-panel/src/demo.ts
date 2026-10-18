/**
 * First-version demo flows registered by the Host half.
 *
 * A fresh profile has the graph services but no flow definitions, so the panel
 * would open empty. These are real engine registrations through
 * `FlowEngine.registerFlow`, using only the built-in `noop` / `echo` / `fail`
 * node types; they demonstrate a recovered `errorBranch`, a fail-fast failure,
 * skipped downstream nodes, a visible `running` state (retry) and a predicate
 * edge. A deployment that registers its own flows keeps seeing them in the
 * selector; the demo ids are only added when absent.
 *
 * 第一版由宿主半边注册的演示 flow。新 profile 只有 graph 服务而没有 flow 定义，面板会
 * 打开为空。这里通过 `FlowEngine.registerFlow` 做真实注册，只使用内置 `noop` / `echo` /
 * `fail` 节点，覆盖 recovered 的 errorBranch、fail-fast 失败、下游 skipped、可见的
 * running（重试）以及谓词边。部署自己注册的 flow 仍会出现在选择器中；演示 id 只在缺失时添加。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/demo
 */

import type { FlowDefinition, FlowId, NodeId } from '@deepseek-ai/dsh-graph-flow-api'

/** Canonical demo id, matching `flow-canvas/examples/demo.flow.yaml`. */
export const DEMO_FLOW_ID = 'canvas-demo'

/** Paced copy that keeps `running` visible through real retry backoff. */
export const PACED_FLOW_ID = 'canvas-demo-pacing'

/** Same graph with one always-true predicate so its edge label is visible. */
export const PREDICATE_FLOW_ID = 'canvas-demo-predicate'

/** Brand one literal node id, matching the engine's declaration contract. */
const node = (id: string): NodeId => id as NodeId

/** Build the canonical demo definition (one recovered failure, one fatal failure). */
function canonical(): FlowDefinition {
    return {
        id: DEMO_FLOW_ID as FlowId,
        nodes: [
            { id: node('start'), type: 'noop', config: { label: '开始' } },
            { id: node('gate'), type: 'fail', config: { message: '演示：可恢复失败', label: '兜底分支' }, onError: 'errorBranch' },
            { id: node('recover'), type: 'echo', config: { message: 'RECOVERED', label: '恢复分支' } },
            { id: node('normal'), type: 'echo', config: { message: 'NORMAL', label: '正常分支' } },
            { id: node('fatal'), type: 'fail', config: { message: '演示：致命失败', label: '致命分支' } },
            { id: node('join'), type: 'noop', config: { label: '汇合' } },
        ],
        edges: [
            { from: node('start'), to: node('gate') },
            { from: node('gate'), to: node('recover'), port: 'error' },
            { from: node('gate'), to: node('normal') },
            { from: node('recover'), to: node('fatal') },
            { from: node('fatal'), to: node('join') },
        ],
        output: { recovered: '${recover.message}' },
    }
}

/** Clone the canonical definition and retry its two `fail` nodes. */
function paced(base: FlowDefinition): FlowDefinition {
    const clone = structuredClone(base)
    clone.id = PACED_FLOW_ID as FlowId
    for (const definition of clone.nodes) {
        if (definition.type === 'fail') definition.retry = { tries: 3, backoffMs: 1500 }
    }
    return clone
}

/** Clone the canonical definition and add one predicate edge that is visible in the projection. */
function predicate(base: FlowDefinition): FlowDefinition {
    const clone = structuredClone(base)
    clone.id = PREDICATE_FLOW_ID as FlowId
    const edge = clone.edges.find(candidate => candidate.from === node('recover') && candidate.to === node('fatal'))
    if (edge !== undefined) edge.when = () => true
    return clone
}

/**
 * Every demo definition, in selector order.
 * @returns the definitions the Host registers when their ids are absent.
 */
export function demoFlows(): readonly FlowDefinition[] {
    const base = canonical()
    return [base, paced(base), predicate(base)]
}
