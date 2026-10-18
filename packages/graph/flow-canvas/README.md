# @deepseek-ai/dsh-graph-flow-canvas

The canvas data source for flows: a serializable static projection plus a live per-node run projection. Use it when an upper layer (a future visual canvas, a CLI renderer, or an editor plugin) needs to draw or inspect a registered flow without knowing kernel scheduling, blackboard or event internals. Skip it when you need to execute or define flows (`@deepseek-ai/dsh-graph-flow-engine`) or when you are looking for a browser UI — this package ships no UI, no renderer and no layout algorithm. It is included in `@deepseek-ai/dsh-graph-bundle` as the `graph-flow-canvas` row.

## What it provides

- **`graphFlowCanvas` service** — `project(flowId)` / `projectDefinition(def)` return `CanvasFlow`; `watch(handle)` / `run(flowId, options, listener)` return a `CanvasRunProjection`.
- **Static projection (`CanvasFlow`)** — every node has `id`, `type`, optional pinned `version`, a `display` label/subtitle, JSON-safe `config` and `input`, `onError`/`retry`/`timeout`, and a `layout` slot; every edge has stable `from`/`to`, an optional named `port`, and a serializable `condition` (`always` | `port` | `predicate` | `error-branch-default`). Every condition also carries `hasPredicate` and `closedByErrorPort`, so "predicate" and "error port closes this edge" remain orthogonal. The shape is versioned (`schemaVersion: 1`) and stable across `JSON.stringify` / `JSON.parse`.
- **Conditional edges without leaking functions** — a predicate is a function and therefore cannot enter JSON; the projection marks `condition.hasPredicate: true`, while a named output port is exposed verbatim (`condition.kind: 'port'`, `condition.port`). A default edge out of an `errorBranch` node keeps `kind: 'error-branch-default'` with `closedByErrorPort: true` even when it also declares a predicate, so the error-branch semantics are not lost. Predicate text is never evaluated by this package.
- **Layout is caller-owned** — `CanvasFlow.layout` exists but is empty (`{ viewport: null, nodes: {}, edges: {} }`), and every node/edge has a `layout: null` slot. Fill it on the caller side; the kernel stores no layout and this package never invents coordinates.
- **Runtime projection, hydratable at any time** — `watch(handle)` works while the run is pending, mid-flight or already finished. At attach time it reads the engine's `FlowRunDetail.nodes` (the read-only live-state surface) and seeds each node with its real current status (`completed`/`running`/`pending`/...), so opening a panel mid-run never shows a completed node as `pending`. Afterwards it consumes `flow/node-status`; late events are rank-checked and terminal states absorb, so `completed → pending` cannot happen. No polling and no log reading.
- **errorBranch failures stay visible** — an `errorBranch` node still ends `completed` and its default port still closes, but its record/status event carries `recovered: { code, message }`, so a canvas can mark "failed, then recovered" without changing completion or port behavior.
- **Waiting for approval is a projected state** — the flow layer adds `awaiting-approval` to `pending/ready/running/...`; a node's `approvals` carries the request (tool, bounded summary, reason, time) and the outcome (allow/deny, actor, time, via). While suspended, `CanvasNodeRuntime.status` is `awaiting-approval`; after the decision it returns to `running` and the audit survives into the final result.
- **Final snapshot matches `FlowRunResult`** — `projection.finished` resolves to `CanvasRunSnapshot` whose `result` is the exact `FlowRunResult` returned by `handle.awaitCompletion()`, and whose `nodes` are re-synced from that result so late subscribers cannot miss a settle. Watching an already-finished run seeds the final state synchronously, so `snapshot()` is consistent the moment `watch()` returns.
- **Clean teardown** — the projection removes its `flow/node-status` and `flow/run-end` listeners when the run ends; `dispose()` is idempotent and only stops the subscription (it does not cancel the run).
- **`getFlow` / `getRun` on the engine** — the canvas service reads the registered definition through `FlowEngine.getFlow(flowId)` and the live node states through `FlowEngine.getRun(runId).nodes`; unknown ids fail with `CANVAS_FLOW_NOT_FOUND`, and non-JSON configs fail with `CANVAS_NOT_SERIALIZABLE`.

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

// 面板在运行中才打开：仍然立即拿到真实状态，而不是全 pending
// The panel opens mid-run: it still hydrates real states immediately, never all pending.
const reopened = view.watch(live.handle);
console.log(reopened.snapshot().nodes);
```

## Demo

The runnable demo loads `examples/demo.flow.yaml` through the real YAML Loader, prints the canvas JSON, then prints the per-node status stream of one run:

```bash
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas demo
```

It shows one run containing an `error` port condition (`gate → recover`), a recovered errorBranch failure (`gate`, `recovered: NODE_FAILED`), a skipped default branch (`normal`, `upstream-condition`), a failed node (`fatal`, `NODE_FAILED`) and a skipped downstream (`join`, `upstream-failure`).

## Contract notes

- `watch(handle)` can be called at any time. It synchronously hydrates from `engine.getRun(runId)`: a finished run uses the final result, a live run uses `FlowRunDetail.nodes`; `snapshot()` is consistent the moment `watch()` returns. Use `run()` when you want start + subscribe in one call.
- After hydration, status events are monotonic: terminal states absorb, and a lower-rank event (`pending`/`ready` after `running`) is ignored. The final `snapshot.nodes` is rebuilt from `FlowRunResult`, so it is authoritative even if a status event was missed.
- Absent optional node fields are omitted (no `error: undefined` own property); decide by value, not by key presence.
- `flow/node-status` is an engine event; no flow layer status is written to storage or logs by this package.

## What the UI still owns

This package deliberately stops at data. A UI still needs to decide:

- **Layout** — coordinates, auto-layout policy and viewport; `CanvasFlow.layout` / node/edge layout slots are empty for the caller.
- **Rendering** — node shapes, port anchors, edge routing, zoom/pan and hit testing.
- **View state** — selection, hover, editing drafts and persistence; none of that lives here.
- **Predicate presentation** — only `hasPredicate` and a summary are available; the UI cannot show predicate expression text or evaluate it.
- **Recovered styling** — map `CanvasNodeRuntime.recovered` to a badge/outline if the design wants to distinguish "failed then recovered" from clean success.
- **Theming, i18n and accessibility** — all UI-side concerns.

## Non-goals (phase 2)

- No browser UI, renderer, layout algorithm or frontend dependency. This package only produces data.
- No layout persistence: coordinates never enter the kernel or the engine.
- No expression evaluation: predicates are reported, not interpreted.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
