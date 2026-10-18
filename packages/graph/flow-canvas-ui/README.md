# @deepseek-ai/dsh-graph-flow-canvas-ui

A first-version, **read-only browser canvas** for a registered flow. It is a
standalone local page: it loads the demo flow through the real YAML Loader,
projects it with `@deepseek-ai/dsh-graph-flow-canvas`, auto-layouts the DAG,
streams live node statuses over SSE, and shows a node's output from
`snapshot.result`.

Use it when a person needs to *see* what a flow does and where a run failed,
without opening an editor. Skip it when you need editing, drag-and-drop,
layout persistence, or a production flow designer. This is deliberately a
"first version that is readable", not an n8n.

![Finished demo run: failed at fatal, recovered at gate, skipped normal/join](./docs/run-final.png)

## What you get

- **One graph, laid out automatically** — nodes are grouped into left-to-right
  dependency layers, edges are Bézier paths, and the node card shows its type
  (`fail · errorBranch`, `echo`, `noop`, ...). No manual dragging.
- **Conditional edges are labelled** — `port: error` (named output port),
  `predicate`, and `default` / `closes on error` (the default output of an
  `errorBranch` node). Unconditional edges are intentionally unlabelled; the
  legend explains that.
- **Live run status without a refresh** — `pending → ready → running →
  completed | failed | skipped | cancelled` arrives over SSE. The running card
  pulses; failed cards are red; skipped cards are dashed and show their
  `skipReason`; an `errorBranch` node that failed but recovered is amber /
  dashed and says `completed · recovered`, not clean green.
- **A run digest** — the summary line names the first failed node and its error
  code, and counts completed / recovered / failed / skipped nodes. In the demo
  you can answer "where did it fail?" without opening anything.
- **Node output on click** — the inspector reads output from
  `snapshot.result.nodes[id].output` (never from the canvas runtime), shows the
  exact source path, and displays the full error / recovered / skip facts.
- **Read-only by construction** — the UI only reads projections and snapshots.
  Incremental changes are overlaid onto a **copy** of the snapshot; the
  received snapshot and its `result` are never mutated. The server never
  subscribes to kernel events directly; it only calls the public canvas API.

![Mid-run on the paced demo: gate is running, start completed](./docs/run-running.png)

## Run it

Requirements: Node.js 24+, pnpm 10+ (the versions this repository already
uses). The page binds `127.0.0.1` only.

```bash
pnpm install
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas-ui build
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas-ui start
```

Open **http://127.0.0.1:4780/**.

The server prints its exact URL on startup. To use another port:

```powershell
$env:FLOW_CANVAS_UI_PORT = '4780'
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas-ui start
```

Or run the built entry directly:

```bash
node packages/graph/flow-canvas-ui/lib/server.js
```

Stop it with `Ctrl+C`. The demo YAML is read from
`packages/graph/flow-canvas/examples/demo.flow.yaml`; no data is copied into
this package.

## The 30-second tour

1. **Look at the summary bar.** For the demo it says
   `运行失败 · fatal (NODE_FAILED)` and lists
   `3 completed (1 recovered) · 1 failed · 2 skipped`.
2. **Look at the graph.**
   - `fatal` is red with `NODE_FAILED: demo fatal failure`.
   - `gate` is amber, dashed and says `completed · recovered` — it failed, but
     the `error` port caught the failure. That is deliberately different from
     the green `completed` cards.
   - `normal` is skipped with `skip: upstream-condition`; `join` is skipped
     with `skip: upstream-failure`.
   - The `gate → recover` edge is labelled `port: error`; the
     `gate → normal` edge is labelled `default / closes on error`.
3. **Click any node.** The inspector shows its status, duration, policy, error
   or recovered fact, and its output JSON when the run has finished. For a
   failed node it says why no output exists instead of inventing one. Clicking
   `gate` shows the recovered callout and `snapshot.result.nodes["gate"].output`.

   ![Recovered gate: "failed then recovered" and its output](./docs/run-recovered.png)
4. **Press Run again.** The Status stream panel below the canvas fills with each
   transition, timestamped; the page does not refresh.

Initial page, before a run:

![Idle page with the demo graph and legend](./docs/run-idle.png)

## Demo flows

The server registers three page entries:

| Flow | What it is |
|---|---|
| `canvas-demo` | The canonical `examples/demo.flow.yaml`, loaded through the real YAML Loader. It completes almost instantly. |
| `canvas-demo-pacing` | The **same graph and statuses**, with `retry: { tries: 3, backoffMs: 240 }` on the two `fail` nodes so the `running` state stays visible for about half a second. This is real engine retry behaviour, not replayed or delayed events. |
| `canvas-demo-predicate` | The same graph with one always-true predicate on `recover → fatal`, so the `predicate` edge label is visible on the canvas (YAML cannot carry function predicates). Run behaviour is unchanged. |

The paced flow is a separate entry on purpose: the canonical fixture stays
canonical, and the UI does not fake timestamps or sleep between events. The
predicate entry exists only to make the third condition flavour visible; the
graph and run behaviour are the canonical ones.

![Predicate demo: the orange predicate label on recover → fatal](./docs/run-predicate.png)

## Data contract (the two rules the UI follows)

1. **Output comes from `snapshot.result.nodes[id].output`.**
   `snapshot.nodes[id]` is the canvas runtime: status, timestamps, `error`,
   `recovered`, `skipReason` — no `output`. The inspector and tests both assert
   this. Missing output is explained (`no-run`, `running`, `missing-node`,
   `no-output`), not treated as `{}`.
2. **Snapshots and results are read-only.** The canvas projection returns a
   shallow copy; nested objects and `result` itself are shared with the engine.
   The UI never writes into them. Live deltas are layered with
   `withLiveChanges()` onto a new snapshot object; the original stays intact.

Additional edges of the contract:

- Layout is computed in the browser (`layout.ts`); it is never written back to
  the kernel, storage or the projection. The projection's layout slots stay
  empty.
- The server composes the data plane (`graph-core → flow-engine → flow-yaml →
  flow-canvas`) and reads only `project`, `run`, `snapshot()` and
  `finished`. It does not listen to `flow/node-status` or any kernel event.
- Predicate text is unavailable by data-plane design; the edge is labelled
  `predicate` and its tooltip uses the projection's human-readable summary.

## Tests and verification

```bash
# The new UI package (25 specs)
pnpm --filter @deepseek-ai/dsh-graph-flow-canvas-ui test

# All graph packages (104 old + 25 new = 129 specs)
pnpm -r --no-bail --filter "./packages/graph/*" test

# All 9 graph packages compile
pnpm -r --filter "./packages/graph/*" build
```

What the new specs cover:

- every status → palette / marker / class, and the recovered-vs-clean
  difference;
- every edge condition → label / dashed / tooltip;
- the output contract, including "canvas runtime output is ignored", falsy
  outputs, and all unavailable reasons;
- the read-only overlay (original snapshot unchanged, `result` reference
  preserved);
- automatic layout: dependency order, no overlapping cards, labels outside
  cards, parallel-edge offsets, determinism;
- a real HTTP run against the real Loader/engine/canvas: final statuses,
  `gate.recovered`, `normal.skipReason`, the SSE stream, and output only on
  `result.nodes`.

## Files

| File | Responsibility |
|---|---|
| `src/server.ts` | HTTP routes, static files, JSON/SSE endpoints, startup guard. |
| `src/runtime.ts` | Real data-plane composition and the three demo-flow registrations. |
| `src/runs.ts` | Server-side run registry and SSE transport. |
| `src/model.ts` | Pure mappings: status visuals, edge labels, output contract, API types. |
| `src/summary.ts` | Run digest: headline, detail and failed/skipped/recovered lists. |
| `src/layout.ts` | Pure layered DAG layout and edge routing. |
| `src/graph.ts` | SVG edges, node cards and condition labels. |
| `src/panels.ts` | Toolbar, run summary, inspector, event stream and legend. |
| `src/client.ts` | Browser state, SSE consumption and run actions. |
| `src/dom.ts` | Tiny DOM/SVG/time helpers. |
| `public/index.html`, `public/styles.css` | Page shell, legend, theme and status palette. |
| `tests/model.spec.ts`, `tests/layout.spec.ts`, `tests/server.spec.ts` | Mapping, layout and real-server specs. |

No existing graph package was changed. The UI lives in its own package so the
104 old specs keep their previous meaning.

## Solved in this version vs. deferred

Solved: graph rendering, dependency ordering, condition edge labels, live
statuses, recovered distinction, skip reasons, run digest, node output,
read-only contract, repeat runs, error states, accessibility basics
(focusable nodes, `aria-live` summary, roles), reduced-motion handling.

Deferred: drag/drop and zoom/pan, layout persistence, cancellation button
(the run handle is already exposed), filters/search, editing, predicate text,
multiple user-selected YAML files, and the 3080 client-plugin integration.

## Next step: mount it inside the 3080 GUI

The page was kept standalone because the client-plugin path requires a Host
service plus a profile install, and this first version needed to prove the
read-only UI/data-plane contract without touching DSH or `~/.dsh`. The data
contract is already the one a plugin needs. The next step is:

1. **Host half** — add a small plugin (inside the DSH checkout or a separate
   package) that injects `FlowCanvasToken` and exposes a Remote namespace
   (for example `flowCanvas`) with four calls: `list()`, `project(flowId)`,
   `startRun(flowId)`, and `subscribe(runId)`. `subscribe` can forward the same
   SSE-shaped `{ snapshot, changes, finished }` messages used here; do not
   expose kernel events.
2. **Client half** — register a sidebar entry and a main panel with
   `ctx.slots.inject(...)` / `ctx.slots.register(...)`, declare the slot
   children exactly, register `zh`/`en` dictionaries through `ctx.locale`, and
   wrap the stream in a `HostObservable`. Reuse `model.ts` and `layout.ts`
   unchanged; only the transport and chrome change.
3. **Install/verify** — install the plugin into a test node
   (`DSH_HOME=~/.dsh_test_2`, never `~/.dsh`), then reload the existing URL.
   If client-plugin sources change, `pnpm run dev:web` must be running from the
   same checkout for HMR; otherwise rebuild the Web artifacts and verify after
   `Ctrl+R`. Do not start a second server for the GUI.

Until then, the standalone URL above is the supported way to look at the demo.

## License

MIT.
