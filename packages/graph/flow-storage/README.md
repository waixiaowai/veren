# @deepseek-ai/dsh-graph-flow-storage

Persists flow definitions and run records through the dsh storage domain layer (`ctx.storage.domain` over the dsh storage hub — json/sqlite backends). Use it when flows and run history must survive process restarts and the flow engine should get its `FlowStorage` capability from a real medium. Skip it for in-memory or YAML-file-based flow loading (`@deepseek-ai/dsh-graph-flow-yaml`).

## What it provides

- **`graphFlowStorage` plugin** — opens the `graph_flow` domain (zod-validated records at the durable boundary; backend routing is decided by the storage-domain plugin's config) and provides the engine's `FlowStorageToken` capability; the domain closes with the fiber.
- **`flowDomain`** — the domain declaration: a `flows` table (definitions) and a `runs` table (run records).
- **`createDomainStorage` / `tablesOf`** — the `FlowStorage` implementation over the two tables, usable directly for tests (pass your own table doubles).

## Usage

```ts
import { Context } from '@deepseek-ai/cordis';
import { apply as kernel } from '@deepseek-ai/dsh-graph-core';
import { apply as engine } from '@deepseek-ai/dsh-graph-flow-engine';
import { apply as flowStorage } from '@deepseek-ai/dsh-graph-flow-storage';
// the storage stack must be mounted first:
// @deepseek-ai/dsh-storage (hub) + a backend (e.g. dsh-storage-json) + dsh-storage-domain

const ctx = new Context();
await ctx.plugin(kernel);
await ctx.plugin(flowStorage, { restoreFlows: false });
await ctx.plugin(engine, {}); // picks up FlowStorageToken when present
```

## Non-goals (phase 2)

No run-state subscriptions (use the engine's `flow/run-*` events today); no migration tooling beyond the domain layer's version checks; `restoreFlows` (re-registering persisted definitions at startup) is a reserved, not-yet-implemented option.

See [README.cn.md](./README.cn.md) for the Chinese documentation.
