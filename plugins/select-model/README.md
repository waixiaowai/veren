# Select Model

A Host plugin that exposes the runtime tool `select_model`, letting a session switch its **provider/model route** and optional **reasoning effort** mid-conversation. All switching logic is the host's `ctx.sessionController.selectModel`; this plugin only validates arguments and passes host errors through. It modifies no DSH source and duplicates no model-resolution logic.

[中文文档](./README.cn.md)

## Tool

`select_model`

| Argument | Type | Meaning |
| --- | --- | --- |
| `provider` | string, required | Provider id (paired with `model`) |
| `model` | string, required | Model id (paired with `provider`) |
| `reasoningEffort` | string, optional | Reasoning effort for that route (adapter-interpreted, e.g. `low`/`medium`/`high`) |
| `sessionId` | string, optional | Target session id; **omitted means the calling session's own model** |

Returns `{ sessionId, provider, model, reasoningEffort? }` — the values the host resolved and accepted (`reasoningEffort` is absent when the host returns none).

## Default behavior and cross-session policy

- **Default (no `sessionId`):** the tool switches the *calling* session's own model. This is the common case: "switch me to X now".
- **Explicit `sessionId`:** the tool will switch *another* session's model. This is **allowed** by design: session ids are already visible to the model in the working-memory snapshot, the host enforces existence (an unknown id fails with the host's error), and a session switch only changes that session's own route — it never writes the deployment-wide default. Callers should still treat another session's model as that session's owner's business and say so when doing it on a user's behalf.

## Errors

Stable codes on the tool layer; anything from the host passes through verbatim:

| Code | Meaning |
| --- | --- |
| `SELECT_MODEL_INVALID_ARGUMENT` | Non-object arguments, unknown keys, or a non-empty-string field that is missing/blank/wrong-typed (`sessionId`, `reasoningEffort`, `provider`, `model`) |
| `SELECT_MODEL_PROVIDER_MODEL_REQUIRED` | `provider` and `model` must be supplied together |
| `SELECT_MODEL_NO_CALLER` | No `sessionId` given and the call carries no calling session |

Host-side failures (unknown provider/model, unknown session, invalid effort) surface with the host's own message.

## Install / enable / disable

Install this directory (a bundle) with `plugin_manager` (the Web Plugins page or the same-named tool):

```text
install_bundle target=C:\Users\imeep\Documents\cursour\plugins\select-model
```

The bundle name is `@imeep/dsh-select-model`. Enable/disable:

- `set_bundle { target: "@imeep/dsh-select-model", enabled: false }` toggles the whole bundle;
- or `set_plugin { target: "<entryId>", enabled: false }` toggles just this row (entry id is `select-model`);
- `remove_bundle` uninstalls.

## Config

The plugin currently has no tunables; its schema is an empty object (`Config`), kept so future toggles need no config-row migration.

## Tests

```bash
pnpm --dir plugins/select-model test
```
