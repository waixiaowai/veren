# @veren/person-agent-tool-workspace

Model-facing workspace maintenance and inspection tools for the Person Agent preset: `workspace_create`, `workspace_rename`, and `workspace_session_list` over `ctx.workspaceRegistry`.

## Use this package

Use it when a Person Agent session must maintain the workspace list itself — registering a directory as a new workspace, retitling an existing one, or searching the sessions accounted under a workspace by preset, provider/model, and archive state. Skip it when sessions must never touch the workspace registry.

## Minimal configuration

The preset composes it as a child row (no `cordis.patch.yml` needed; the loader loads it by package name):

```yaml
- id: tool-workspace
  name: '@veren/person-agent-tool-workspace'
  config:
    allowCreate: true
    allowCreateDirectory: false
    allowListSessions: true
    maxListSessions: 200
```

## Tools

| Tool | Arguments | Effect |
| --- | --- | --- |
| `workspace_create` | `path` (required), `title?`, `createDirectory?` | Registers an existing directory as a workspace; reuses the record when the canonical path is already owned. |
| `workspace_rename` | `workspaceId` (required), `title` (required) | Retitles one existing workspace. |
| `workspace_session_list` | `workspaceId` (required), `agentPreset?`, `provider?`, `model?`, `archived?` (`exclude`/`only`/`include`, default `exclude`), `limit?` | Lists the sessions accounted under one workspace, newest first. `total` reports the pre-truncation hit count. |

Filter semantics of `workspace_session_list`:

- `agentPreset`, `provider`, and `model` are exact matches against the session's facts. Attached sessions read the durable `modelSelection` projection's `lastUsed`; cold (persisted, not attached) sessions fold the latest `model/selection` event from their log. A session whose route cannot be determined never matches a `provider` or `model` filter.
- The preset comes from the session header; it cannot change after creation in the current release.
- Archive state is the registry-global archive set; the `archived` tri-state selects unarchived only (default), archived only, or both.

Errors are structured with stable codes (`WORKSPACE_PATH_NOT_A_DIRECTORY`, `WORKSPACE_TITLE_EMPTY`, `WORKSPACE_NOT_FOUND`, `WORKSPACE_CREATE_DIRECTORY_DISABLED`, `WORKSPACE_LIST_LIMIT_INVALID`) and machine-readable fields, so a misconfiguration fails loud instead of guessing.

## Understand the implementation

- `src/index.ts` — plugin identity, config, and effect-managed registration (reverse-order cleanup, HMR safe).
- `src/tools.ts` — the `workspace_create` / `workspace_rename` registrations.
- `src/session-list.ts` — the `workspace_session_list` registration, filters, and limit handling.
- `src/session-facts.ts` — per-session facts resolution (attached projections vs. cold-log folds), reading the same host sources as the working-memory list.
- `src/types.ts` — argument/result contracts and the structured error type.

## Further exploration

- Registry semantics: `@deepseek-ai/dsh-workspace` (create/reuse, `setTitle`).
- Tool contract: `@deepseek-ai/dsh-tools` (`defineTool`, `ctx.tools.register`).
