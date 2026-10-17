# @deepseek-ai/dsh-graph-core

A business-agnostic directed-acyclic-graph (DAG) execution kernel for Cordis-based applications. Use it when you need to run a dependency graph of abstract nodes — flow engines, pipelines, task orchestration — without the kernel knowing what a node is or how data flows. If you want flow semantics (typed nodes, blackboard data passing), build them on top with `@deepseek-ai/dsh-graph-flow-engine`; the kernel itself stays neutral.

## What it provides

- **Neutral model** — `GNode{id}`, `GEdge{from, to, when?}`, `Graph{id, nodes, edges}`. The `when` predicate on an edge is injected by the upper layer; the kernel only owns *when* it is evaluated (after the upstream node settles).
- **Validation, loud and early** — `GRAPH_DUPLICATE_NODE`, `GRAPH_DANGLING_EDGE`, `GRAPH_CYCLE_DETECTED` (Kahn topological sort included).
- **Ready-set scheduler** — topological scheduling with a concurrency cap (`concurrency`, default 4).
- **Node status machine** — `pending → ready → running → completed | failed | skipped | cancelled`, with per-node records (`startedAt`, `endedAt`, `error`, `output`, `skipReason`).
- **Run contexts** — each run derives a child context via `ctx.extend({ graphId, runId, signal })` (`GraphRunContext` extends the Cordis `Context`, it is not a new interface); node scopes derive via `ctx.isolate(nodeId)`. The status-reporting capability is provided on the run context under `RunStatusToken`.
- **Lifecycle events** (declaration merging, `@mode` in JSDoc):
  - `graph/run-starting` `@mode serial` — a truthy listener return refuses the run;
  - `graph/run-start` `@mode emit`;
  - `graph/node-pre-execute` `@mode bail` — a truthy return vetoes the node (skipped, `pre-execute-veto`);
  - `graph/node-post-execute` `@mode waterfall` — listeners mutate `envelope.output` and **must call `next()`**;
  - `graph/node-error` `@mode emit` — structured error `{ code, graphId, runId, nodeId, cause }`;
  - `graph/node-status` `@mode emit` — every node transition (`pending`/`ready`/`running`/`completed`/`failed`/`skipped`/`cancelled`) with `skipReason`, `error`, `startedAt`, `endedAt`; the neutral data source for live canvases and CLIs;
  - `graph/run-end` `@mode emit` — `{ runId, graphId, status }`.
- **Failure propagation** — fail-fast by default: downstream of a failure is `skipped` (`upstream-failure`), running siblings finish naturally (the signal only notifies; executors opt in), the run ends `failed`. The strategy is replaceable per run via `onNodeFailure` (future continue/retry strategies plug in without kernel changes).
- **Cancellation** — an external cancel marks every unsettled node `cancelled`, including never-started downstream nodes; a node that rejects while the cancel is in flight also lands `cancelled`, carries no `skipReason` and emits no `node-error`. The fail-fast notice uses a separate abort reason, so it stops new scheduling without relabelling running siblings.
- **Edge conditions** — a false `when` skips that edge's downstream subtree with `upstream-condition`, distinct from failure propagation.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply, GraphKernelToken } from '@deepseek-ai/dsh-graph-core';

const ctx = new Context();
await ctx.plugin(apply, { concurrency: 4 });
const kernel = ctx.get(GraphKernelToken)!;

const handle = kernel.run({
  id: 'demo',
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ from: 'a', to: 'b' }],
}, {
  execute: async (node, runCtx) => {
    runCtx.signal.throwIfAborted(); // cooperative cancel
    return { from: node.id };
  },
}, { runId: 'r1' });

handle.cancel(); // optional, cooperative
const result = await handle.result;
```

## Non-goals (phase 2)

- No client-side visual canvas — the neutral `Graph` model and `graph/node-status` stay the data source; `@deepseek-ai/dsh-graph-flow-canvas` turns them into a serializable canvas/CLI projection. Layout metadata is attached by upper layers, never stored here.
- No iteration/loop nodes, no triggers, no expression language (only `${nodeId.slot}` slot references exist, at the flow layer).
- No data passing between nodes — adapt it inside your `GExecutor`.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
