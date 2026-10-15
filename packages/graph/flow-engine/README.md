# @veren/graph-flow-engine

The flow semantic-layer engine on top of the DAG kernel. Use it when you want flow semantics — typed nodes with schema-validated configs, explicit input mappings, a per-run blackboard, retry/timeout/onError policies, subflows and mocks — compiled onto the neutral kernel. Skip it when you only need the kernel itself (`@veren/graph-core`) or type-only declarations (`@veren/graph-flow-api`).

## What it provides

- **`FlowEngine` service** (`graphFlowEngine`): `registerFlow` / `unregisterFlow` / `hasFlow` / `run` / `listRuns`.
- **Registration-time compilation, fails loud**: `NODE_TYPE_NOT_FOUND`, `NODE_CONFIG_INVALID`, `FLOW_CYCLE_DETECTED`, `FLOW_REFERENCE_CYCLE` (mutual subflow references), `GRAPH_DANGLING_EDGE` passthrough.
- **`run()` → `FlowRunHandle`**: `status()`, cooperative `cancel()`, `awaitCompletion()`; `FlowRunResult` carries resolved output variables plus per-node records (`{ status, skipReason?, startedAt, endedAt, error? }`).
- **Node executor wrapper**: explicit input mapping (`${nodeId.slot}` or literals), retry (`{ tries, backoffMs }`), node-level or engine-level timeout (`NODE_TIMEOUT`), `mocks` (pinned outputs, execution skipped), `onError` policies — `failFast` (default), `fallback` (declarative value keeps the flow running), `errorBranch` (failure continues along the named `error` port; the default port closes instead).
- **Built-in node types** (reference implementations / test fixtures only): `noop`, `fail`, `echo`, `subflow` (a flow used as a node; reference cycles are detected at registration and recursion at runtime).
- **Start/End signatures**: `input` schema validated per run; `output` slot references resolved into `FlowRunResult.output`.
- **Node-type versions**: the registry indexes by `(type, version)`; handlers re-resolve at run time, so uninstalling a node plugin makes later runs fail loudly with `NODE_TYPE_NOT_FOUND`.
- **Flow events**: `flow/run-starting` (`@mode serial`, truthy refuses), `flow/run-start`, `flow/run-end` (`@mode emit`, with output variables and a blackboard snapshot). The kernel's `graph/node-post-execute` waterfall rewrites flow into the blackboard, so downstream nodes read rewritten values.
- **Storage seam**: the engine never touches storage directly; load `@veren/graph-flow-storage` to persist definitions and run records through the optional `FlowStorageToken` capability.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as kernel } from '@veren/graph-core';
import { apply as engine, FlowEngineToken } from '@veren/graph-flow-engine';

const ctx = new Context();
await ctx.plugin(kernel);
await ctx.plugin(engine, { nodeTimeoutMs: 30_000 });
const flow = ctx.get(FlowEngineToken)!;

await flow.registerFlow({
    id: 'demo',
    nodes: [
        { id: 'src', type: 'echo', config: { message: 'hi' } },
        { id: 'sink', type: 'noop', input: { said: '${src.message}' } },
    ],
    edges: [{ from: 'src', to: 'sink' }],
    output: { said: '${sink.said}' },
});
const result = await flow.run('demo').awaitCompletion();
```

Config: `nodeTimeoutMs` (default node timeout, 30 000 ms).

## Non-goals (phase 2)

No client-side visual canvas (the kernel `Graph` is the future data source; run state is subscribable via events today). No iteration/loop nodes, no triggers, no expression language beyond `${nodeId.slot}`.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
