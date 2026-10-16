# @veren/person-agent-preset

English | [中文](README.cn.md)

## Summary

A DSH host plugin that registers the **Person Agent** agent preset at runtime through `ctx.agentPresets.register()` from `@deepseek-ai/dsh-agent-preset-registry`. Person Agent is **the bridge between the human and DSH**: a chief-of-staff persona that understands what the user actually needs, thinks before it thinks (metacognition), talks in plain Simplified Chinese, and hands the work to a properly configured session it creates — picking the workspace, preset, provider and model itself. The delegating persona and both maintenance tool families (workspace + session) are **always on**: there are no toggles, because a bridge without the ability to route work is not a bridge. Skip it when sessions must never create or route other sessions.

## What the preset composes

| Child row | Purpose |
|---|---|
| `persona` (`@deepseek-ai/dsh-persona`) | The bridge persona, a character not a procedure: identity (chief of staff, never does the work itself), thinking before thinking, way of thinking, how it talks with humans, how it hands off work |
| `tool-fs` / `tool-fs-search` | File reads and searches |
| `present` (`@deepseek-ai/dsh-tool-present`) | Delivers files/charts/documents as client file cards |
| `tool-todo` / `tool-ask-user` | Progress tracking and asking the user owned questions |
| `tool-web` (optional, `withWeb`) | Web search when research is part of the work |
| `tool-workspace` (`@veren/person-agent-tool-workspace`, always on) | `workspace_create` / `workspace_rename` so the bridge can open a home for the work |
| `tool-session` (`@veren/person-agent-tool-session`, always on) | `session_create` / `session_rename` / `session_fork` / archive / pin — the delegation outlet |
| `dynamic-context` (`@veren/person-agent-dynamic-context`) | Working memory: preset roster, model catalog and workspace list as snapshot messages |

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `presetId` | `person-agent` | Stable preset identity sessions record |
| `order` | `5` | Roster order in client preset pickers |
| `withWeb` | `true` | Include the web search tool |

## How it works

`apply` calls `ctx.agentPresets.register(definition)` and yields the returned disposer to `ctx.effect`, so uninstalling the plugin retires the definition in reverse order. Existing Agents keep their current composition; only newly created sessions pick up the preset. Definitions are revisioned by the registry — no files on disk are modified.

This plugin exposes **no bundle of its own** (`dsh.bundle.patch` is deliberately absent): it is a plain dependency, and the profile layer that inserts its row lives in `@veren/person-agent-bundle`. Compose it there, or list the row yourself in a patch:

```yaml
- id: person-agent-preset
  name: '@veren/person-agent-preset'
  config:
    presetId: person-agent
```

## Testing

```bash
pnpm test        # unit tests (mocked registry and effect semantics)
pnpm test:e2e    # real-host e2e: boots a real dsh web host (one-shot home under ~/.dsh_test)
```

The e2e asserts through an in-host probe plugin: it polls `agentPresets.remoteExportList()` until `person-agent` appears, reads the rendered composition YAML via `readDocument()` (must contain the persona prompt and `dsh-tool-present`), and mounts the preset on a child context through the real Loader and activation audit, then writes a JSON verdict for the spec. On newer host versions the e2e surfaces schema drift (e.g. `dsh-tool-todo`'s required `allowParallelInProgress`). Prerequisites: the plugin is built (`pnpm build`) and the harness checkout exists two levels up (`deepseek/deepseek-harness`).

## Limitations

- Requires the `agentPresets` service (`@deepseek-ai/dsh-agent-preset-registry` must be mounted).
- A preset is not a security sandbox; the persona shapes reporting style only.
- Sessions that already started keep their previous preset (`agent-preset/locked`).
