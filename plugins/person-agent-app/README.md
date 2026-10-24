# @veren/person-agent-app

Exposes the **Person Agent** (the human–DSH bridge) as a first-class Veren application — and the app IS the whole stack: the bridge persona lives in the application instructions, the session/workspace maintenance tools and the `renhua` writing skill mount into each page session's agent scope, and a plain session sees none of them.

## What it registers

- **App** `person-agent` (tool prefix `person_agent`), entry page `overview`.
- **App instructions** (the PAGE block's `应用说明` line, every page session): the bridge persona — judgment, not labor; metacognition before action; an opinion about where a task belongs, sourced from the page body's lists; Simplified Chinese, outcome first; hand off with `session_create` + `session_dispatch`; the one carve-out — text a human will read is written by the bridge itself, after loading `renhua`.
- **Pages** (self-contained components: module-level PageFCs whose bodies read synchronous service faces directly — fresh every frame; the async face is the body's own lifecycle, an `agent.ctx.effect` fetch delivered as a followup message; no factory, no snapshot contract):
  - `overview` — `/apps/person-agent/overview` (entry): the deployment's real state in one body — app catalog, Workspace List, Agent Preset List, Model Catalog, open tasks (failed reads render their cause honestly, never faked). Ten mounted tools: the page body registers all ten in its one render via `agent.ctx.tools.register` — nine stateless ones (`workspace_session_list`, `session_create`, `session_rename`, `session_archive`, `session_unarchive`, `session_pin`, `session_unpin`, `workspace_create`, `workspace_rename`) plus the one dynamic face — `session_dispatch`, whose settlement watch rides `agent.ctx.effect` and settles at agent disposal. The page instructions end with the numeric stop-and-delegate hard rule (3+ consecutive analysis-only steps with no dispatch → stop and hand off).
  - `workspaces` — `/apps/person-agent/workspaces`: workspace rows read straight in the body; four tools registered in place by the body (`workspace_session_list`, `session_create`, `workspace_create`, `workspace_rename`); no dynamic registration.
- **Page-scope skill** `renhua` (plain-Chinese writing), registered by both page bodies via `agent.ctx.skills.register` (`source: 'runtime'`) in the one render — living and dying with the agent fiber, a plain session sees none of it; the skill text lives in the packaged `skills/renhua/SKILL.md`.
- **Tool implementations**: all ten built by the sibling packages' builders — the same `ToolDefinition` objects the pages mount, never a second implementation. There is no app-level tool catalog: a tool exists only inside a page (§3.9 promise = registration).

## Dependencies and failure semantics (G13)

All service dependencies are **declared hard injects**: `apps`, `pageRegistry`,
`workspaceRegistry`, `taskCenter`, `agentPresets`, `llm`, plus
`sessions` / `sessionProjections` / `sessionController` read at page-tool
execution time; there is no runtime probing at all.

Page components **read the host service faces directly in their bodies** —
synchronous faces (`ctx.apps` / `ctx.workspaceRegistry`) are called in the body,
fresh every frame; the asynchronous faces (`ctx.taskCenter` /
`ctx.agentPresets` / `ctx.llm`) are fetched via `agent.ctx.effect` and delivered
as a followup message, with a failed read rendered honestly. The component
carries the full host service face (declaration-merged), so pages need no
broker layer.

- The catalog and workspaces are synchronous in-memory reads that cannot fail;
- the task center, preset roster and model catalog are async reads: a failure
  renders "任务中心读取失败: <cause>" / "预设名单读取失败: <cause>" /
  "模型目录读取失败: <cause>" — never fake data. One provider's model-list
  failure stays local to its group and states the cause on that line. Service
  absence is not a possible failure (hard injects guarantee presence).

## Composition

Install via the `@veren/person-agent-bundle` bundle: its patch inserts exactly this one app row, and the application framework rides in through `@veren/app-host-bundle`. Retiring the preset stack was a breaking change (0.x): sessions created against the removed `person-agent` preset cannot be resumed.

## Development

```bash
pnpm --dir plugins/person-agent-app test        # vitest unit tests
pnpm --dir plugins/person-agent-app typecheck   # tsc --noEmit
```
