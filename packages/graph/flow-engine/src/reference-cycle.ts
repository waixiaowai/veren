/**
 * Flow reference-cycle detection: a DFS over the flow→flow reference graph,
 * performed at registration time so a cycle fails loudly instead of recursing
 * at run time.
 *
 * flow 引用环检测：对 flow→flow 引用图做 DFS，注册期即 fail loud，而不是等到
 * 运行期递归爆栈。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/reference-cycle
 */

import type { FlowId } from '@deepseek-ai/dsh-graph-flow-api';
import { flowError } from './flow-error.js';
import type { CompiledFlow } from './types.js';

/** flow 引用图 DFS 找环 / find reference cycles in the flow reference graph */
export function assertNoReferenceCycle(flows: Map<FlowId, CompiledFlow>, compiled: CompiledFlow): void {
    const definitionId = compiled.definition.id;
    const graph = new Map<FlowId, readonly FlowId[]>();
    for (const [id, flow] of flows) {
        if (id !== definitionId) graph.set(id, flow.references);
    }
    graph.set(definitionId, compiled.references);
    const visiting = new Set<FlowId>();
    const done = new Set<FlowId>();
    const stack: FlowId[] = [];
    const visit = (id: FlowId): void => {
        if (visiting.has(id)) {
            const start = Math.max(0, stack.indexOf(id));
            throw flowError('FLOW_REFERENCE_CYCLE', `flow reference cycle: ${[...stack.slice(start), id].join(' -> ')}`, { flowId: id });
        }
        if (done.has(id)) return;
        visiting.add(id);
        stack.push(id);
        for (const next of graph.get(id) ?? []) visit(next);
        stack.pop();
        visiting.delete(id);
        done.add(id);
    };
    for (const id of graph.keys()) visit(id);
}
