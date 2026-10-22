# Person Agent's app mode (app-only)

> For developers. This document records the final shape of Person Agent's migration from the "preset composition stack" to the "pure application stack", why, and the boundaries.

## Final shape

```text
@veren/person-agent-bundle          # profile layer: the patch inserts exactly one row, person-agent-app
├─ @veren/app-host-bundle           # the application framework (rides in as a dependency, inserts its own rows)
└─ @veren/person-agent-app          # the app: bridge persona + 2 pages + page-scope tools/skill
   ├─ @veren/person-agent-tool-session     # pure builders (seven session_* tools + the settlement watch)
   └─ @veren/person-agent-tool-workspace   # pure builders (three workspace_* tools)
```

- **No preset row.** `person-agent-preset`, `person-agent-dynamic-context` and `person-agent-reanchor` are deleted.
- **No globally registered tools.** The ten `person_agent__*` tools (nine stateless + `session_dispatch`) exist only in the agent scope of `/apps/person-agent/*` page sessions; a plain session sees none of them, and the skill catalog carries no `renhua`.
- **Where the persona and the hard rule live**:
  - the bridge persona → `APP_DEFINITION.instructions`, reaching every page session as the PAGE block's `应用说明` line;
  - the numeric stop-and-delegate hard rule (3+ consecutive analysis-only steps with no dispatch → stop) → the end of the overview page's instructions.
- **`session_dispatch`'s settlement watch lives and dies with the page view**: the page component creates the watch in `ctx.page.effect` and records the dynamic tool definition; the effect cleanup settles every watch — a deprecated page session never leaves a dangling report behind.

## Pages and tools

| Page | Body | Page tools (all in the agent scope) | skill |
|---|---|---|---|
| `/apps/person-agent/overview` (entry) | app catalog + Workspace List + Agent Preset List + Model Catalog + open tasks | `workspace_session_list`, `session_create/rename/dispatch/archive/unarchive/pin/unpin`, `workspace_create/rename` | renhua |
| `/apps/person-agent/workspaces` | workspace rows | `workspace_session_list`, `session_create`, `workspace_create/rename` | renhua |

Two tool faces: the nine stateless tools ride `meta.tools` (declared statically, final from the staged pre-mount on); `session_dispatch` is the one dynamic face (`ctx.page.tool`) because it carries the page's own watch. The catalog (market/permissions/discovery) lists all ten; the builders produce the very same `ToolDefinition` the pages mount.

## Page-scope skills (the framework face added this round)

`ComponentPageMeta.skills` / `PageDefinition.skills` declare page-scope runtime skills; page-registry collects them and mounts them through the same port as the tools (`PageSessionPort.mountTools(sessionId, tools, skills?)`), and app-host's `mountOnAgent` registers them into the session's agent scope via `agent.ctx.skills.register`, their disposers joining the tools' reverse-order group. `renhua` is the first user.

## App-level instructions (the framework face added this round)

`componentPageBlock` now renders `应用说明：<app.definition.instructions>` before `说明：<page.instructions>` — read "what this app is" first, then "how to use this page".

## Migration and compatibility

- **Old preset sessions**: once the preset row is gone they cannot resume (`agent-preset/not-found`). This is an accepted 0.x breaking change; no migration channel is published for the retired packages.
- **No dual-track compatibility.** Retirement means deletion: the preset's `dsh-skill-filesystem` child row, dynamic-context's working memory and reanchor's periodic reminders all retired with the preset stack. The working memory's replacement is the overview body's three lists (read at mount + PAGE-PATCH).

## Related documents

- Design chronicle: `docs/prompt-page-render-design.md` / `.cn.md`
- The preset-era scenario design (its landing points now updated to pages): `docs/scene-preset-design.md` / `.cn.md`
