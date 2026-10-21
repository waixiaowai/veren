# @veren/person-agent-app

Exposes the **Person Agent** (the human–DSH bridge) as a first-class Veren application: a personal workbench overview plus a workspace browser, both served under `/apps/person-agent/...` from the host app catalog.

## What it registers

- **App** `person-agent` (tool prefix `person_agent`), entry page `overview`.
- **Pages**
  - `overview` — `/apps/person-agent/overview` (entry): one screen with the deployment's real state — the app catalog (`ctx.apps.catalog()`), the workspace/session ledger (`ctx.workspaceRegistry`), and open tasks (`ctx.taskCenter`). The three section snapshots arrive via the first-screen `load` (the snapshots need no tool); a workspace's per-session detail is an on-demand query carried by the page's mounted read-only `workspace_session_list` tool. The apps/tasks sections promise no drilldown.
  - `workspaces` — `/apps/person-agent/workspaces`: one row per workspace with its session count; per-session detail goes through the collected `workspace_session_list` tool.
- **Collected tools** (reused, never reimplemented — the plugin calls the sibling tool packages' exported definition builders, so page tools and host tools are the very same `ToolDefinition`):
  - `workspace_session_list` (from `@veren/person-agent-tool-workspace`): mounted by both the `overview` and the `workspaces` pages;
  - `session_create`, `session_rename` (from `@veren/person-agent-tool-session`): catalog entries for future pages; no page mounts them today, so no page promises them either ("promised but absent" is zero-tolerance: mounting and promising move together).

Excluded on purpose, with reasons: `session_dispatch` (dispatch semantics belong to an agent session with settlement watches, not a page session), `session_archive/unarchive/pin/unpin` (visibility-changing maintenance verbs with no page workflow), `workspace_create/rename` (workspace maintenance stays on the bridge's own tool surface; the pages are read-only).

## Dependencies and failure semantics (G13)

All four service dependencies are **declared hard injects**: `apps`,
`pageRegistry`, `workspaceRegistry`, `taskCenter`. The overview's three data
faces are passed into the view layer as explicit parameters; there is no
runtime probing at all (`ctx.get('…')` probing does not exist on a live host —
the property guard attributes accesses to the accessed context's owner, so the
access itself throws).

- The catalog and workspaces are synchronous in-memory reads that cannot fail;
- the task center is an async read: when a read fails (a storage backend down,
  say) the tasks section reports `available=false` with the reason — never fake
  data. Service absence is not a possible failure (hard injects guarantee
  presence).

## Composition

Install via the `@veren/person-agent-bundle` bundle; the bundle patch inserts this row **in addition to** the untouched `person-agent-preset` row. This plugin is strictly additive: if it fails to activate, the Person Agent preset's runtime behavior is unchanged.

## Development

```bash
pnpm --dir plugins/person-agent-app test        # vitest unit tests
pnpm --dir plugins/person-agent-app typecheck   # tsc --noEmit
```
