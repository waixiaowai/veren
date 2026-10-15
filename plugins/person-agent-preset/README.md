# @veren/person-agent-preset

English | [中文](README.cn.md)

## Summary

A DSH host plugin that registers the **Person Agent** agent preset at runtime through `ctx.agentPresets.register()` from `@deepseek-ai/dsh-agent-preset-registry`. Use it when a deployment needs a preset whose sessions report to **human beings**: plain beginner-readable language, visuals-first summaries (tables, Mermaid diagrams, checklists), and concrete artifacts delivered through the `present` tool. Skip it when every consumer reads raw developer output.

## What the preset composes

| Child row | Purpose |
|---|---|
| `persona` (`@deepseek-ai/dsh-persona`) | The reporting style: plain language, visual summary first, deliver artifacts, at most three next steps |
| `tool-fs` / `tool-fs-search` | File reads and searches needed to do the work |
| `present` (`@deepseek-ai/dsh-tool-present`) | Delivers files/charts/documents as client file cards |
| `tool-todo` / `tool-ask-user` | Progress tracking and asking the user owned questions |
| `tool-web` (optional, `withWeb`) | Web search when research is part of the work |

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `presetId` | `person-agent` | Stable preset identity sessions record |
| `order` | `5` | Roster order in client preset pickers |
| `withWeb` | `true` | Include the web search tool |
| `refreshMs` | `30000` | Dynamic suffix refresh cadence (ms): polls both registries and diffs the rendered content, re-registering (a revision swap) only when the lists actually changed; `0` disables |

## How it works

`apply` calls `ctx.agentPresets.register(definition)` and yields the returned disposer to `ctx.effect`, so uninstalling the plugin retires the definition in reverse order. Existing Agents keep their current composition; only newly created sessions pick up the preset. Definitions are revisioned by the registry — no files on disk are modified.

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
