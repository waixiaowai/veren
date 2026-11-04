# @veren/im-turn

The reply engine of the redesigned im family: one wake becomes one replayable
run — inbox loading, a per-agent preset-backed DSH session, the coordination
gates judged inside the post, hold loops with re-prompts, and a terminal state
that always carries its reason.

## When to use it

Use this package when the im family needs the thinking-and-replying stage:
consume `im/wake-request`, load what the agent has not seen, think through the
agent's own session, post through the gates, and record everything (run row +
event timeline in the `im_turn` domain). Do not decide who wakes — that is
`@veren/im-coordination`; do not register model tools — that is
`@veren/im-tool`.

## What it owns

- Durable run records (`im_turn` domain): `run-*` rows in the design's four
  states (running/completed/failed/skipped), an append-only event timeline, and
  the input fingerprint that absorbs duplicate wakes.
- Session provisioning: one DSH session per agent × room, resumed after
  restarts, carrying `meta.agentPreset` when the participant names a preset.
  The default agent's sessions run the deployment persona; the model/provider
  defaults come from `agentDefaultModel`.
- The prompt envelope: room, roster (humans first), unread messages, and the
  reply contract (the model's turn text IS the room message; staying quiet is
  legitimate).
- The hold loop: a HELD_FRESHNESS/HELD_VERBATIM refusal becomes a re-prompt
  carrying the unseen facts, up to three rounds, then the run lands as
  `skipped(held-out)`.
- Failure classification: model rate limits and quota exhaustion land as
  `skipped` with one deduplicated system notice per room per cause (six-hour
  window); everything else lands as `failed` with the reason.
- `TurnService` (`imTurn` token): run listing, event timelines, and
  `sessionPlaceOf(sessionId)` — the reverse lookup model tools use to
  attribute themselves to an agent participant and a room.

## Events

- Consumes `im/wake-request` from `@veren/im-coordination`.
- Emits `im/run-updated` on every run transition.

## Configuration

- `replyTimeoutMs` — the hard boundary for one session turn (default 120s).
