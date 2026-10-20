# @veren/app-registry

## What this is

Host-level application registry plugin for DSH: applications are the user-facing product unit (stable id, entry page, tool prefix, capabilities, task channel) implemented by plugins. Use it when a plugin should appear as an installable "application" with pages and tasks; skip it for plain capability plugins.

## Status

Phase 1 implemented. Host service `ctx.apps` (`inject: ['apps']`) provides `register(definition, ownerContext?) → disposer`, `get(id)`, `catalog()`, and the app-scoped registrars `pages(id, caller?)` / `tools(id, caller?)` — both validate fiber ownership (only the registering plugin's own context may use them). Apps bind to the registering fiber: disposing it removes the whole app (pages + tools), idempotently. Tool exports are `<toolPrefix>__<localName>`; `toolPrefix` defaults from the id and is globally unique. Tool definitions are DSH `ToolDefinition`s produced by `defineTool` (`@deepseek-ai/dsh-tools`) — the catalog is not a second tool type. App-side metadata (e.g. `requires` capabilities) rides `tools(id, caller?).define(tool, meta)`; recorded, not enforced, in phase 1. Bootstrap tools `app_list` / `app_pages` are built by `createBootstrapTools(service)` (`app_open` belongs to the page-registry plugin). Frozen contracts live in `src/types.ts`; do not change them without reporting.

## Commands

```bash
pnpm --filter @veren/app-registry typecheck
pnpm --filter @veren/app-registry test
```

中文文档见 [README.cn.md](./README.cn.md)。
