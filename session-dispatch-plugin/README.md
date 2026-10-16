# dsh-session-dispatch

English | [中文](README.cn.md)

## Summary

A Host-only DeepSeek Harness bundle that registers one model-callable tool, `session_dispatch`. It hands a prompt to another session and returns immediately; when that session is genuinely quiescent, the watcher delivers its closing assistant output back into the caller session as a follow-up message that wakes the caller.

Use it when a session must delegate long work to another session without blocking itself. `person-agent-tool-session`'s `session_prompt` with `wait: true` blocks the caller until the target goes idle, which was observed at 16 minutes in this deployment. Skip this package when the caller must read the result inside the same tool call.

## Table of Contents

- [What it registers](#what-it-registers)
- [The settlement model](#the-settlement-model)
- [Configuration](#configuration)
- [Build and test](#build-and-test)
- [Install into a profile](#install-into-a-profile)
- [Verify and uninstall](#verify-and-uninstall)
- [Known limitations](#known-limitations)

## What it registers

| Export | Value |
|---|---|
| `name` | `sessionDispatch` |
| `inject` | `['tools', 'agents', 'sessions', 'sessionController']` |
| `Config` | `@deepseek-ai/schemastery` schema; the Loader validates the row's `config` before `apply` |
| `apply` | Registers the guard canceller, then the tool. Both are `ctx.effect` contributions, so unload unwinds them in reverse and nothing leaks. |

`session_dispatch` arguments:

| Argument | Type | Meaning |
|---|---|---|
| `prompt` | string, required | Delivered to the target session as its own follow-up turn. Non-empty after trimming. |
| `sessionId` | string | Existing target session id. Exactly one of `sessionId` / `newSession`. |
| `newSession` | object | `{ cwd?, agentPreset? }`; creates the target through `ctx.sessionController.create`. |
| `report` | boolean, default `true` | `true` delivers the target's closing output back as a follow-up; `false` is fire-and-forget. |

The canonical result is the accepted-dispatch receipt and carries no waiting outcome: `{ sessionId, messageId, watchId, reporting }`. Failures throw `SessionDispatchError` with a stable `code`, matching the neighbouring session tools: `SESSION_DISPATCH_PROMPT_EMPTY`, `SESSION_DISPATCH_TARGET_MISSING`, `SESSION_DISPATCH_TARGET_CONFLICT`, `SESSION_DISPATCH_TARGET_UNRESOLVED`, `SESSION_DISPATCH_CREATE_FAILED`, `SESSION_DISPATCH_CAPACITY_REACHED`, `SESSION_DISPATCH_NO_CALLER`.

## The settlement model

The guard is modelled on the official subagent settlement observer, `watchLocalSettlement()` / `settlementState()` / `wake()` in `packages/subagent/subagent/src/manager.ts`. That code already separates two things this plugin must not conflate:

- **Synchronous notification.** `agent/inbox/inserted`, `agent/inbox/claimed`, and `agent/inbox/discarded` are `emit` events. Their only job is to wake the observer: `wake()` settles the current observation token and installs a fresh one.
- **Asynchronous quiescence.** The observer is a standing coroutine that awaits `await agent.whenIdle()` itself and then reads the token to decide:
  - `retry` — the token was renewed during the await, so state changed; re-evaluate.
  - `wait` — input is still pending; park on the next wake instead of spinning.
  - `ready` — genuinely quiescent; settle and report.

Three consequences follow, and each is a deliberate choice:

1. **The plugin never subscribes to `agent/status`.** `whenIdle()` is the authoritative quiescence signal: the public status stays `idle` while a maintenance task runs, so `status === 'idle'` does not mean `whenIdle()` resolved. There is no status listener to get that wrong.
2. **No timers, and no polling.** Nothing is scheduled. The observer blocks on `whenIdle()` or on the wake event, so it consumes no CPU while waiting.
3. **No `sessionId` comparison and no global listener.** The wake sources are registered on the target Agent's own context (`agent.ctx.on(...)`), which `@deepseek-ai/dsh-scope` routes by scope, so only that Agent's notifications arrive. Agent disposal unwinds the listeners with it.

Arming is one synchronous block with a fixed order: register the wake sources, run the delivery, start the observer. Delivery sits between registration and observation with no `await` in between, so every later inbox change is recorded in the token and the observer can neither miss a transition nor announce completion early. The report reads only derived history produced after that moment, so pre-existing output in the target session is never mistaken for this dispatch's result.

A report is delivered with `agent.followup()` on the live caller Agent, then `ctx.sessions.flush()`. When the caller Agent is no longer registered — after a Host restart, for example — delivery falls back to `ctx.sessionController.resolveAgent()` and restores it, the route `@deepseek-ai/dsh-schedule` uses. Reports use the `session-dispatch` message source kind, declared through `MessageSourceMap` in `src/types.ts`.

## Configuration

Every tunable is a validated `Config` field, overridable from the profile patch by row id (`session-dispatch`). A patch by id replaces the whole `config`, so restate every field that must survive.

| Field | Default | Meaning |
|---|---|---|
| `reportTemplate` | see `cordis.patch.yml` | Report body template. Must keep `{target_session_id}` and `{output}`; the pattern check rejects the row at load otherwise. Placeholders: `{target_session_id}`, `{watch_id}`, `{outcome}`, `{waited_ms}`, `{output}`. |
| `emptyOutputText` | `(the dispatched session produced no assistant text)` | Body for `{output}` when the target produced no assistant text. |
| `maxReportChars` | `4000` | Character cap for `{output}`; longer text is truncated with an ellipsis. |
| `maxConcurrentWatches` | `64` | Cap on concurrently armed watches; further reporting dispatches are rejected with `SESSION_DISPATCH_CAPACITY_REACHED`. |

There is no silence window and no wait deadline. An earlier revision had both; they were timers, and the settlement decision does not need one. A watch ends only on settlement, on the watched Agent leaving the registry (`target-gone`), or on plugin unload — which is why `maxConcurrentWatches` exists.

## Build and test

```powershell
cd C:\Users\imeep\Documents\cursour\session-dispatch-plugin
node link-deps.mjs                 # one-time: link @deepseek-ai/* into this package
node ..\node_modules\typescript\bin\tsc          # build -> dist/
node ..\node_modules\vitest\bin\vitest.js run    # tests
```

`link-deps.mjs` exists because this package sits outside the veren workspace globs, so pnpm creates no `node_modules` for it. Node and TypeScript resolve by real path, so without it the package would pick up the hoisted `cursour/node_modules/@deepseek-ai/*` copies while `@deepseek-ai/dsh-api-session-controller`'s declarations resolve a different `@deepseek-ai/cordis` inside the pnpm store. Two cordis instances mean the `declare module '@deepseek-ai/cordis'` Context merge lands on the other module and `ctx.sessionController` does not exist. The script is idempotent.

Tests live in `tests/` and run on vitest. `tests/support.ts` installs the real plugin into a real cordis `Context` (`ctx.plugin({ name, inject, apply }, config)`), with real `inject` resolution and real reverse-order effect disposal; only the external services are fakes. `agent.ctx` is a real scope minted by `createScope`, and status and inbox notifications go through the runtime's own `emitAgentEvent`, so scope routing is exercised rather than simulated.

## Install into a profile

The package installs into a profile directory; it never writes to the DSH checkout or to `~/.dsh`.

```powershell
node "C:\Users\imeep\Documents\cursour\session-dispatch-plugin\install-into-profile.mjs" `
  "C:\Users\imeep\.dsh_test_2\profiles\web"
```

The script backs up `package.json`, adds `dependencies["dsh-session-dispatch"] = "link:<this directory>"`, appends `dsh-session-dispatch` to `dsh.profile.bundles`, and creates a `node_modules` junction. It refuses to write into `~/.dsh`, refuses to run without a build output, is idempotent, and removes the junction with `rmdirSync` (never a recursive delete). Restart the Web GUI afterwards; only the bundle layer is reloaded at startup, and this plugin contributes no browser-side module.

Manual equivalent: add the dependency and the bundle entry to the profile `package.json`, then

```powershell
New-Item -ItemType Junction `
  -Path "C:\Users\imeep\.dsh_test_2\profiles\web\node_modules\dsh-session-dispatch" `
  -Target "C:\Users\imeep\Documents\cursour\session-dispatch-plugin"
```

## Verify and uninstall

1. Plugin manager: a row with id `session-dispatch` exists, `enabled` is true, and `fiberPhase` is not PENDING. A PENDING fiber means one of `tools` / `agents` / `sessions` / `sessionController` is missing.
2. Capability: `session_dispatch({ sessionId: "<id>", prompt: "summarize the repository" })` returns a receipt at once; the caller is not blocked. When the target settles, the caller session receives a `[SESSION DISPATCH REPORT]` follow-up.
3. Fire-and-forget: `report: false` returns `watchId: null` and sends nothing back.

Uninstall:

```powershell
node "C:\Users\imeep\Documents\cursour\session-dispatch-plugin\install-into-profile.mjs" --revert `
  "C:\Users\imeep\.dsh_test_2\profiles\web"
```

Then restart the Web GUI.

## Known limitations

- A watch does not survive a Host restart or plugin unload: `dispose()` cancels pending watches without reporting. Only a cross-restart report would need `ctx.schedule`, which persists a task row and refuses sessions owned by a delegated child.
- There is no wait deadline, so a target that never becomes quiescent and is never disposed stays watched until the plugin unloads. `maxConcurrentWatches` bounds how many such watches can accumulate.
- If the caller session is owned by a delegated child and is no longer live, the `resolveAgent` fallback fails, the report is logged as a warning, and it is dropped.
- `newSession` delegates to `ctx.sessionController.create`; preset resolution and workspace placement are that service's concern and are not exercised here.
- The report is one text body: the last non-empty derived assistant message produced after delivery. It does not assemble a turn, attach tool-call summaries, or include parked input.
