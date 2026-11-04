# @veren/im

The provider-neutral core of the redesigned im family: the channel contract and
registry, the participant roster, agent memory, the people directory, stranger
intake, and account authorization — the mouth of the fact pipeline.

## When to use it

Use this package when a DSH host must expose one IM abstraction to multiple
channels: providers register one `ImProvider` each, every inbound observation
leaves as one `im/message-observed` event, and the downstream domains
(`@veren/im-conversation`, `@veren/im-coordination`, `@veren/im-turn`) turn
those observations into durable facts, wake decisions, and replies.

Do not add channel-specific branches here — a channel belongs in its own
provider package (`@veren/im-wechat` in this repository). Do not add wake
policy here — the core ships no routing, no queue, and no session code since
the 3.0 redesign.

## Package set

See `docs/redesign-mapping.md` (in the family root) for the full
Cumora→DSH mapping. The family:

| Package | Role |
|---|---|
| `@veren/im` | Contract, `ImRegistry`, `ImError`, roster, memory, people, intake, accounts |
| `@veren/im-conversation` | Rooms, sequences, read cursors, channel ingest |
| `@veren/im-coordination` | Triage, budgets, watermarks, write gates |
| `@veren/im-turn` | Run records, per-agent preset sessions, hold loops |
| `@veren/im-tool` | Model-facing `im_*` tools + the collaboration skill |
| `@veren/im-wechat` | WeChat iLink provider |
| `@veren/im-hub` | CMS cloud-gateway provider |
| `@veren/im-ui` | Web panel (conversations / cloud / intake) |
| `@veren/im-testkit` | Fake provider and reusable test seams |

## Contract

The contract is the source of truth:

- `ImProvider` / `ImService`: the six operations every channel implements
  (`start`, `stop`, `accounts`, `listen`, `bind`, `send`, optional
  `removeAccount`).
- `ImRegistry` (`im` token): registration with reconciliation triggers,
  `observeInbound` (people bookkeeping + cloud push), and the cloud-directory
  attach.
- `ImError`: stable codes in two segments — `IM_*` for the channel scope and
  the design's core-loop codes (`CONVERSATION_NOT_FOUND`, `HELD_*`, `TURN_*`,
  …) — plus a `retryable` judgment per code.
- `ImParticipants` (`imParticipants` token): the roster. Agents are DSH
  presets (`agent:<presetId>`), the owner is `human:owner`, external humans
  come from the people directory.
- `ImMemory` (`imMemory` token): durable agent memories, recency-first recall
  with pinned entries on top, project (DSH workspace) scoping.
- `ImPeople` / `ImDirectory`: the strict name-resolution directory with
  unverified self-reports, plus the model-facing directory face.
- `ImStrangerIntake` (`imIntake` token): the once-per-stranger question with
  its rate limits and audit trail.
- `ImBindings` (`imBindings` token): account authorization attempts and the
  durable account table.
- Channel room ids: `chan:<provider>:<account>:<conversation>` (deterministic,
  restart-stable) and `conv:*` for internal rooms.

## Events

- Emits `im/message-observed` — one channel observation, exactly once.
- Consumes nothing.

## Configuration

- `ownerName` — the owner human's display name in prompts and rosters.
- `roster` — the preset-backed agents of this workspace.
- `strangerIntake` — the automatic stranger question (enabled, reply window,
  hourly cap, minimum gap).
