# @veren/person-agent-tool-session

Model-facing session maintenance tools for the Person Agent preset: `session_create`, `session_rename`, `session_fork`, `session_dispatch` over `ctx.sessionController`, plus `session_archive`, `session_unarchive`, `session_pin`, `session_unpin` over `ctx.workspaceRegistry`.

## Use this package

Use it when a Person Agent session must create, dispatch work to, or reorganize sibling sessions — start one with a preset/model/title, hand it its task (including the first message) without blocking, fork a completed turn, archive or pin sessions. Skip it when sessions must never mutate the session roster.

## Minimal configuration

The preset composes it as a child row (no `cordis.patch.yml` needed; the loader loads it by package name):

```yaml
- id: tool-session
  name: '@veren/person-agent-tool-session'
  config:
    allowCreate: true
    allowDispatch: true
    allowFork: true
    allowArchive: true
    allowPin: true
    maxReportChars: 4000
    maxConcurrentWatches: 64
```

## Tools

| Tool | Arguments | Effect |
| --- | --- | --- |
| `session_create` | `title?`, `presetId?`, `provider?`+`model?`, `workspaceId?` xor `cwd?` | Creates an ordinary session, then installs the model selection and title in that order. The session starts empty; the new id is reported, never switched to. |
| `session_dispatch` | `prompt`, `sessionId?` xor `newSession?`, `report?` | Delivers one prompt into the session through the host's standard enqueue path (`resolveAgent` → `agent.followup`) and **returns at once**; it never waits for that session. With `report: true` (the default) a guard observes the target until it is genuinely quiescent and then delivers its closing output back into the calling session as a follow-up message. With `report: false` nothing comes back. This is how the bridge persona hands a created session its task. |
| `session_rename` | `sessionId`, `title` | Retitles one session durably. |
| `session_fork` | `sessionId`, `atSeq?` | Copies an exact completed-turn prefix into a new session. |
| `session_archive` | `sessionId`, `stopActivity?` | Moves a session into the archive set; with `stopActivity`, running work is stopped instead of refusing. |
| `session_unarchive` | `sessionId` | Restores an archived session to its recorded position. |
| `session_pin` / `session_unpin` | `sessionId` | Maintains the registry-global pin set. |

Errors are structured with stable codes (`SESSION_TITLE_EMPTY`, `SESSION_CREATE_LOCATION_CONFLICT`, `SESSION_MODEL_SELECTION_INCOMPLETE`, `SESSION_DISPATCH_NO_CALLER`, `SESSION_DISPATCH_PROMPT_EMPTY`, `SESSION_DISPATCH_TARGET_MISSING`, `SESSION_DISPATCH_TARGET_CONFLICT`, `SESSION_DISPATCH_TARGET_NOT_FOUND`, `SESSION_DISPATCH_CREATE_FAILED`, `SESSION_DISPATCH_CAPACITY_REACHED`) and machine-readable fields; registry-level refusals (active session, archived pin) propagate from the host seams as-is.

## Settlement reporting

`session_dispatch` replaces the former `session_prompt`, whose `wait: true` blocked the caller until the target went idle (16 minutes was observed in this deployment) and whose `wait: false` was exactly the non-blocking subset of the new tool. One dispatch action has no reason to exist as two tools.

The guard is modelled on the official subagent settlement observer, `watchLocalSettlement()` / `settlementState()` / `wake()` in `@deepseek-ai/dsh-subagent`'s `src/manager.ts`. That code separates a synchronous notification from an asynchronous quiescence, and this plugin keeps the same split:

- **Synchronous wake.** `agent/inbox/inserted`, `agent/inbox/claimed`, and `agent/inbox/discarded` registered on the target Agent's own context (`agent.ctx.on(...)`) each settle and renew an observation token. `@deepseek-ai/dsh-scope` routes those events by scope, so only that Agent's notifications arrive and no `sessionId` comparison exists anywhere.
- **Asynchronous quiescence.** A standing coroutine awaits `agent.whenIdle()` and then reads the token: `retry` when it was renewed during the await, `wait` when input is still pending (parking on the next wake instead of spinning), `ready` to finalize. `whenIdle()` is the authority because the public status stays `idle` while a maintenance task runs; the guard therefore subscribes to no `agent/status` and schedules no timer.

Two message kinds are declared, deliberately distinct: `session-dispatch` (`form: 'relay'`) for the prompt the caller wrote, and `session-dispatch-notice` (`form: 'notice'` + `summary`) for the runtime's own account of the target's outcome. Merging them would credit the target with words it never produced.

A notice is delivered with the official `sendWaking` rule: `followup` when the caller is idle (its own turn), `steer` when the caller is running (joined at its nearest step boundary, so a busy caller is not forced into an extra turn). When the caller Agent is no longer registered — after a Host restart — delivery falls back to `ctx.sessionController.resolveAgent`, the route `@deepseek-ai/dsh-schedule` uses.

## Understand the implementation

- `src/index.ts` — plugin identity, toggles, and effect-managed registration (reverse-order cleanup, HMR safe).
- `src/tools-management.ts` — create/rename/fork over `ctx.sessionController`.
- `src/tools-dispatch.ts` — `session_dispatch` over `resolveAgent` + the settlement guard.
- `src/watch.ts` — the settlement guard: inbox wake sources, the observation token, and the closing-output selection.
- `src/notice.ts` — the two message kinds, the settlement notice, and `sendWaking` delivery.
- `src/tools-state.ts` — archive/pin verbs over `ctx.workspaceRegistry`.
- `src/types.ts` — argument/result contracts and the structured error type.

## Known limitations

- A watch does not survive plugin unload: the guard is owned by the registration effect, so unloading cancels pending watches without reporting.
- There is no wait deadline. A target that never becomes quiescent and is never disposed stays watched until unload; `maxConcurrentWatches` bounds how many such watches accumulate.
- The closing output is the last non-empty derived assistant message produced after the delivery. The official `finalAssistantOutput` reads an event suffix and falls back to the accumulated stream text; `Session.snapshotEvents` is deprecated ("new calls are prohibited"), so this applies the same selection rule to the non-deprecated derived history and has no stream fallback.

## Further exploration

- Host Session business API: `@deepseek-ai/dsh-api-session-controller` (`ctx.sessionController`).
- Archive/pin semantics: `@deepseek-ai/dsh-workspace` (`ctx.workspaceRegistry`).
- Tool contract: `@deepseek-ai/dsh-tools` (`defineTool`, `ctx.tools.register`).
- Settlement observer this guard mirrors: `@deepseek-ai/dsh-subagent` (`src/manager.ts`, `src/continuation-messages.ts`).
