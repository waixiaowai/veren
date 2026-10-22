# person-agent (ZCode plugin)

The ZCode port of the DSH person-agent stack (`plugins/person-agent-app`, `person-agent-bundle`, `person-agent-tool-session`, `person-agent-tool-workspace`): a chief-of-staff butler that judges a request, hands the labor to background subagents, and reports outcomes in plain Chinese.

## What it registers

| Component | Path | Role |
| --- | --- | --- |
| Agent `person-agent` | `agents/person-agent.md` | The bridge persona: judgment over labor, dispatches via the Agent tool with `run_in_background: true`, verifies and relays results, writes human-facing text itself |
| Skill `dispatch` | `skills/dispatch/SKILL.md` | When and how to hand off work: one goal per dispatch, briefs in the user's terms, the 3-step stall rule ("stop analyzing, dispatch now") |
| Skill `renhua` | `skills/renhua/SKILL.md` | Plain-Chinese writing discipline for anything a human reads |
| Command `/person-agent` | `commands/person-agent.md` | Hands the current request to the butler end to end |

## Why one plugin instead of four

The DSH stack splits into two tool libraries, an app and a bundle because cordis loads each patch as its own layer. A ZCode plugin is one self-contained manifest (`skills` / `agents` / `commands`), so there is nothing to bundle — the whole stack rides one `plugin.json`.

Two DSH capabilities have no ZCode-facing counterpart and are intentionally absent rather than faked:

- **Session tools** (`session_create` / `session_dispatch` / `session_archive` …) — ZCode does not expose a session registry to plugins. The native equivalent is the Agent tool with background subagents; the `dispatch` skill carries the semantics (non-blocking dispatch, settlement via task notification, no polling).
- **Workspace tools** (`workspace_create` / `workspace_session_list` …) — a ZCode workspace is the opened folder; there is no registry to maintain. No MCP server is declared because there is no real resource for one to serve.

## Install (local dev marketplace)

Add the marketplace root `C:\Users\imeep\Documents\cursour\plugins` in **Plugin Marketplace → Add**, then install **Person Agent** from the `dev-cursour` market. After installation, pick the `person-agent` agent from the composer picker, type `/person-agent <goal>`, or just ask the main agent to "let the butler handle this".

## Try it

> /person-agent Give the repo README a plain-Chinese rewrite and check the CI config for stale scripts — report both.

Expected: the butler dispatches the two independent jobs to background subagents (or writes the README itself, since human-facing text is its carve-out), reports what went where with one honest sentence per choice, and relays verified results with a next step.

## Development

Pure declarative resources — no build step. Edit the markdown files, then refresh/reinstall the plugin from the marketplace to pick up changes.
