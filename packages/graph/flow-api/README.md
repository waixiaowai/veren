# @veren/graph-flow-api

The minimal, type-only API of the flow semantic layer on top of the DAG kernel. Use it when you write a **flow node-type plugin** or need the flow vocabulary without any implementation: node plugins import types from this package and inject `NodeRegistryToken` only — they must never depend on the implementation package `@veren/graph-flow-engine`.

## What it provides

- **Branded ids** (zero runtime cost): `FlowId`, `RunId`, `NodeId`; `SlotRef` (`${nodeId.slot}` — the only expression in phase one).
- **`FlowDefinition`** — `id`, optional `input` schema (schemastery; the Start signature), `output` slot references (the End signature), `nodes`, `edges` (dependency order only, optional `port` for named output ports and `when` for conditions).
- **`FlowNodeDef`** — `type`, pinned `version`, `config`, explicit `input` mapping (slot refs or literals), `onError` (`failFast | fallback | errorBranch`), `fallbackValue`, `retry { tries, backoffMs }`, `timeout`.
- **`NodeHandler`** — `type`, `version`, `config` (schemastery schema), `execute(input, nctx)`; return named output slots (an object) — non-object returns land in `out`.
- **`NodeExecuteContext`** — node-scoped `ctx`, `flowId`, `runId`, `nodeId`, `attempt`, validated `config`, `blackboard`, `signal`.
- **`FlowBlackboard`** — read/write named slots; edges never carry values.
- **`NodeRegistry` + `NodeRegistryToken` + `registerNodeHandler(ctx, handler)`** — registration through `ctx.effect` so uninstalls clean up in reverse order (HMR-safe).

## Usage (a node-type plugin)

```ts
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { NodeRegistryToken, registerNodeHandler, type NodeHandler } from '@veren/graph-flow-api';

export const name = 'myUpperNode';
export const inject = [NodeRegistryToken] as const;

const handler: NodeHandler<{ upper: boolean }> = {
    type: 'upper',
    version: 1,
    config: z.object({ upper: z.boolean().default(true) }),
    execute: (input) => ({ out: String(input['text']).toUpperCase() }),
};

export const apply = (ctx: Context) => {
    registerNodeHandler(ctx, handler);
};
```

## Non-goals (phase 2)

Type declarations only — no registry/engine implementation, no triggers, no expression language beyond `${nodeId.slot}`, no client-side canvas types beyond the neutral model.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
