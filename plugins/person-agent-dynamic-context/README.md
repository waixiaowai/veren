# @veren/person-agent-dynamic-context

Person Agent working memory: injects the agent preset roster, the available model catalog (providers, multimodal input support, context window), and the workspace list into each session's context as a snapshot message. Install it when a Person Agent preset's sessions should know which sibling presets, models, and workspaces exist; skip it when sessions should not see the rosters.

## How it works

- Composed into a preset's `plugins` list = active; absent = no effect. Nothing is registered globally.
- The lists are injected as a **sourced user-role snapshot message** (the `time-context` pattern): a prepended `agent/pre-step` listener awaits the preset roster read, reads the model catalog and workspace list live, compares the rendered text with the session's previous snapshot, and appends only on change.
- The model catalog reads the live LLM registry (`listProviders` → `listModels` → `resolveModelInfo`) — the same source as the GUI model selector — and renders one row per model with its input modalities and context window.
- Sessions render as a table (`id | title | preset | provider | model | created at`) under each workspace.
- Because the read is awaited inside the listener, a registry change is reflected **exactly** at the session's next step - no cache, no polling, no one-assembly lag.
- The contribution's source kind is `person-agent-context`; while values are unchanged nothing is added to history.

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
