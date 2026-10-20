# @veren/person-agent-tool-session

Model-facing session maintenance tools for the Person Agent preset: `session_create`, `session_rename`, `session_dispatch` over `ctx.sessionController`, plus `session_archive`, `session_unarchive`, `session_pin`, `session_unpin` over `ctx.workspaceRegistry`. Session forking is owned by the `session-fork-enhanced` plugin (`session_fork_with_options`, a strict superset of the former `session_fork`); this plugin no longer registers any fork tool.

## Use this package

Use it when a Person Agent session must create, dispatch work to, or reorganize sibling sessions — start one with a preset/model/title, hand it its task (including the first message) without blocking, archive or pin sessions. Skip it when sessions must never mutate the session roster.

## Minimal configuration

The preset composes it as a child row (no `cordis.patch.yml` needed; the loader loads it by package name):

```yaml
- id: tool-session
  name: '@veren/person-agent-tool-session'
  config:
    allowCreate: true
    allowDispatch: true
    allowArchive: true
    allowPin: true
    maxReportChars: 4000
    maxConcurrentWatches: 64
```

## Tools

| Tool | Arguments | Effect |
| --- | --- | --- |
| `session_create` | `title?`, `presetId?`, `provider?`+`model?`, `workspaceId?` (omitted inherits the caller's workspace) | Creates an ordinary session, then installs the model selection and title in that order. The session starts empty; the new id is reported, never switched to. |
| `session_dispatch` | `prompt`, `sessionId?` xor `newSession?`, `report?`; inside `newSession`, `workspaceId?` (omitted inherits the caller's workspace), `agentPreset?` | Delivers one prompt into the session through the host's standard enqueue path (`resolveAgent` → `agent.followup`) and **returns at once**; it never waits for that session. With `report: true` (the default) a guard observes the target until it is genuinely quiescent and then delivers its closing output back into the calling session as a follow-up message, which names the dispatch it answers. At most one dispatch per target may be outstanding: a dispatch to a session whose report has not arrived yet is refused with `SESSION_DISPATCH_WATCH_BUSY`. With `report: false` nothing comes back. This is how the bridge persona hands a created session its task. |
| `session_rename` | `sessionId`, `title` | Retitles one session durably. |
| `session_archive` | `sessionId`, `stopActivity?` | Moves a session into the archive set; with `stopActivity`, running work is stopped instead of refusing. |
| `session_unarchive` | `sessionId` | Restores an archived session to its recorded position. |
| `session_pin` / `session_unpin` | `sessionId` | Maintains the registry-global pin set. |

`session_create` and `session_dispatch`'s `newSession` accept only `workspaceId`;
`cwd` is gone because every new session belongs to a workspace. An explicit
`workspaceId` wins. When it is omitted, the session inherits the **calling
session's workspace**. If the caller belongs to none, creation fails with
`SESSION_CREATE_WORKSPACE_UNKNOWN` and asks for an explicit `workspaceId`; it
never falls back to the deployment default directory or the ungrouped bucket.
Passing `cwd` is rejected with `SESSION_CREATE_CWD_REMOVED` before schema
validation and points at `workspaceId`.

Errors are structured with stable codes (`SESSION_TITLE_EMPTY`, `SESSION_CREATE_WORKSPACE_UNKNOWN`, `SESSION_CREATE_CWD_REMOVED`, `SESSION_MODEL_SELECTION_INCOMPLETE`, `SESSION_DISPATCH_NO_CALLER`, `SESSION_DISPATCH_PROMPT_EMPTY`, `SESSION_DISPATCH_TARGET_MISSING`, `SESSION_DISPATCH_TARGET_CONFLICT`, `SESSION_DISPATCH_TARGET_NOT_FOUND`, `SESSION_DISPATCH_CREATE_FAILED`, `SESSION_DISPATCH_CAPACITY_REACHED`, `SESSION_DISPATCH_WATCH_BUSY`) and machine-readable fields; registry-level refusals (active session, archived pin) propagate from the host seams as-is.

## Settlement reporting

`session_dispatch` replaces the former `session_prompt`, whose `wait: true` blocked the caller until the target went idle (16 minutes was observed in this deployment) and whose `wait: false` was exactly the non-blocking subset of the new tool. One dispatch action has no reason to exist as two tools.

The guard is modelled on the official subagent settlement observer, `watchLocalSettlement()` / `settlementState()` / `wake()` in `@deepseek-ai/dsh-subagent`'s `src/manager.ts`. That code separates a synchronous notification from an asynchronous quiescence, and this plugin keeps the same split:

- **Synchronous wake.** `agent/inbox/inserted`, `agent/inbox/claimed`, and `agent/inbox/discarded` registered on the target Agent's own context (`agent.ctx.on(...)`) each settle and renew an observation token. `@deepseek-ai/dsh-scope` routes those events by scope, so only that Agent's notifications arrive and no `sessionId` comparison exists anywhere.
- **Asynchronous quiescence.** A standing coroutine awaits `agent.whenIdle()` and then reads the token: `retry` when it was renewed during the await, `wait` when input is still pending (parking on the next wake instead of spinning), `ready` to finalize. `whenIdle()` is the authority because the public status stays `idle` while a maintenance task runs; the guard therefore subscribes to no `agent/status` and schedules no timer.

Two message kinds are declared, deliberately distinct: `session-dispatch` (`form: 'relay'`) for the prompt the caller wrote, and `session-dispatch-notice` (`form: 'notice'` + `summary`) for the runtime's own account of the target's outcome. Merging them would credit the target with words it never produced.

### Attributing a notice

Every notice opens with the outcome line and then a second line naming the dispatch it answers: the `watchId` that the receipt, the start event, and the end event already use, the `messageId` of the enqueued prompt, and the prompt itself folded and truncated to one bounded line. The same `watchId` and `messageId` ride as fields of the notice's `session-dispatch-notice` source, so a host or UI pairs a notice with its dispatch without parsing prose. Notices written before those fields existed carry neither, so both are optional on read.

### One outstanding watch per target

A watch's verdict is the **whole target session's** quiescence, so two watches on one target settle on the same closing output at the same instant: the caller receives two byte-identical notices answering neither dispatch, and the earlier task's result is never delivered — with nothing in the transcript revealing the loss. The guard registry owns that rule: `arm()` checks the ledger and registers the watch inside one synchronous block, so a second reporting dispatch to that target is refused with `SESSION_DISPATCH_WATCH_BUSY`, naming the pending watch. `deliverGuarded()` holds the same line for a `report: false` dispatch. Either way the refusal happens **before** delivery, so the refused prompt never enters the target.

That covers `report: false` dispatches as well: a prompt accepted into a watched session silently replaces whatever the pending notice will describe as the target's closing output.

Waiting for the notice — which names its dispatch — and then dispatching again is the supported way to hand one session several tasks in a row; a target with no unsettled watch accepts a dispatch normally.

### Why the target stopped

The notice states *why*, using the official `SubagentStopReason` vocabulary so the model reads the same words across both delegation routes:

| Outcome | Notice line |
| --- | --- |
| `completed` | "finished and will do no further work unless you send it more." |
| `aborted` | "was stopped before it finished." |
| `max-tokens` | "ran out of room before it finished." |
| `refusal` | "declined the task." |
| `error` | "failed before it finished." |
| `target-gone` | "left the runtime before it was observed settling; its work may be incomplete." |

The accounting reuses the official `foldConsumedWork` from `@deepseek-ai/dsh-agent`, because turn boundaries alone cannot answer this: a turn that stops before its first step has exactly the shape of a balanced no-op turn, so reading turns in isolation either credits cut-short work as finished or convicts every no-op. The switch over its result mirrors the official `epochStopReason`. A recorded failure wins over a cancellation, and a failure superseded by a later committed turn stops deciding the outcome (the official `observeLocalFailure` rule). Two semantics are never collapsed: `refusal` means a pre-step rejection discarded claimed input, so the caller must not treat the task as done, and an unnameable outcome is reported as a failure rather than as success.

### What is folded, and from where

The guard subscribes to `session/event` on the target's own scope and folds three things from that suffix: the official `foldConsumedWork` accounting, the closing output, and failure supersession. `session/event` records without waking — only the three inbox events and `agent/error` wake the observer, exactly as the official observer does.

The closing output uses the official `AssistantOutputFold` rule: the last non-empty assistant message, where an empty-content (usage-only) message never replaces earlier output, falling back to the accumulated stream text. The official class lives in `@deepseek-ai/dsh-subagent`, which is not resolvable in this workspace, so its semantics are implemented in `watch.ts` reusing the official `joinAssistantStreamText`.

Before deciding, the guard remembers the target's session seq, best-effort flushes it (the official `flushFinalState` move), and then decides **again**: if the state or the seq moved while the flush was in flight, it goes back around instead of reporting the conclusion it reached before the flush. A flush failure only warns and never blocks the notice.

### Telling the target to report back

When the target can actually reply, the dispatch appends the official `withContinuableReturnGuidance` text after the caller's prompt, so the target itself sends a self-contained result instead of relying on the caller reading its transcript.

The gate is deliberate and narrow: `send_message` permits only **adjacent lineage** — a sender may target its direct parent, and a resident continuable child may target its direct parent — while an ordinary dispatched session is a root session with no parent lineage. The guidance is therefore appended only when the target's `parentSession` is exactly the caller **and** `send_message` is visible in the target's scope. Otherwise nothing is appended, rather than instructing the target to call a tool that must refuse it.

### Observing a dispatch

Every accepted dispatch emits `session-dispatch/start` on the caller's scope; a reporting dispatch emits `session-dispatch/end`, paired by `watchId`, once its notice has been delivered. The end event carries the outcome and the closing output, so a host or UI can show "dispatched, in flight" and then the result without reading Session logs. A fire-and-forget dispatch emits only a start, because it has no settlement to observe.

### Not implemented: durable dispatch records

The official catalog appends a `subagent/catalog` event to the parent's Session so completed children stay discoverable. The harness's equivalent for a plugin is `appendPluginRecord`, which writes an `ignorable` record that readers retain and skip and that survives fork and resume. Two obstacles block it here:

- `appendPluginRecord` does **not exist** in the `@deepseek-ai/dsh-session@0.2.0-rc.2` this plugin resolves at runtime (only in a newer checkout build), so calling it would fail.
- Appending a private event type through `session.append` instead would be **unsafe**: the persistence read path refuses a log whose event type is outside `KNOWN_SESSION_EVENT_TYPES` unless the event carries `ignorable: true`, and that set is generated from the harness repository — so the caller's Session would refuse to load afterwards.

The dispatch is nevertheless durably recorded already: the harness writes `tool/call` and `tool/result` events for `session_dispatch` itself, and the receipt in that result carries `sessionId`, `messageId`, and `watchId`. Those events survive restart and fork and are readable with the Session log tools.

### What the official has that this cannot reuse

Two official result capabilities do not apply to a session this plugin merely observes, and copying them would have invented surface with no producer:

- **`structured` (`outputSchema`)** is a *provider request* field, not a parameter of the model-facing `subagent` tool. The manager attaches it by injecting a structured-submission runtime into the **child's own context** (`attachStructuredRuntime(childCtx, …)` in `manager.ts`), and `out-of-process.ts` marks external providers as not supporting it. Offering it here would mean injecting a submission tool and a terminal guard into a session that belongs to the user.
- **`diagnostic`** is produced only by external providers; it is bounded by `MAX_SUBAGENT_DIAGNOSTIC_BYTES` in `out-of-process.ts`. A local activation's `captureLocalResult` never sets it, so a plugin watching a local session has no producer to read from.

A notice is delivered with the official `sendWaking` rule: `followup` when the caller is idle (its own turn), `steer` when the caller is running (joined at its nearest step boundary, so a busy caller is not forced into an extra turn). When the caller Agent is no longer registered — after a Host restart — delivery falls back to `ctx.sessionController.resolveAgent`, the route `@deepseek-ai/dsh-schedule` uses.

## Understand the implementation

- `src/index.ts` — plugin identity, toggles, and effect-managed registration (reverse-order cleanup, HMR safe).
- `src/tools-management.ts` — create/rename over `ctx.sessionController`; the shared workspace resolver owns "explicit workspaceId or inherit the caller's workspace" and the explicit rejection of the removed `cwd`.
- `src/tools-dispatch.ts` — `session_dispatch` over `resolveAgent` + the settlement guard; a new-session `workspaceId` uses the same resolver and `cwd` guard.
- `src/watch.ts` — the settlement guard: inbox wake sources, the observation token, and the closing-output selection.
- `src/notice.ts` — the two message kinds, the settlement notice, and `sendWaking` delivery.
- `src/tools-state.ts` — archive/pin verbs over `ctx.workspaceRegistry`.
- `src/types.ts` — argument/result contracts and the structured error type.

## Known limitations

- A watch does not survive plugin unload: the guard is owned by the registration effect, so unloading cancels pending watches without reporting.
- There is no wait deadline. A target that never becomes quiescent and is never disposed stays watched until unload; `maxConcurrentWatches` bounds how many such watches accumulate.
- The guard buffers the target's session events for the watch's lifetime. Events are shared frozen values, so this is an array of references rather than a copy, but a very long-running target still grows it until it settles.
- The guard is an outside observer: it re-checks the session seq before finalizing, but it cannot close the target's input admission the way the official manager closes a child's (`runMaintenance`). This plugin's own second dispatch onto the target is refused while a watch is pending, but input arriving through any other route — a human typing in the GUI, a scheduled follow-up, another plugin — still lands, and no later watch picks it up, so the closing output may then describe work this dispatch never asked for.
- A target with an unsettled watch cannot receive another `session_dispatch`. Combined with the bullet above about targets that never become quiescent, such a target stays undispatchable through this tool until its watch settles or the plugin unloads; the other session tools and every route outside this plugin keep working.
- The guard does not park a notice on a closing caller the way the official manager uses `parent.inject` when the parent subtree is shutting down; an undeliverable notice is logged and dropped.
- Unnameable outcomes and unnameable `turn/end` reasons are reported as `error`, never as success; that arm is reachable only through a merge-extensible extension.

## Further exploration

- Host Session business API: `@deepseek-ai/dsh-api-session-controller` (`ctx.sessionController`).
- Archive/pin semantics: `@deepseek-ai/dsh-workspace` (`ctx.workspaceRegistry`).
- Tool contract: `@deepseek-ai/dsh-tools` (`defineTool`, `ctx.tools.register`).
- Settlement observer this guard mirrors: `@deepseek-ai/dsh-subagent` (`src/manager.ts`, `src/continuation-messages.ts`).
