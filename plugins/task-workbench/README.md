# @veren/task-workbench

The reference Veren **application**: it registers the `task-workbench` app (id, entry page, page set, tool catalog, task channel) on top of `@veren/app-registry`, `@veren/page-registry` and `@veren/prompt-page`. Use this package as the template for writing new Veren applications — not as a library.

[中文文档](./README.cn.md)

## What it registers

| Piece | Value |
| --- | --- |
| App id | `task-workbench` (tool prefix `task_workbench`) |
| Entry page | `list` → `/apps/task-workbench/list` |
| Pages | `/apps/task-workbench/list`, `/apps/task-workbench/task/:taskId`, `/apps/task-workbench/publish` |
| Tools | `task_workbench__take_task`, `__take_page_task`, `__complete_task`, `__abandon_task`, `__publish_task`, `__split_task` |
| Task channel | `ctx.taskCenter` (a declared hard inject, G13); publish/split failures propagate (fail loud) |

Pages carry no preset. Each page declares `instructions` (a note to the model, not a system prompt) and `instanceTitle` (e.g. `任务 #1` for `/task/:id`). The pages are **one-shot module-level components**: the body runs exactly once on the page session's real Agent — it registers the page's tools via `agent.ctx.tools.register` (full names, living and dying with the agent fiber) and reads the authoritative store directly (a synchronous in-memory face), so the PAGE block body is the store's state at open time. The page never renders again: later changes reach the model as tool-call results, not page refreshes.

The tool matrix follows the page archetypes (§3.10.1): the parametered `take_task` (an arbitrary id) sits on the list page — the browsing entry's intake duty; the detail page mounts `take_page_task`, a **page-scoped take with no parameters** that claims exactly the task the page instance is bound to (the url's `taskId`, resolved through the page-registry instance index) and, when a task-center record targets that page, takes its 30-minute lease too. That is what closes the delivery loop: a task delivered to a detail page can be claimed by that page's own session instead of dying as `failed/task-not-taken`.

## Tests

```bash
pnpm --filter @veren/task-workbench test
pnpm --filter @veren/task-workbench typecheck
```

## How to write a Veren application

A Veren app is a normal DSH plugin that performs these steps in `apply`:

1. **Declare dependencies (G13)** — service dependencies are explicit (`export const inject = ['apps', 'pageRegistry', 'taskCenter']`), and sibling capabilities are passed as explicit parameters. **Runtime probing is forbidden** (`ctx.get('…')`, `?.` capability checks, "absent → degrade" branches): on a live host the property guard attributes accesses to the accessed context's owner, so the access itself throws — that degrade channel never worked. If a layer truly needs to activate without the framework, the answer is G2's package split, not probing.
2. **Register the app** — `ctx.apps.register({ id, name, description, entry, instructions?, toolPrefix? }, ctx)`. Pass your own fiber as the owner: when the plugin unloads, the whole app (pages + tools) is removed. `entry` is an app-internal page *key*, not a URL.
3. **Prepare the tools** — build each tool with `defineTool` from `@deepseek-ai/dsh-tools` (a DSH `ToolDefinition`: name/description/parameters/output/execute, with per-property parameter schemas and `required: true` for mandatory params). Local names are ≤24 chars and unique in-app; prepare them under full names `<toolPrefix>__<localName>` and bind them into the pages' module slot (this package's `bindWorkbenchRuntime`). App-wide capability needs go on the app definition's `requires`. There is **no app tool catalog anymore**: the page bodies register their own tools in the one render.
4. **Define pages** — author each page as a module-level component (`PageFC`) with its `ComponentPageMeta` (URL must be `/apps/<appId>/...`), then `ctx.apps.pages(id, ctx).register(component, meta)`. The body runs exactly once on the page session's real Agent: it registers its tools via `agent.ctx.tools.register`, reads dependencies from the assembly-bound module slot, and returns the body. Async first-screen reads are the body's own lifecycle too — an `agent.ctx.effect` fetch, delivered as a followup message. Never declare a `preset`; declare `instructions`, `instanceTitle` instead. **Page registration is a single entry point**: app-registry mirrors every page into the page-registry URL index automatically (that is what makes `openUrl` resolve it); do not call `ctx.pageRegistry.registerAppPage` yourself (it is the internal primitive). A mirror failure rolls the registration back and throws — no "visible in the catalog but unresolvable" drift. For a worked example, see this package's `src/pages.tsx` (`bindWorkbenchRuntime` slot + `agent.ctx.tools.register` in the bodies) and `src/index.ts` (`pages.register(component, meta)`).
5. **All-or-nothing wiring (G13 rule 3)** — definition → tools → pages live inside **one `ctx.effect`**; when any step fails, the body rolls every finished step back in reverse before rethrowing, never leaving a half-wired "app present, tools/pages missing" state (see the rollback spec in `tests/app.spec.ts`).

Task structure (§4.7): task items carry `parentId` (written once at creation, immutable — the local store mirrors this, so cycles are structurally impossible) and whole-subtree progress is a derived `2/5` badge (terminal/all nodes of the tree), never stored. The detail page renders a subtask tree region — active branches expanded by default, terminal branches collapsed into progress badges — while `instanceTitle` stays the root task's title; subtasks have no URL or session of their own. `split_task` splits a taken node into one open subtask (current claimant only; safety limits depth ≤ 8 / 32 children per node / 200 nodes per tree, over-limit returns `task/subtree-limit`), and publishing never carries nested task templates (§4.7.6).

Rules that make it an *app* rather than a plugin: ids and tool prefixes are globally unique and validated fail-loud; pages are namespaced under `/apps/<appId>/`; lifecycle is bound to your fiber (register disposers with `ctx.effect` in reverse-safe order); the user's preset choice is never touched.

See `docs/application-concept.cn.md` (§2–§4, §7.1, §8.1) for the design rationale.
