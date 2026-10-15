# @veren/graph-node-tool

The generic **tool node**: every tool already registered in the DSH tool registry (`ctx.tools` — bash, pwsh, fs, web, …) becomes a flow node type. Use it when a flow should reuse DSH's registered tools — with their sandbox confinement, platform shell selection (mac/win/linux), env handling, timeouts and approval policies — instead of reimplementing execution. Skip it for the built-in test fixtures (`noop`/`fail`/`echo`/`subflow` of `@veren/graph-flow-engine`).

## What it provides

- **`tool` node type** (version 1) — config `{ tool: <registered name> }`; the node's resolved input mapping becomes the tool's `arguments`.
- **Full tools pipeline reuse** — calls run through `ctx.tools.execute(...)`: `tools/pre-execute` → guards → around-dispatch (timeout wrappers) → tool body → `tools/post-execute`. Sandbox confinement and cross-platform behavior come from the loaded DSH tool/sandbox backend plugins, not from this package.
- **Cancellation** — the node's `AbortSignal` is forwarded as the call's signal; engine-level cancel propagates into the running tool.
- **Structured results** — a success's canonical JSON `value` is spread into blackboard slots (objects key-by-key; scalars/arrays land in `out`); failures throw with the tool's stable `info.code` (fallback `TOOL_FAILED`), which flows through `retry`/`onError` and surfaces in `FlowRunResult.error.code`.
- **`ToolsToken`** — the `'tools'` service name as a token, so tests and light assemblies can provide a stand-in capability; real assemblies simply load `@deepseek-ai/dsh-tools` plus the tool plugins they need.

## Usage

```yaml
id: ci
nodes:
  - id: run-tests
    type: tool
    config: { tool: bash }
    input: { command: "pnpm test" }   # → tool arguments
    retry: { tries: 2 }
edges: []
```

```ts
const ctx = new Context();
await ctx.plugin(kernelPlugin);
await ctx.plugin(flowEnginePlugin, {});
await ctx.plugin(nodeToolPlugin);        // inject: ['tools'] — dsh-tools must be loaded first
```

## Non-goals (phase 2)

No tool discovery surface (`ctx.tools.schemas()` is available to consumers directly); no per-call approval UX — approval-gated tools degrade to denial in agent-less flow runs by design (fail-closed); no result-content projection beyond the canonical value.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
