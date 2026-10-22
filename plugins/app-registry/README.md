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

## Live pages

`pages(id, caller?).register(component, meta)` registers a component page (`PageFC` + `ComponentPageMeta`); putting an authoritative store (any `@veren/prompt-core` `ExternalStore<S>`, e.g. a plugin's own class with `getState` / `subscribe`) in `meta.store` marks the page a live view (§3.10.3): the adapter seals the store into a `PageLiveBinding` (`live.mount(params, scope?)`), so the page runtime mounts a store-subscribed view without ever seeing `S` — the component reads the store via `useSnapshot()`. The binding travels with the mirror into page-registry and with `listPageEntries(id)` — the host assembly's backfill — so a page registered before the assembly still becomes live. Pages registered without a store simply render their static body. There is no `register(page, { store })` form anymore (the sealed-store registration shape was removed with the block pipeline).

中文文档见 [README.cn.md](./README.cn.md)。
