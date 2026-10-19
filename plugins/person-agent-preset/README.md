# @veren/person-agent-preset

English | [中文](README.cn.md)

## Summary

A DSH host plugin that registers the **Person Agent** agent preset at runtime through `ctx.agentPresets.register()` from `@deepseek-ai/dsh-agent-preset-registry`. Person Agent is **the bridge between the human and DSH**: a chief-of-staff persona that understands what the user actually needs, thinks before it thinks (metacognition), talks in plain Simplified Chinese, and hands the work to a properly configured session it creates — picking the workspace, preset, provider and model itself. The delegating persona and both maintenance tool families (workspace + session) are **always on**: there are no toggles, because a bridge without the ability to route work is not a bridge. Skip it when sessions must never create or route other sessions.

## What the preset composes

| Child row | Purpose |
|---|---|
| `persona` (`@deepseek-ai/dsh-persona`) | The bridge persona as a character: identity, metacognition, thinking, talking with humans, handing off work. The hard numeric "stop working and delegate" rule is the **suffix**, rendered last in the system prompt so it sits closest to the conversation |
| `tool-fs` / `tool-fs-search` | `read` / `read_image` / `write` and file searches. `edit` is explicitly disabled: the bridge has no terminal, so removing `edit` removes the last place self-work could land, while `write` stays for human-facing documents |
| `reanchor` (`@veren/person-agent-reanchor`) | Periodic self-work re-anchor: after N consecutive analysis-only steps with no dispatch, appends one short numeric notice to the next request (append-only, never a system-prompt update) |
| `present` (`@deepseek-ai/dsh-tool-present`) | Delivers files/charts/documents as client file cards |
| `tool-todo` / `tool-ask-user` | Progress tracking and asking the user owned questions |
| `tool-web` (optional, `withWeb`) | Web search when research is part of the work |
| `tool-workspace` (`@veren/person-agent-tool-workspace`, always on) | `workspace_create` / `workspace_rename` so the bridge can open a home for the work |
| `tool-session` (`@veren/person-agent-tool-session`, always on) | `session_create` / `session_rename` / `session_fork` / archive / pin — the delegation outlet |
| `dynamic-context` (`@veren/person-agent-dynamic-context`) | Working memory: preset roster, model catalog and workspace list as snapshot messages |
| `skill-filesystem` / `tool-skill` | Writing-skill directory limited to the packaged `skills/` root; `/renhua` invokes it directly and writing tasks load it from its description |

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `presetId` | `person-agent` | Stable preset identity sessions record |
| `order` | `5` | Roster order in client preset pickers |
| `withWeb` | `true` | Include the web search tool |
| `withSkills` | `true` | Include the bundled `renhua` writing skill and its loader; set `false` to disable both |
| `withReanchor` | `true` | Mount the periodic re-anchor child row; set `false` to remove it |
| `reanchorThreshold` | `3` | Consecutive analysis-only steps before one re-anchor notice |

## Why the prompt is split into prefix and suffix

Long sessions dilute a persona that only lives at the far head of the system prompt. The preset therefore states the delegating identity once in the prefix and the hard self-work check once in the suffix, where the system prompt is closest to the conversation. The suffix states numeric criteria — 3+ consecutive analysis-only steps with no dispatch — so the model can check a count instead of judging an adjective. The prefix no longer repeats the same rule in two sections.

That static placement is not enough on its own, because the system prompt still sits far away. The `reanchor` child row supplies the periodic, append-only reminder; `edit` removal removes the hands. The three layers are independent: text position, periodic fact, and missing tool.

## How it works

`apply` calls `ctx.agentPresets.register(definition)` and yields the returned disposer to `ctx.effect`, so uninstalling the plugin retires the definition in reverse order. Existing Agents keep their current composition; only newly created sessions pick up the preset. Definitions are revisioned by the registry — no files on disk are modified.

This plugin exposes **no bundle of its own** (`dsh.bundle.patch` is deliberately absent): it is a plain dependency, and the profile layer that inserts its row lives in `@veren/person-agent-bundle`. Compose it there, or list the row yourself in a patch:

```yaml
- id: person-agent-preset
  name: '@veren/person-agent-preset'
  config:
    presetId: person-agent
```

## Writing skill: `renhua`

The bundled `renhua` skill does one thing: make Chinese text written for people read smoothly without losing hard facts. A user can type `/renhua`; before a document, letter, notice or report the model also loads it from the description in its catalog. The body is read on demand, so the catalog carries one description line.

Overhead: the body is about 1,260 characters (928 Chinese characters), roughly 900–1,200 tokens when loaded. The catalog line is about 120 characters, roughly 100–150 tokens.

Do **not** use it for compact agent-facing instructions, list-shaped data, code/API reference, logs or tables — those need density and structure, not reading rhythm. The body states this boundary too.

Disable it with `withSkills: false` on the `person-agent-preset` row in the profile patch, or disable the whole bundle. Roll back by reinstalling the previous tarball. The skill ships with the package, so editing `node_modules` is overwritten by the next install.

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
