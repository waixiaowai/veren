# @veren/person-agent-dynamic-context

Person Agent working memory: injects the agent preset roster, the available model catalog (providers, multimodal input support, context window), and the workspace list into each session's context as three named small messages. Install it when a Person Agent preset's sessions should know which sibling presets, models, and workspaces exist; skip it when sessions should not see the rosters. Session details are intentionally excluded — the per-workspace session list changes too often for persistent context and is covered by a query tool.

## How it works

- Composed into a preset's `plugins` list = active; absent = no effect. Nothing is registered globally.
- The working memory is split into **three named small messages**: `Agent Preset List`, `Model Catalog`, and `Workspace List`. A prepended `agent/pre-step` listener awaits the roster read and reads the model catalog and workspace list live, then compares each section's text against the latest text of that same section recorded in the session log — **only changed sections are appended**; a step where nothing changed adds nothing.
- The model catalog reads the live LLM registry (`listProviders` → `listModels` → `resolveModelInfo`) — the same source as the GUI model selector — and renders one row per model with its input modalities and context window.
- The workspace section renders **the workspaces only** (one `title(id):path` line each). Per-workspace session rows are not injected: they change too often for persistent context and are covered by a session query tool.
- The change detection scans the session log, so it stays true across restarts with no in-memory state.
- Each message's source records its section name (`person-agent-context` with `sections`), which is what the per-section comparison reads back.

## Config

| Option | Default | Meaning |
| --- | --- | --- |
| `includePresetRoster` | `true` | Inject the agent preset roster. |
| `includeModelCatalog` | `true` | Inject the model catalog (providers, multimodal support, context window). |
| `includeWorkspaceList` | `true` | Inject the workspace list. |

## Dispose / HMR

The pre-step listener is registered through `ctx.on`, so uninstalling the plugin or hot-reloading removes it in reverse order without leaking.

## Tests

```bash
pnpm test          # unit + composition (real cordis Context, fake service faces)
```

E2E against a real host is exercised indirectly through `@veren/person-agent-preset`'s e2e, which mounts this plugin via the real Loader.
