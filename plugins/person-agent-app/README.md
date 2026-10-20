# @veren/person-agent-app

Exposes the **Person Agent** (the human–DSH bridge) as a first-class Veren application: a personal workbench overview plus a workspace browser, both served under `/apps/person-agent/...` from the host app catalog.

## What it registers

- **App** `person-agent` (tool prefix `person_agent`), entry page `overview`.
- **Pages**
  - `overview` — `/apps/person-agent/overview` (entry): one screen with the deployment's real state — the app catalog (`ctx.apps.catalog()`), the workspace/session ledger (`ctx.workspaceRegistry`), and open tasks (`ctx.taskCenter`, degrade when absent).
  - `workspaces` — `/apps/person-agent/workspaces`: one row per workspace with its session count; per-session detail goes through the collected `workspace_session_list` tool.
- **Collected tools** (reused, never reimplemented — the plugin calls the sibling tool packages' exported definition builders, so page tools and host tools are the very same `ToolDefinition`):
  - `session_create`, `session_rename` (from `@veren/person-agent-tool-session`)
  - `workspace_session_list` (from `@veren/person-agent-tool-workspace`)

Excluded on purpose, with reasons: `session_dispatch` (dispatch semantics belong to an agent session with settlement watches, not a page session), `session_archive/unarchive/pin/unpin` (visibility-changing maintenance verbs with no page workflow), `workspace_create/rename` (workspace maintenance stays on the bridge's own tool surface; the pages are read-only).

## Degradation

Every data source is read lazily and may be absent:

- `ctx.apps` / `ctx.pageRegistry` are hard injections (this plugin **is** an app).
- `ctx.workspaceRegistry` and `ctx.taskCenter` are **not** injected: the pages read them via `ctx.get` and show `available=false` with a reason when missing — never fake data.

## Composition

Install via the `@veren/person-agent-bundle` bundle; the bundle patch inserts this row **in addition to** the untouched `person-agent-preset` row. This plugin is strictly additive: if it fails to activate, the Person Agent preset's runtime behavior is unchanged.

## Development

```bash
pnpm --dir plugins/person-agent-app test        # vitest unit tests
pnpm --dir plugins/person-agent-app typecheck   # tsc --noEmit
```
