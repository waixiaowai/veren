# @veren/graph-tools

Registers the model-facing tools that drive the flow engine: `graph_list`, `graph_run` and `graph_status`. Use it when an agent must enumerate registered workflows, start one by name and read a run's state without a bespoke client. Skip it when flows are started by host code, a schedule, or another trigger.

## What it provides

- **`graph_list`** — no parameters; returns every flow registered in the engine (`id`, node/edge counts, declared output names), so the model learns the names `graph_run` accepts.
- **`graph_run`** — parameters `name` (a flow id) and optional `input` (JSON object, validated by the flow Start signature). Starts the run, waits up to `runTimeoutMs`, and returns `flowId`, `runId`, `status`, resolved `output`, per-node statuses and the structured error. When the budget expires it returns `status: "running"` and the run keeps going.
- **`graph_status`** — parameter `runId`; returns the same payload for one run: status while running, output and node records once finished.
- **Fails loud** — an unknown flow (`GRAPH_FLOW_NOT_FOUND`, naming the available ids), an unknown run (`GRAPH_RUN_NOT_FOUND`, naming recent run ids) and a non-object `input` (`GRAPH_INPUT_INVALID`) become ordinary tool failures instead of guesses.
- **Capability consumer only** — reads the `FlowEngine` service; no storage, kernel or filesystem access of its own. Every registration goes through `ctx.effect` and unregisters in reverse order with the fiber.

## Usage

```yaml
- name: "@veren/graph-tools"
  config:
    runTimeoutMs: 60000
```

Config: `runTimeoutMs` (default 60 000 ms) bounds only how long `graph_run` waits; the run itself is not cancelled by the budget.

The plugin injects two capabilities, so both must be mounted first: the DSH tool registry (`ctx.tools`, from `@deepseek-ai/dsh-tools`) and the flow engine (`graphFlowEngine`, from `@veren/graph-flow-engine`). Flows to run come from `@veren/graph-flow-yaml` (YAML files) or from host code calling `registerFlow`.

## Non-goals

No trigger for flows that must start on their own (the engine's `flow/run-starting` event is that seam); no flow authoring or editing tools; no explicit cancel tool (`graph_run` only cancels the run it started when its own call is aborted); no client UI.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
