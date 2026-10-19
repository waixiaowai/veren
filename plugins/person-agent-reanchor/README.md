# @veren/person-agent-reanchor

English | [中文](README.cn.md)

## Summary

A Person Agent session is supposed to judge and delegate, but a long conversation drifts: the persona sits at the far head of the system prompt, the working-memory snapshots age, and the bridge starts reading code and writing files itself. This plugin is the periodic re-anchor. It reads the session log, and when the tail shows **N consecutive steps whose only tool calls inspect or analyze, with no dispatch**, it appends one short notice about that fact to the next model request.

The notice is an **append-only session message**, added through the `agent/pre-step` decision. It never rewrites the system prompt, so the exact-prefix cache survives: `deepseek-v4-pro` does not declare `systemPromptUpdate: 'in-history'`, and an in-place prompt change mid-session would make every step pay for the whole history again.

Skip this plugin when the session is supposed to do hands-on work; it exists for a delegating bridge, not a worker.

## What triggers

At every step boundary the plugin scans the log backwards:

- Tool calls are grouped by `(turn, step)`.
- A step counts only when **every** call in it is in `analysisTools`.
- Counting stops at the first step containing any other call, at human input, and at the previous re-anchor notice (so notices are spaced by N new analysis steps, not repeated every step).
- A dispatch earlier in **this turn** suppresses the notice entirely; a dispatch in an earlier turn does not, because this turn is still self-working.
- Dispatch counts keep scanning the whole session, so the notice can say whether this session has ever handed work off.

The notice quotes live numbers (consecutive steps, analysis calls, distinct `file_path` values, dispatch count), rotates through three phrasings, and is roughly 100 tokens. Two consecutive notices are never the same text.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | `false` registers no listener; the plugin is fully off |
| `threshold` | `3` | Consecutive analysis-only steps before one notice |
| `analysisTools` | `read`, `read_image`, `glob`, `grep`, `web_search`, `web_fetch` | Calls that only inspect or analyze |
| `dispatchTools` | `session_dispatch` | Calls that hand work to another session |

The Person Agent preset mounts this row with `withReanchor: true` and passes `reanchorThreshold`. Set `withReanchor: false` on the preset row to remove the row entirely, or set this plugin's `enabled: false` to keep the row but disable it. Empty tool lists and a non-positive threshold fail loud at load.

## Model Experience

The notice is a user-role message with source kind `person-agent-reanchor`, `form: 'notice'`, and a one-line summary for the UI. It reaches the model appended after the host's admitted messages, so it is the last thing the model reads before choosing the next step. It adds roughly 100 tokens when it fires, and zero on every other step.

#### KV Cache effect

No effect on the cached prefix: the system prompt is static and the notice is appended after existing history. The plugin deliberately does not contribute a system-prompt section.

## Known Limitations and Deferred Work

- The analysis set is by tool name. A tool renamed by another composition stops counting as analysis until `analysisTools` is updated.
- A step with no tool calls breaks the chain; the plugin does not try to infer intent from assistant text.
- The notice states a fact; it cannot force a delegation. A model that ignores the reminder still has no `edit` tool in the Person Agent preset, which is the separate structural guard.
- The plugin is stateless by design: it re-reads the log at every step. Consecutive-step counting stops at the first break, while the session-wide dispatch and notice counts still walk the log; both are cheap array reads beside a model request, but the walk is linear in log length.

## Dev

```bash
pnpm install
pnpm build
pnpm test
```

Tests include a scripted fake adapter that drives a 30-step, ~420k-character session: the re-anchor appears at steps 4, 7, … 28 with the plugin mounted, and never without it.
