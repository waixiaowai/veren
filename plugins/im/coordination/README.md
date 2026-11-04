# @veren/im-coordination

The arbitration domain of the redesigned im family: deterministic wake triage,
the low-priority wake budget, per-agent seen watermarks, and the write gates
(freshness and verbatim) that keep multi-agent rooms civil.

## When to use it

Use this package when the im family needs the decisions-and-refusals layer:
who wakes up (and who deliberately stays silent), whether a draft may still be
posted, and what a refusing gate hands back so the author can rewrite. Do not
generate content here — coordination produces verdicts only. Do not start a
turn anywhere else: `im/wake-request` emitted by this package is the family's
only wake source.

## What it owns

- Deterministic triage: direct human messages wake the room's agent, agent
  chatter fails closed unless a name is mentioned, group chatter stays quiet
  unless a human names an agent. The design's cheap-model judgment is a
  documented v1 deferral.
- The low-priority wake budget (per process per minute, default 20).
- Seen watermarks (domain `im_coordination`): the freshness gate's baseline;
  missing watermarks fail open; watermarks only move forward.
- The write gates, judged inside the conversation write chain via
  `gatePost(...)` handed to `conversation.post(input, gate)`: freshness (reject
  with up to 8 unseen lines attached) and verbatim (reject a whitespace-collapsed
  duplicate). `preflightReply` offers the read-only verdict.

## Events

- Emits `im/wake-request` — the only legitimate way a turn starts.
- Consumes `im/message-new` from `@veren/im-conversation`.

## Configuration

- `lowPriorityWakesPerMinute` — the synthetic fan-out budget (default 20).
