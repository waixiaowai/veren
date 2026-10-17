# @deepseek-ai/dsh-graph-flow-canvas

The canvas data source for flows: a serializable static projection plus a live per-node run projection. Use it when an upper layer (a future visual canvas, a CLI renderer, or an editor plugin) needs to draw or inspect a registered flow without knowing kernel scheduling, blackboard or event internals. Skip it when you need to execute or define flows (`@deepseek-ai/dsh-graph-flow-engine`) or when you are looking for a browser UI — this package ships no UI, no renderer and no layout algorithm.

## What it provides

- **`graphFlowCanvas` service** — `project(flowId)` / `projectDefinition(def)` return `CanvasFlow`; `watch(handle)` / `run(flowId, options, listener)` return a `CanvasRunProjection`.
- **Static projection (`CanvasFlow`)** — every node has `id`, `type`, optional pinned `version`, a `display` label/subtitle, JSON-safe `config` and `input`, `onError`/`retry`/`timeout`, and a `layout` slot; every edge has stable `from`/`to`, an optional named `port`, and a serializable `condition` (`always` | `port` | `predicate` | `error-branch-default`, the last one marking a default output that closes when the error port activates). The shape is versioned (`schemaVersion: 1`) and stable across `JSON.stringify` / `JSON.parse`.
- **Conditional edges without leaking functions** — a predicate is a function and therefore cannot enter JSON; the projection marks `condition.kind: 'predicate'` and `hasPredicate: true`, while a named output port is exposed verbatim (`condition.kind: 'port'`, `condition.port`). A default edge out of an `errorBranch` node is marked `kind: 'error-branch-default'` because it closes when the error port activates. Predicate text is never evaluated by this package.
- **Layout is caller-owned** — `CanvasFlow.layout` exists but is empty (`{ viewport: null, nodes: {}, edges: {} }`), and every node/edge has a `layout: null` slot. Fill it on the caller side; the kernel stores no layout and this package never invents coordinates.
- **Runtime projection** — subscribing to a run yields `pending → ready → running → completed | failed | skipped | cancelled` per node, with `skipReason`, structured `error`, `startedAt` and `endedAt`. No polling and no log reading: it consumes the engine's `flow/node-status` event (forwarded from the kernel's neutral `graph/node-status` event).
- **Final snapshot matches `FlowRunResult`** — `projection.finished` resolves to `CanvasRunSnapshot` whose `result` is the exact `FlowRunResult` returned by `handle.awaitCompletion()`, and whose `nodes` are re-synced from that result so late subscribers cannot miss a settle.
- **Clean teardown** — the projection removes its `flow/node-status` and `flow/run-end` listeners when the run ends; `dispose()` is idempotent and only stops the subscription (it does not cancel the run).
- **`getFlow` on the engine** — the canvas service reads the registered definition through `FlowEngine.getFlow(flowId)`; unknown ids fail with `CANVAS_FLOW_NOT_FOUND`, and non-JSON configs fail with `CANVAS_NOT_SERIALIZABLE`.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as kernel } from '@deepseek-ai/dsh-graph-core';
import { apply as engine, FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as canvas, FlowCanvasToken } from '@deepseek-ai/dsh-graph-flow-canvas';

const ctx = new Context();
await ctx.plugin(kernel);
await ctx.plugin(engine, { nodeTimeoutMs: 30_000 });
await ctx.plugin(canvas);
const flow = ctx.get(FlowEngineToken)!;
const view = ctx.get(FlowCanvasToken)!;

await flow.registerFlow({
    id: 'demo',
    nodes: [
        { id: 'src', type: 'echo', config: { message: 'hi', label: 'Source' } },
        { id: 'sink', type: 'noop', input: { said: '${src.message}' } },
    ],
    edges: [{ from: 'src', to: 'sink' }],
    output: { said: '${sink.said}' },
});

const staticCanvas = view.project('demo');
staticCanvas.layout.nodes['src'] = { x: 40, y: 80 }; // caller-owned layout

const live = view.run('demo', {}, (change) => {
    console.log(change.nodeId, change.status, change.skipReason ?? '', change.error ?? '');
});
const final = await live.finished;
console.log(final.status, final.result?.output);
```

## Demo

The runnable demo loads `examples/demo.flow.yaml` through the real YAML Loader, prints the canvas JSON, then prints the per-node status stream of one run:

```bash
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo
```

It shows one run containing an `error` port condition (`gate → recover`), a skipped default branch (`normal`, `upstream-condition`), a failed node (`fatal`, `NODE_FAILED`) and a skipped downstream (`join`, `upstream-failure`).

## Contract notes

- `watch(handle)` must be called promptly after `engine.run()`; the projection seeds every node as `pending` from the registered definition and buffers nothing from before it was attached. Use `run()` (which starts and subscribes in one call) when that matters.
- The final `snapshot.nodes` is rebuilt from `FlowRunResult`, so it is authoritative even when a status event was missed.
- `flow/node-status` is an engine event; no flow layer status is written to storage or logs by this package.

## Non-goals (phase 2)

- No browser UI, renderer, layout algorithm or frontend dependency. This package only produces data.
- No layout persistence: coordinates never enter the kernel or the engine.
- No expression evaluation: predicates are reported, not interpreted.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
