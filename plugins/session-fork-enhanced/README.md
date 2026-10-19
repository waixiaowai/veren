# Session Fork Enhanced

A Host plugin that forks an existing session's **completed-turn prefix (full context)** into a new session, optionally continuing that branch under a chosen **agent preset** and **provider model**. It modifies no DSH source and does not touch the shipped `session_fork`.

[中文文档](./README.cn.md)

## Tool

`session_fork_with_options`

| Argument | Type | Meaning |
| --- | --- | --- |
| `sessionId` | string, required | Source session id |
| `atSeq` | integer, optional | Exact inclusive source event seq; omit for the latest completed turn |
| `presetId` | string, optional | Agent preset id for the new branch; omitted inherits the source preset |
| `provider` + `model` | string, must be given together | Model for the branch's next request; omitted inherits the effective model per the shipped fork rules |
| `reasoningEffort` | string, optional | Reasoning effort for that provider/model route; requires provider/model |

Returns `{ sessionId, sourceSessionId, atSeq, inheritedEventCount, agentPreset?, provider, model, reasoningEffort? }`.

## Behavior

- Context copying is identical to the shipped `session_fork`: `buildForkSeed` copies the prefix, writes `session/end-seed`, and closes an open tail with synthetic closers; `inheritedEventCount = boundary + 1`.
- Preset: resolves `agentPresets.resolve(presetId ?? source preset)`, mounts it in `setup`, and records `agentPreset` on the new session header. Specifying a preset at creation does not fire `agent-preset/locked`.
- Model: resolved through `llm.resolveCallConfig` and applied as `agentOptions` at creation; when it differs from the log's effective model, a durable `model/selection` event is appended to the new session. Consequences:
  - The branch's first request is routed by `agentOptions` (no extra selection listener is installed, avoiding double-stacking with the Session Controller's own listener).
  - On a later cold resume, the Session Controller reads the new model as `pending` and is not overridden by the stale `request/header` at the cut point.
- **Never writes the global default model**: it does not use `sessionController.selectModel` (which writes back to `agentDefaultModel`), so parallel branches cannot pollute the deployment default.
- Workspace: attached to the same workspace as the source session, so it shows up in the session list.
- With `presetId`/`provider`/`model` omitted, the boundary, preset, effective model, and header metadata match the shipped fork exactly.

## Install / enable / disable

Install this directory (a bundle) with `plugin_manager` (the Web Plugins page or the same-named tool):

```text
install_bundle target=C:\Users\imeep\Documents\cursour\plugins\session-fork-enhanced
```

The bundle name is `@imeep/dsh-session-fork-enhanced`. Enable/disable:

- `set_bundle { target: "@imeep/dsh-session-fork-enhanced", enabled: false }` toggles the whole bundle;
- or `set_plugin { target: "<entryId>", enabled: false }` toggles just this row (entry id is `session-fork-enhanced`);
- `remove_bundle` uninstalls.

## Relation to the shipped `session_fork`

- Different tool name (`session_fork_with_options` vs `session_fork`) and arguments; they coexist without conflict.
- The shipped tool is mounted per preset by `@veren/person-agent-preset`; this plugin registers on the Host root context, so every preset can see it.
- Both create a normal session, copy context, and attach the same workspace; the only difference is that this plugin allows overriding the preset and model at creation time.

## Config

The plugin currently has no tunables; its schema is an empty object (`Config`), kept so future toggles need no config-row migration.

## Tests

```bash
pnpm --dir plugins/session-fork-enhanced test
```
