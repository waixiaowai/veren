# @veren/person-agent-tool-session

Model-facing session maintenance tools for the Person Agent preset: `session_create`, `session_rename`, `session_fork`, `session_prompt` over `ctx.sessionController`, plus `session_archive`, `session_unarchive`, `session_pin`, `session_unpin` over `ctx.workspaceRegistry`.

## Use this package

Use it when a Person Agent session must create, dispatch work to, or reorganize sibling sessions — start one with a preset/model/title, hand it its task (including the first message), fork a completed turn, archive or pin sessions. Skip it when sessions must never mutate the session roster.

## Minimal configuration

The preset composes it as a child row (no `cordis.patch.yml` needed; the loader loads it by package name):

```yaml
- id: tool-session
  name: '@veren/person-agent-tool-session'
  config:
    allowCreate: true
    allowPrompt: true
    allowFork: true
    allowArchive: true
    allowPin: true
```

## Tools

| Tool | Arguments | Effect |
| --- | --- | --- |
| `session_create` | `title?`, `presetId?`, `provider?`+`model?`, `workspaceId?` xor `cwd?` | Creates an ordinary session, then installs the model selection and title in that order. The session starts empty; the new id is reported, never switched to. |
| `session_prompt` | `sessionId`, `prompt`, `wait?` | Delivers one prompt into the session through the host's standard enqueue path (`resolveAgent` → `agent.followup` with a `kind: 'user'` message) and wakes it; with `wait: true` the call returns after the session goes idle. This is how the bridge persona hands a created session its first task. |
| `session_rename` | `sessionId`, `title` | Retitles one session durably. |
| `session_fork` | `sessionId`, `atSeq?` | Copies an exact completed-turn prefix into a new session. |
| `session_archive` | `sessionId`, `stopActivity?` | Moves a session into the archive set; with `stopActivity`, running work is stopped instead of refusing. |
| `session_unarchive` | `sessionId` | Restores an archived session to its recorded position. |
| `session_pin` / `session_unpin` | `sessionId` | Maintains the registry-global pin set. |

Errors are structured with stable codes (`SESSION_TITLE_EMPTY`, `SESSION_CREATE_LOCATION_CONFLICT`, `SESSION_MODEL_SELECTION_INCOMPLETE`, `SESSION_PROMPT_EMPTY`, `SESSION_PROMPT_NOT_FOUND`) and machine-readable fields; registry-level refusals (active session, archived pin) propagate from the host seams as-is.

## Understand the implementation

- `src/index.ts` — plugin identity, toggles, and effect-managed registration (reverse-order cleanup, HMR safe).
- `src/tools-management.ts` — create/rename/fork over `ctx.sessionController`.
- `src/tools-prompt.ts` — prompt delivery over `resolveAgent` + `agent.followup`.
- `src/tools-state.ts` — archive/pin verbs over `ctx.workspaceRegistry`.
- `src/types.ts` — argument/result contracts and the structured error type.

## Further exploration

- Host Session business API: `@deepseek-ai/dsh-api-session-controller` (`ctx.sessionController`).
- Archive/pin semantics: `@deepseek-ai/dsh-workspace` (`ctx.workspaceRegistry`).
- Tool contract: `@deepseek-ai/dsh-tools` (`defineTool`, `ctx.tools.register`).
