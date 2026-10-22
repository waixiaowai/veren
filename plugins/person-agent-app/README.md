# @veren/person-agent-app

Exposes the **Person Agent** (the human–DSH bridge) as a first-class Veren application: a personal workbench overview plus a workspace browser, both served under `/apps/person-agent/...` from the host app catalog.

## What it registers

- **App** `person-agent` (tool prefix `person_agent`), entry page `overview`.
- **Pages** (self-contained components: module-level PageFCs whose bodies read synchronous service faces directly — fresh every frame, zero state; the async face is fetched in `ctx.page.effect` + `useState`, action tools are recorded via `ctx.page.tool`; no factory, no snapshot contract)
  - `overview` — `/apps/person-agent/overview` (entry): one screen with the deployment's real state — the app catalog, the workspace ledger, the agent preset roster and the model catalog all appear in the body (apps/workspaces are read straight in the body; presets via `ctx.agentPresets.list` and models via `ctx.llm` are fetched in `ctx.page.effect`, with a failed read rendered honestly with its cause); open tasks refresh asynchronously (`ctx.taskCenter.list`, a failed read is rendered honestly with its cause); per-session detail is looked up with `workspace_session_list`, and two action tools are mounted — `session_create` (create a session) and `session_rename` (rename one). The apps/tasks sections promise no drilldown.
  - `workspaces` — `/apps/person-agent/workspaces`: workspace rows read straight in the body; per-session detail goes through `workspace_session_list`, creating a session inside a workspace through `session_create`.
- **Two tool faces** (reused, never reimplemented — the plugin calls the sibling tool packages' exported definition builders, so page tools and host tools are the very same `ToolDefinition`):
  - the static face `meta.tools`: `workspace_session_list` (from `@veren/person-agent-tool-workspace`), declared and mounted by both pages — the catalog/market/discovery need a static capability list;
  - the dynamic face `ctx.page.tool`: `session_create` / `session_rename` (from `@veren/person-agent-tool-session`) recorded by the page components and mounted by the runtime inside the session scope — the overview mounts both, the workspaces page mounts `session_create`; registration is the scope and is removed with the session, so the agent inside a page session can really act instead of only reading.

Excluded on purpose, with reasons: `session_dispatch` (dispatch semantics belong to an agent session with settlement watches, not a page session), `session_archive/unarchive/pin/unpin` (visibility-changing maintenance verbs with no page workflow), `workspace_create/rename` (workspace maintenance stays on the bridge's own tool surface; the pages never write workspaces).

## Dependencies and failure semantics (G13)

All service dependencies are **declared hard injects**: `apps`, `pageRegistry`,
`workspaceRegistry`, `taskCenter`, `agentPresets`, `llm`, plus
`sessions` / `sessionProjections` / `sessionController` read at catalog-tool
execution time; there is no runtime probing at all (`ctx.get('…')` probing does
not exist on a live host — the property guard attributes accesses to the
accessed context's owner, so the access itself throws).

There is no separate data-plane module: page components **read the host
service faces directly in their bodies** — synchronous faces (`ctx.apps` /
`ctx.workspaceRegistry`) are called in the body, fresh every frame; the
asynchronous faces (`ctx.taskCenter` / `ctx.agentPresets` / `ctx.llm`) are
fetched in `ctx.page.effect` and land in `useState`, with a failed read rendered
honestly. The component ctx carries the full host service face
(declaration-merged), so pages need no broker layer; other plugins read those
same faces directly.

- The catalog and workspaces are synchronous in-memory reads that cannot fail;
- the task center, preset roster and model catalog are async reads: a failure
  renders "任务中心读取失败: <cause>" / "预设名单读取失败: <cause>" /
  "模型目录读取失败: <cause>" — never fake data. One provider's model-list
  failure stays local to its group and states the cause on that line. Service
  absence is not a possible failure (hard injects guarantee presence).

## Composition

Install via the `@veren/person-agent-bundle` bundle; the bundle patch inserts this row **in addition to** the untouched `person-agent-preset` row. This plugin is strictly additive: if it fails to activate, the Person Agent preset's runtime behavior is unchanged.

## Development

```bash
pnpm --dir plugins/person-agent-app test        # vitest unit tests
pnpm --dir plugins/person-agent-app typecheck   # tsc --noEmit
```
