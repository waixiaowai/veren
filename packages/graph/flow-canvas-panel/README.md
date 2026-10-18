# @deepseek-ai/dsh-graph-flow-canvas-panel

A standard DSH client plugin that shows registered graph flows as a read-only,
clickable canvas in the Web GUI. It owns a full-space `main` panel and a sidebar
entry, exposes the canvas data source over the `flowCanvas` Remote namespace,
streams node statuses live, and opens a node's output from the public result
contract.

The plugin replaces the rejected standalone page
(`packages/graph/flow-canvas-ui`, port 4780) as the supported canvas surface.
The data plane keeps its public API; this release includes a lifecycle fix in
`graph-core`, `flow-engine` and `flow-canvas` so a Remote call's transient
Cordis context can no longer swallow `graph/node-status` events.

## Requirements

- A DSH Web profile with the graph bundle (`@deepseek-ai/dsh-graph-bundle`), so
  the `graphFlowCanvas`, `graphFlowEngine` and `graphFlowApproval` services
  exist. Install the bundle from this checkout so it carries the owner-context
  lifecycle fix and the approval service.
- A DSH checkout for building (`deepseek/deepseek-harness` next to this
  repository). The package builds with that checkout's `clientBundle` preset.

## Install into a profile

From the repository root, install the panel tarball into the target profile.
The profile must already carry this checkout's graph bundle (installed as a
directory dependency, because pnpm resolves the bundle's nested `file:` tarballs
relative to the profile root; do not install the bundle as a single tarball):

```powershell
$env:DSH_HOME = 'C:\path\to\your\test-node'   # never point this at ~/.dsh by accident
pnpm --dir packages/graph/flow-canvas-panel pack --pack-destination C:\temp\flow-canvas
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add C:\temp\flow-canvas\deepseek-ai-dsh-graph-flow-canvas-panel-0.1.12.tgz
```

The bundle directory lives at `packages/graph/bundle`; the isolated test node's
`profiles/web/pnpm-workspace.yaml` shows the exact overrides that pin its
tarballs (`graph-core`, `flow-engine`, `flow-canvas`, `@veren/core`,
`@veren/yaml-parser`, and the rest of the graph family).

Optional: install the demo renderer extension the same way.

```powershell
pnpm --dir packages/graph/flow-canvas-node-echo pack --pack-destination C:\temp\flow-canvas
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add C:\temp\flow-canvas\deepseek-ai-dsh-graph-flow-canvas-node-echo-0.1.4.tgz
```

Restart `dsh web` after installing. Open the Web GUI, then click **Flow 画布**
in the sidebar. The Host registers three real demo flows when they are absent
(`canvas-demo`, `canvas-demo-pacing`, `canvas-demo-predicate`) so a fresh profile
has something to draw; flows registered by the deployment appear in the same
selector.

For the user's live 3080 desktop profile, use `--profile desktop` and the same
`C:\Users\imeep\.dsh` home, but only after fully quitting the desktop app. The
graph bundle directory and its overrides must be present in that profile first;
this checkout never writes `~/.dsh` while the desktop process is running.

## What the panel does

- **Draws the projected graph** — left-to-right layered layout (the n8n / Dify /
  Coze convention), arrowed Bézier edges that leave a visible source port, short
  localized branch labels (`出错分支`, `默认分支`), and `184×72` cards with a type
  glyph, one status rail + status word, and one quiet secondary line. An edge
  whose target never ran is a muted dotted line; an error-branch default stays
  dashed. The full visual grammar is in
  [`docs/ui-cards.md`](docs/ui-cards.md).
  The canvas fills the panel: drag pans, the wheel zooms around the cursor, and
  the controls offer zoom out / reset / zoom in / **fit to screen**. Layout is
  browser-owned; the projection's layout slots stay empty.
- **Runs through the Host** — the Run button calls `flowCanvas/run`, then
  `flowCanvas/subscribe`; node statuses update live:
  `failed` red, `completed · recovered` amber, `skipped` grey with its reason,
  unfinished nodes muted. While running, Run is replaced by **Cancel run**.
- **Status that points at the next action** — a run pill plus an amber
  "N nodes awaiting approval" button and a red "N nodes failed" button; either
  opens the owning node. Completion counters stay quiet on the right.
- **Survives a full page reload** — the first mount loads the list automatically
  (retrying a warming connection), and the selected flow plus `runId` are kept in
  `sessionStorage`. After F5/Ctrl+R the panel re-subscribes to that run and its
  statuses continue from the Host projection; no second run is started. Multiple
  subscribers are independent: one stream ending never disposes the shared
  projection.
- **Opens node output** — clicking a node opens a right-hand inspector with the
  readable type, status, policy, retry/timeout, duration, error, approval audit
  and `snapshot.result.nodes[id].output`. The inspector also opens automatically
  for the node a pending approval belongs to. The canvas runtime record never
  carries output; missing output is explained, not invented.
- **Approval dock above the canvas** — when a tool node (or any node type calling
  `nctx.approval.request`) needs authorization, the node enters
  `awaiting-approval` and a full-width amber dock appears **above** the graph
  instead of covering it: tool/action, node, key arguments, why, request time,
  a live countdown to auto-deny, and two answers — a large primary **Allow** and
  a secondary **Deny**. After the answer the dock stays in place and reports the
  result (including who/when) until dismissed. Allow → the tool continues and
  the node completes; deny → `NODE_PERMISSION_DENIED`; timeout →
  `NODE_APPROVAL_TIMEOUT`; cancelling the run withdraws the wait.
- **Extends per node type** — the page declares the keyed
  `flow.canvas.node` slot and dispatches by `node.type` with the default card as
  fallback. Third-party plugins register a renderer by key; unloading falls
  back and is HMR-safe. Owner props include `pendingApproval`, `approvals` and
  `onApprovalDecision`, so a custom renderer can request/answer with its own UI;
  the panel also exports a reusable `NodeApprovalCard`.

## Extension example

```ts
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotMap declaration and owner-props type.
import type {} from '@deepseek-ai/dsh-graph-flow-canvas-panel/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('myNodes', {
    zh: { badge: '自定义' },
    en: { badge: 'custom' },
  }), 'my-nodes: dictionaries')
  ctx.slots.inject('flow.canvas.node', () => ctx.slots.register({
    name: 'flow.canvas.node',
    key: 'echo',                 // the node type this renderer claims
    locale: 'myNodes',
  }, MyNode))
}

function MyNode({ node, runtime, selected, onSelect, pendingApproval, onApprovalDecision, t }:
  PropsRuntime<'flow.canvas.node'> & PropsLocale<'myNodes'>) {
  return (
    <div>
      <button type="button" aria-pressed={selected} onClick={() => onSelect(node.id)}>
        {t('badge')} · {node.display.label} · {runtime?.status ?? 'pending'}
      </button>
      {pendingApproval === undefined ? null : (
        <button type="button" onClick={() => onApprovalDecision(pendingApproval.request.id, 'allow')}>
          allow {pendingApproval.request.action}
        </button>
      )}
    </div>
  )
}
```

`pendingApproval` is the open request, `approvals` is the complete audit including
outcomes, and `onApprovalDecision` goes through the same single-use, run-scoped
Remote path as the built-in card. A renderer with a wide surface (its own panel
or the inspector) can reuse
`import { NodeApprovalCard } from '@deepseek-ai/dsh-graph-flow-canvas-panel/client'`;
a `184×72` node card should use its own compact approval UI.

The companion package `@deepseek-ai/dsh-graph-flow-canvas-node-echo` is exactly
this plugin for the `echo` type and is used to test the extension point.

## Host surface

`src/index.ts` mounts a `TypertRemoteService` named `flowCanvasController` with
the namespace `flowCanvas`:

| Endpoint | Shape |
|---|---|
| `flowCanvas/list` | `{ flows: FlowSummary[] }` |
| `flowCanvas/project` | `CanvasFlow` for one registered flow |
| `flowCanvas/run` | `{ runId, flowId, snapshot }` |
| `flowCanvas/answer` | `{ runId, requestId, decision: 'allow' \| 'deny', actor? }` → `{ ok: true }` (single-use, run-scoped) |
| `flowCanvas/cancel` | `{ runId }` → `{ ok: true }` (withdraws a pending approval) |
| `flowCanvas/subscribe` | stream of `{ type: 'snapshot' \| 'change', ... }` |

The Host only calls the public canvas API (`project`, `run`, `snapshot`,
`subscribe`, `finished`), the engine's `listFlows`, and the approval service's
`answer`; it never forwards a kernel event. Run projections stay addressable by
`runId` so a reopened panel can subscribe mid-run.

## Non-goals

- No flow editing, drag/drop, multi-select, minimap, or layout persistence.
- No predicate expression text (the projection only exposes a summary).
- No run history; the cancel button targets only the current run.
- No long-lived or allow-all grant: each approval covers one call of one run.
- No per-deployment flow registration UI; deployments register flows through
  `FlowEngine.registerFlow` or the YAML loader as usual.
- The browser contribution is built by hand (like other out-of-tree plugins)
  because the Typert generator requires DSH workspace membership; the Host
  methods and wire codecs follow the generated shape.

## Verification

The current UI was exercised in the real Web GUI on a temporary isolated node
(own `DSH_HOME` and pnpm store, port 3099; removed after verification; 3080 was
never touched): graph bundle + panel 0.1.12 + echo 0.1.4 + the test-only
approval fixture. The layout round and its first-use assessment live in
[`docs/ui-refactor.md`](docs/ui-refactor.md); the node-card visual rules live in
[`docs/ui-cards.md`](docs/ui-cards.md). `docs/e2e-ui.mjs` drives headless Chrome
at 1440×900 through the operator path: zoom in → 100% → fit → drag-pan, select a
flow → run, watch the approval dock, allow it, inspect output, then reload while
an approval is still pending and finish the same run. It also captures the dark
theme. Run it with:

```powershell
node docs/e2e-ui.mjs <web-url> after docs/ui-card-after
```

The card `before` set is the previous 0.1.11 build on the same flows and
viewport (`docs/ui-card-before`, copied from the earlier `ui-after` set); the
layout before/after pair from 0.1.10 remains under `docs/ui-before` and
`docs/ui-after`.

| Before (0.1.11) | After (0.1.12) |
|---|---|
| ![Before: settled run](docs/ui-card-before/after-settled.png) | ![After: settled run](docs/ui-card-after/after-settled.png) |
| ![Before: approval card](docs/ui-card-before/after-approval-card.png) | ![After: approval dock](docs/ui-card-after/after-approval-card.png) |
| ![Before: node output](docs/ui-card-before/after-output.png) | ![After: node output](docs/ui-card-after/after-output.png) |
| ![Before: approved](docs/ui-card-before/after-approval-approved.png) | ![After: approved](docs/ui-card-after/after-approval-approved.png) |

Additional evidence: `docs/ui-card-after/after-zoom-100.png` (100% readability),
`after-zoom-in.png` (126%), `after-dark-settled.png` and `after-dark-approval.png`
(host dark theme), and `after-reload-resumed.png` (pending approval restored
after a full reload). The old `shot-*.png` and `approval-*.png` files are kept as
historical captures of the 0.1.10 UI.

## Tests

```powershell
pnpm --dir packages/graph/flow-canvas-panel test
pnpm --dir packages/graph/flow-canvas-node-echo test
pnpm --dir packages/graph/flow-canvas test
```

The panel suite covers status/edge mapping, viewport math (fit / cursor-anchored
zoom / ensure-visible), horizontal layout and label collision avoidance,
readable-name lookups, the attention queue, the output contract, store Remote
boundaries, cold-list retry, reload resume, multi-subscriber ownership, slot
registration and teardown, and jsdom end-to-end passes that mount the real slot
renderer, run the demo flow, auto-open the pending-approval inspector, answer
through the Remote API, read output, and prove the per-type renderer override
plus fallback. The card-specific assertions check one type glyph and one status
rail per default card, both ports on every edge, and the two dotted skipped
branches. `flow-canvas` adds a regression test that starts a run from a
transient child context and still sees live node events. The 12 graph packages
currently total 230 passing specs (panel 58, echo 2).
