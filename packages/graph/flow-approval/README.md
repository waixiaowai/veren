# @deepseek-ai/dsh-graph-flow-approval

The flow-node approval service. Use it when a flow node must wait for a human before acting (a tool call, a publish, a write outside the workspace): it implements the approval seam of `@deepseek-ai/dsh-graph-flow-api`, so a request really suspends the run until an interface answers, the timeout fires, or the run cancels. Do not mount it for unattended flows that should keep failing closed.

## What it provides

- **The `FlowApprovalBroker` capability** (`graphFlowApproval`): `open(input, context)` registers a request and returns the suspended promise; `answer(requestId, { runId, decision, actor })` answers it; `pending()` snapshots the open requests. The engine exposes `open` as each node attempt's `nctx.approval`, and canvases call `answer` through a Remote endpoint.
- **Real suspension**: the promise returned by `open` does not settle before an answer; the node therefore stays `awaiting-approval`, downstream nodes are not scheduled, and the run stays `running`.
- **Single-use and run-scoped**: a request id is consumed once; `answer` requires the same `runId`, and an unknown, answered, or cross-run answer returns `false`. An approval writes no global policy.
- **Configurable timeout**: service-level `timeoutMs` (60 000 by default; 0 = no timeout) with a per-request override; the timeout denies with `via: 'timeout'`.
- **Cancel withdraws**: cancelling the run settles the request as `via: 'cancel'`; a late answer is refused.
- **Minimum audit**: the request carries `flowId`/`runId`/`nodeId`/`attempt`/`kind`/`action`/`reason`/`summary`/`requestedAt`/`expiresAt`; the outcome carries `decision`/`via`/`decidedBy`/`decidedAt`.
- **Events**: `flow/approval-requested` (pending) and `flow/approval-decided` (settled), both `@mode emit`; the engine updates node status and audit from them, and a canvas renders/removes the card from them.

## Usage

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as approval } from '@deepseek-ai/dsh-graph-flow-approval';
import { FlowApprovalToken } from '@deepseek-ai/dsh-graph-flow-api';

const ctx = new Context();
await ctx.plugin(approval, { timeoutMs: 60_000 });
const broker = ctx.get(FlowApprovalToken)!;

const outcome = await broker.open(
    { kind: 'tool', action: 'bash', reason: 'publishes artifacts', summary: '{"command":"pnpm publish"}' },
    { flowId, runId, nodeId, attempt: 1, signal },
);
// outcome: { decision: 'allow' | 'deny', via: 'user' | 'timeout' | 'cancel' | 'unavailable', decidedBy?, decidedAt }
```

A node handler usually does not depend on this package directly: the engine already wraps `open` as `NodeExecuteContext.approval`, so the handler calls `nctx.approval.request(...)`.

## Non-goals

No UI (the canvas renders the card in `@deepseek-ai/dsh-graph-flow-canvas-panel`), no policy decision (whether approval is needed belongs to the tools pipeline or the node config), no persisted approval history (the audit lives on `FlowNodeRecord.approvals` and in the events), and no change to DSH's `ApprovalService` or permission presets.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
