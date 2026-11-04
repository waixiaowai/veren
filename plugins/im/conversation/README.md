# @veren/im-conversation

The conversation domain of the redesigned im family: durable rooms, members,
messages, room-exclusive sequences, and monotonic read cursors — the team's
single source of "what happened".

## When to use it

Use this package when the im family needs the fact store every other stage
reads: channel observations become durable room messages here, coordination
gates are judged here (inside the room write chain), and the panel reads rooms
and timelines from its `imConv` remote namespace. Do not add wake policy,
arbitration, or session logic here — those live in `@veren/im-coordination`
and `@veren/im-turn`.

## What it owns

- The `im_conversation` storage domain: rooms, room members, messages, per-room
  counters, read cursors, and the clientId idempotency index.
- `ConversationService` (`imConversation` token): post (idempotent by client
  id, gated), list, lastPeerMessage, markRead, unread, room/membership reads.
- The channel ingest: deterministic `chan:<provider>:<account>:<conversation>`
  room ids, sender seating, and provider redelivery as idempotent replay.
- The `imConv` remote namespace: rooms, roomMembers, messages, markRead.

## Events

- Emits `im/message-new` after every fresh commit (replays stay silent).
- Emits `im/room-updated` when a room's projection changes.
- Consumes `im/message-observed` from `@veren/im`.

## Configuration

- `channelAgentPreset` — the preset whose agent answers channel rooms; absent,
  the synthesized `agent:default` answers with the deployment persona.
