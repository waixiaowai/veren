# @veren/im-tool

The model-facing `im_*` tool family and the `im-collaboration` skill, over the
redesigned family faces (conversation, coordination, turn, directory, intake,
memory, bindings).

## When to use it

Use this package when an agent inside an IM room session must act on the
collaboration workspace: send into its own room behind the write gates, read
rooms and transcripts, browse the people directory, report self-introductions,
check the stranger-intake audit, and keep its own durable memory. Caller
attribution comes from the turn service's session map — a tool call always acts
as its own agent participant in its own room; the model never names a room.
Outside any im-managed session every room-scoped tool refuses with
`IM_NOT_FOUND`.

## Tools

| Tool | Effect |
|---|---|
| `im_bind` / `im_unbind` | account authorization lifecycle (never touches rooms) |
| `im_send` | one gated reply into the caller's own room; `held:true` is guidance (rewrite or stay quiet), never an error |
| `im_rooms` / `im_read` | read-only orientation; `im_read` advances the read cursor only, never the seen watermark |
| `im_people` / `im_person_save` | directory browse and create-or-enrich |
| `im_person_report` | record one unverified self-report and settle the intake question |
| `im_intake` | the stranger-question switch, counts, and audit |
| `im_remember` / `im_recall` | per-agent durable memory (pinned first, then recency) |

## Skill

`im-collaboration` carries the discipline the mechanisms enforce: the reply
contract (turn text IS the room message), HELD semantics (rewrite or stay
quiet, never echo), quiet discipline, and memory etiquette.
