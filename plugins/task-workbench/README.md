# @veren/task-workbench

The reference Veren **application**: it registers the `task-workbench` app (id, entry page, page set, tool catalog, task channel) on top of `@veren/app-registry`, `@veren/page-registry` and `@veren/prompt-page`. Use this package as the template for writing new Veren applications — not as a library.

[中文文档](./README.cn.md)

## What it registers

| Piece | Value |
| --- | --- |
| App id | `task-workbench` (tool prefix `task_workbench`) |
| Entry page | `list` → `/apps/task-workbench/list` |
| Pages | `/apps/task-workbench/list`, `/apps/task-workbench/task/:taskId`, `/apps/task-workbench/publish` |
| Tools | `task_workbench__take_task`, `__complete_task`, `__abandon_task`, `__publish_task` |
| Task channel | `ctx.taskCenter.send` when present; degrades to the local store otherwise |

Pages carry no preset. Each page declares `tools` (local names), `instructions` (a note to the model, not a system prompt), `instanceTitle` (e.g. `任务 #1` for `/task/:id`) and `pageRevision`.

## Tests

```bash
pnpm --filter @veren/task-workbench test
pnpm --filter @veren/task-workbench typecheck
```

## How to write a Veren application

A Veren app is a normal DSH plugin that performs four steps in `apply`:

1. **Register the app** — `ctx.apps.register({ id, name, description, entry, instructions?, toolPrefix? }, ctx)`. Pass your own fiber as the owner: when the plugin unloads, the whole app (pages + tools) is removed. `entry` is an app-internal page *key*, not a URL.
2. **Define the tool catalog** — get `const tools = ctx.apps.tools(id, ctx)` and register each tool with `tools.define(defineTool({...}), meta?)`. Tool bodies always come from `defineTool` in `@deepseek-ai/dsh-tools` (a DSH `ToolDefinition`: name/description/parameters/output/execute, with per-property parameter schemas and `required: true` for mandatory params). Local names are ≤24 chars and unique in-app; the registry exposes them as `<toolPrefix>__<localName>`. App-side metadata such as `requires: ['tasks:send']` goes in the second argument of `define` — the tool body stays a pure DSH shape (recorded, not enforced, in phase 1). Define tools **before** pages: a page's `tools` field is validated against this catalog.
3. **Define pages** — author each page with `defineAppPage` from `@veren/prompt-page` (URL must be `/apps/<appId>/...`), then `ctx.apps.pages(id, ctx).register(page)`. Never declare a `preset`; declare `tools`, `instructions`, `instanceTitle`, `pageRevision` instead. **Page registration is a single entry point**: app-registry mirrors every page into the page-registry URL index automatically (that is what makes `openUrl` resolve it); do not call `ctx.pageRegistry.registerAppPage` yourself (it is the internal primitive). A mirror failure rolls the registration back and throws — no "visible in the catalog but unresolvable" drift.
4. **Wire the task channel (optional)** — resolve `ctx.taskCenter` lazily and call `send(draft)` with a canonical target URL. If the task center is inactive, log the degradation and keep working locally; never fail activation over it.

Rules that make it an *app* rather than a plugin: ids and tool prefixes are globally unique and validated fail-loud; pages are namespaced under `/apps/<appId>/`; lifecycle is bound to your fiber (register disposers with `ctx.effect` in reverse-safe order); the user's preset choice is never touched.

See `docs/application-concept.cn.md` (§2–§4, §7.1, §8.1) for the design rationale.
