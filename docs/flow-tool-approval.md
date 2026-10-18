# Flow tool-node approval: suspend, card, allow

This page records the current state, implementation and verification of **flow node approval** in the `graph` plugin family. Audience: maintainers of `packages/graph/*` and deployments of the graph bundle.

## Before / now / proof

**Before**: a `tool` node runs through `ctx.tools.execute` and the full tools pipeline. The pipeline's `ask` decision is finally resolved by `ApprovalService.request`, which requires a real `Agent`, an open turn and a session audit log. A flow run started from the canvas has no agent, so `serviceAsk` denied immediately — the `node-tool` README documented that as a deliberate fail-closed design.

**Now**: when approval is needed, the run **really suspends** at that node:

1. The node enters the distinguishable `awaiting-approval` state (a flow-layer state; the kernel still sees `running`), downstream nodes are not scheduled, and the run stays `running`;
2. The canvas renders an approval card on the node: tool/action, key arguments, why, request and deadline times, **Allow** and **Deny**;
3. Allow → the tool runs, the node completes, the flow continues; deny → the node fails with `NODE_PERMISSION_DENIED` (timeout: `NODE_APPROVAL_TIMEOUT`) and the existing `retry`/`onError` policy applies;
4. A grant covers **only this one call of this run**; the timeout auto-denies; cancelling the run withdraws the wait;
5. The card is an extension of node rendering: the built-in default card carries it, and a third party can implement its own via the `flow.canvas.node` owner props (`pendingApproval` / `approvals` / `onApprovalDecision`) or the exported `NodeApprovalCard`.

**Proof**:

- `pnpm -r --filter "./packages/graph/*" test` → 12 packages green, **208 specs** (all 161 pre-existing specs still pass; 47 new).
- Real clicks in the one-off isolated node `C:\Users\imeep\.dsh_test_flow_approval` (port 3097; bundle + panel 0.1.10 + a test-only fixture): explicit require → allow, pipeline `ask` → deny, 5 s timeout, cancel while suspended. Screenshots in `packages/graph/flow-canvas-panel/docs/approval-*.png`. The node was removed afterwards; 3080 was never touched.

## Architecture (what was reused, what is new)

```
node handler ──nctx.approval.request()──▶ flow-approval (graphFlowApproval)
      ▲                                        │ suspend / timeout / cancel / single-use answer
      │                                        ▼
node-tool ──tools/pre-execute (prepend)──▶ the existing ask decision
      │                                        │
      └────────── approval question ◀── flow/approval-* events ──▶ flow-engine (awaiting + audit)
                                                                  │
                                             flow-canvas projection ────┘
                                                                  │
                                        flow-canvas-panel Remote `answer` / `cancel`
```

- **Reuse 1: the tools pipeline.** The `ask` decision comes entirely from the existing `tools/pre-execute` waterfall and `PreToolDecision`'s `ask` vocabulary; `node-tool` prepends a listener, reads the final downstream decision, turns `ask` into a node question, and translates the human answer back into the existing `allow`/`deny`. **No tool-layer approval protocol was added.**
- **Reuse 2: DSH approval semantics.** Single-use `allowed-once`, per-action scope, timeout/cancel and who/when audit match DSH's `ApprovalService`; only the carrier moved to the flow layer.
- **New 1: `@deepseek-ai/dsh-graph-flow-approval`.** The `FlowApprovalBroker` implementation: `open`/`answer`/`pending`, configurable timeout, cancel withdrawal, single-use answers, `flow/approval-requested` and `flow/approval-decided`.
- **New 2: the flow-api approval seam.** `FlowApprovalRequest/Outcome/Audit`, `FlowNodeApprovalPort`, `FlowApprovalBroker`, `FlowApprovalToken`; `NodeExecuteContext.approval` lets **any node type** request approval, not only `tool`.
- **New 3: a flow-layer suspended state and audit.** `FlowNodeStatus = GraphNodeStatus | 'awaiting-approval'`; `FlowNodeRecord.approvals` holds requests and outcomes; the node execution timeout pauses during the wait so waiting for a human is not cut short by `nodeTimeoutMs`.
- **New 4: canvas card and answer endpoints.** `flowCanvas/answer` and `flowCanvas/cancel`; the card renders under the node; the node keeps the minimum audit and the inspector lists every record.
- **New 5: two triggers in `node-tool`.** The pipeline `ask` is intercepted automatically; `config.approval.require` gives an explicit per-node requirement (`reason`, `timeoutMs`).

## Why not call `ApprovalService` directly

`ApprovalService.request` requires a real `Agent` and an **open turn** (the audit pair must be turn-enclosed, otherwise it is crash-tail garbage on reload). An agent-less flow run has no session and no turn; faking an Agent/Session would write the audit into the wrong session and change DSH core semantics. Therefore:

- **No file under `deepseek/deepseek-harness` was modified** by this work (the harness `git status` entries predate this task).
- The flow layer uses the same `PreToolDecision` vocabulary and the same single-use semantics, but owns the request/answer and audit. Without `flow-approval` mounted, `approval.request` returns `via: 'unavailable'` and the call is denied (`NODE_APPROVAL_UNAVAILABLE`): fail-closed is never relaxed.

## Security boundary

| Boundary | Implementation |
|---|---|
| Scope | Every `open` mints a unique request id; `answer` must carry the same `runId`; an answered request is removed immediately. No permission preset / sandbox mode / approval policy is written. |
| Concurrency | Requests are keyed by `(runId, nodeId, attempt, id)`; the node matches in-flight tool calls by their exact call signal. Two runs, two nodes, or two concurrent requests of one node never cross. |
| Timeout | Service default `timeoutMs: 60000` (0 = none), overridable per node `approval.timeoutMs`; the timeout denies with `via:'timeout'`. The node execution timeout is paused while waiting. |
| Cancel | Cancelling the run withdraws the request with `via:'cancel'`; the node settles `cancelled`; a late answer returns `false` (`flow-canvas/approval-not-found` on the canvas). |
| Minimum audit | Request: `flowId/runId/nodeId/attempt/kind/action/reason/summary/requestedAt/expiresAt`; outcome: `decision/via/decidedBy/decidedAt`. The audit is persisted with the run result and survives a reload. |
| Unload | Unloading flow-approval withdraws every pending request; the per-node timeout listeners are removed once the node settles (asserted by a spec). |
| UI extension | Owner props are plain data plus a callback; a third-party renderer can replace the whole card and still use the same Remote `answer` path. |

## Behavior details

- **Status sequence while waiting**: `pending → ready → running → awaiting-approval → running → completed` (deny/timeout → `failed`). The canvas projection ranks `awaiting-approval` with `running`, so returning to `running` is allowed; terminal states still absorb late events.
- **Multiple concurrent requests on one node**: all enter `approvals`; the node stays `awaiting-approval` while any request is open (spec).
- **fail-fast**: failure propagation withdraws a pending approval (the run has already failed, so waiting for a decision that cannot change the outcome is pointless) and the node settles failed. This differs from the existing "running siblings still finish" rule because an approval wait is not work that can finish on its own. The audit records `via: 'cancel'`, sharing the "withdrawn by the run cancel" copy with an explicit cancel.
- **Retries**: each attempt asks again; the audit accumulates in order and the card shows the last open request.
- **Persistence**: `FlowRunResult.nodes[id].approvals` is stored with the run; the isolated node verified all four outcomes in `storages/graph_flow.json`.

## Verification matrix

| Scenario | Spec | GUI |
|---|---|---|
| Suspend + allow + complete + audit | engine / node-tool / canvas / panel | `approval-card.png`, `approval-approved.png` |
| Pipeline `ask` intercepted | node-tool gate + real-event composition | `approval-ask-policy.png` |
| Deny → `NODE_PERMISSION_DENIED`, downstream skipped | engine / node-tool | `approval-denied.png` |
| Timeout → `NODE_APPROVAL_TIMEOUT` | flow-approval / engine / node-tool | `approval-timeout.png` |
| Cancel → withdraw + `cancelled` | flow-approval / engine / node-tool / canvas | `approval-cancelled.png` |
| Concurrent isolation | flow-approval / engine / node-tool | — |
| Single-use / cross-run refusal | flow-approval | — |
| Audit fields | flow-approval / engine / panel model | node + inspector in the screenshots |
| Third-party renderer request/answer | panel jsdom | — |
| Unload cleanup | flow-approval / engine | — |

## One line

**A single person can now watch it get stuck on the canvas and click once to let it through.**
