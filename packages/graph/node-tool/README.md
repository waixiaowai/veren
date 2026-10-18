# @deepseek-ai/dsh-graph-node-tool

The generic **tool node**: every tool already registered in the DSH tool registry (`ctx.tools` — bash, pwsh, fs, web, …) becomes a flow node type. Use it when a flow should reuse DSH's registered tools — with their sandbox confinement, platform shell selection (mac/win/linux), env handling, timeouts and approval policies — instead of reimplementing execution. Skip it for the built-in test fixtures (`noop`/`fail`/`echo`/`subflow` of `@deepseek-ai/dsh-graph-flow-engine`).

## What it provides

- **`tool` node type** (version 1) — config `{ tool: <registered name> }`; the node's resolved input mapping becomes the tool's `arguments`.
- **Full tools pipeline reuse** — calls run through `ctx.tools.execute(...)`: `tools/pre-execute` → guards → around-dispatch (timeout wrappers) → tool body → `tools/post-execute`. Sandbox confinement and cross-platform behavior come from the loaded DSH tool/sandbox backend plugins, not from this package.
- **Suspend instead of failing closed when approval is needed** — two paths sharing the flow-layer approval face:
  1. **Pipeline `ask`**: a prepended `tools/pre-execute` listener reads the `ask` produced by downstream policy and turns it into the question shown on the node's approval card; non-flow calls (an agent's tool call) pass through untouched.
  2. **Explicit `approval.require`**: the node config requires an approval before the call even when the pipeline raises no `ask` policy.
  A request really suspends the node and everything downstream: the run stays `running`, the node enters `awaiting-approval`, and the canvas renders the card. Allow → the tool runs and the node completes; deny → the node fails with `NODE_PERMISSION_DENIED` and the existing `retry`/`onError` policy applies.
- **Cancellation** — the handler derives the call signal from the node's `AbortSignal`: an external cancel aborts the running tool and withdraws a pending approval, while a fail-fast notice does not, so a tool sibling finishes naturally and stays `completed`.
- **Structured results** — a success's canonical JSON `value` is spread into blackboard slots (objects key-by-key; scalars/arrays land in `out`); failures throw with the tool's stable `info.code` (fallback `TOOL_FAILED`), which flows through `retry`/`onError` and surfaces in `FlowRunResult.error.code`.
- **`ToolsToken`** — removed by design: the node reads `ctx.tools` directly (type-safe via the dsh-tools declaration merge); tests provide a stand-in under the same `'tools'` service name.

## Usage

```yaml
id: ci
nodes:
  - id: run-tests
    type: tool
    config: { tool: bash }
    input: { command: "pnpm test" }   # → tool arguments
    retry: { tries: 2 }

  # Explicit approval: suspend for a human even though bash raises no ask policy.
  - id: publish
    type: tool
    config:
      tool: bash
      approval:
        require: true
        reason: "publishing writes outside the workspace"
        timeoutMs: 120000              # optional; 0 = no timeout
    input: { command: "pnpm publish" }
edges:
  - { from: run-tests, to: publish }
```

```ts
const ctx = new Context();
await ctx.plugin(kernelPlugin);
await ctx.plugin(flowEnginePlugin, {});
await ctx.plugin(approvalPlugin, { timeoutMs: 60_000 }); // provides graphFlowApproval
await ctx.plugin(nodeToolPlugin);        // inject: ['tools'] — dsh-tools must be loaded first
```

## Approval security boundary

- **Single use**: an answer consumes the current request; a second answer for the same request id always fails (`flow-canvas/approval-not-found` on the canvas).
- **Run- and attempt-scoped**: the request records `flowId`/`runId`/`nodeId`/`attempt`, and an answer must carry the same `runId`, so concurrent runs/nodes never cross.
- **No global grant**: an approval never writes a permission preset, sandbox mode, or approval policy; it decides only this one tool call.
- **Auto-deny on timeout**: `@deepseek-ai/dsh-graph-flow-approval`'s `timeoutMs` decides (60 s by default) and the node config can override it; the node execution timeout is paused while waiting, so the wait is not cut short by `nodeTimeoutMs`.
- **Cancel withdraws**: cancelling the run withdraws the pending request (`via: 'cancel'`) and the node settles `cancelled`.
- **Minimum audit**: each approval records the request (tool, bounded argument summary, reason, time) and its outcome (allow/deny, actor, time, via). Denial and timeout are the stable codes `NODE_PERMISSION_DENIED` and `NODE_APPROVAL_TIMEOUT`; a missing channel is `NODE_APPROVAL_UNAVAILABLE`.

## Relation to DSH's existing approval

The detection reuses the tools pipeline's `tools/pre-execute` waterfall and `PreToolDecision`'s `ask` vocabulary; no tool-layer approval protocol is added. DSH's `ApprovalService.request` requires a real `Agent`, an open turn and a session audit log, which an agent-less flow run started from the canvas does not have — that is exactly why the old behavior failed closed. The flow layer therefore carries the request/answer in `@deepseek-ai/dsh-graph-flow-approval` and translates the outcome back into the existing `allow`/`deny` decision. Without that service mounted the call is still denied (`NODE_APPROVAL_UNAVAILABLE`), so the fail-closed semantics stay intact.

## Non-goals (phase 2)

No tool discovery surface (`ctx.tools.schemas()` is available to consumers directly); no long-lived or cross-run grant (an approval is always single-use); no result-content projection beyond the canonical value; no harness-core approval protocol change.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
