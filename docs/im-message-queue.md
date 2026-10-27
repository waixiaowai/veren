# IM Message-Queue Semantics (WeChat path rework)

> Status: this file is the spec baseline of the 2.1.8 rework. When code and this
> file disagree, change this file first.
> Chinese version: [im-message-queue.cn.md](./im-message-queue.cn.md).

## Concept

The user faces only "send a message → get a reply". Sessions are no longer a
user-facing concept: the gateway privately holds one session per conversation
(lazily created, resumed on demand at consume time), and the user neither needs
to nor can bind manually. The message path is queue semantics:

```
receive → enqueue (idempotent) → [queue ack (only when busy)] → consume (private session) → reply → terminal state
```

## Delivery-semantics table

Every row cites a real incident from this repository as its reason to exist.

| Dimension | Decision | Evidence (real incident / fact) |
| --- | --- | --- |
| Delivery guarantee | **At-least-once**: a crash mid-`consuming` requeues on restart and consumes again; duplicate replies are possible (auditable in the log), silence never is | messages vanishing over the restart window (before the gateway resume fix, every message died) — duplicates beat silence |
| Ordering | FIFO per conversation (received_at order), at most one in flight; conversations proceed in parallel | the in-memory serialization chain already had this semantics; after the binding removal the queue carries it explicitly |
| Ack timing | When the conversation already has in-flight/queued work, a new message gets an immediate "received, queued behind N" reply; when idle, no ack — the result itself is the reply | measured model turns take 30s+; an un-acked queue is indistinguishable from vanishing |
| Retry / dead-letter | Consumption failures requeue automatically; after 3 total attempts the row becomes `dead` and the user receives one failure notice | `sendmessage -2` (frequency control / stale context) and model turn timeouts (replyTimeoutMs=120s) are known failure sources; today failures only reach the log |
| Idempotency | `message_id` is a durable unique key; re-enqueueing is a no-op | the monitor `seen` ring is recent-only and in memory, gone on restart; iLink offline delivery is not guaranteed duplicate-free |
| Durability | The queue table (`messages`) and the session map (`conversation_sessions`) persist in the `im` storage domain; consumption resumes after restart | the registry `early[]` in-memory buffer forgets everything on restart — one root cause of vanishing messages |
| Session ownership | `conversation_id → session_id` private map, lazily created; resumption is handled inside `gateway.ask`; no rotation | after a bot re-pairing the account drifts while `conversation_id` stays stable (proven by the retarget mechanism); sessions are invisible to users, so rotation is not needed |
| Fairness | Conversations are naturally parallel (one chain each, no global queue head); strict serial within one conversation | several humans share one bot; one heavy user must not block the others |

## Deletion list (no dual-track compat)

- The `bindings` table and the `ImBinding` contract, plus the service and remote
  faces of link / unbindBinding / settings
- The bindings tab / unlinked-list UI (replaced by a "Conversations" tab showing
  queue state per conversation)
- The `im_link` model tool (binding is no longer an action anyone can take)
- The `autoCreateSession` config switch (sessions are always private and
  automatic; the switch disappears)

Unchanged: the account authorization wizard (account-level QR), the people
directory, intake, and the account lifecycle (retirement / reconciliation).
`retargetAccount` / `migrateBindings` die with the binding table; account
retirement migrates sessions / messages / addresses instead (the session map is
keyed by conversation_id alone and needs no migration).

## Invariants (asserted by property tests)

1. **No loss**: every inbound message reaches a terminal state `replied` /
   `failed` (user notified) / `dead` (user notified); no outcome is a violation.
2. **No duplicates**: one row per `message_id`; re-enqueueing is a no-op.
3. **Order**: consumption order per conversation equals received_at order; at
   most one `consuming` row per conversation.
4. **Routable**: replies only travel through the message's own account path;
   in-flight rows of a retired account migrate with it.
5. **Self-heal**: after a restart every `consuming` row returns to `queued`;
   failed rows retry by attempts until `dead`.

## Acceptance protocol (not judged by us)

1. Property tests: random interleavings of [enqueue, consume, crash
   mid-consume, duplicate enqueue, reply-send failure] assert the invariants.
2. Three hard drills: kill the host mid-consume — no silent messages after
   restart; the same id delivered twice — exactly one reply; three rapid
   messages — three in-order replies.
3. Scripted terminal-state audit: capture file + `messages` table prove every
   message_id has an outcome.
4. Browser automation asserts the new UI shape (conversations tab exists,
   bindings tab gone).
5. Days of use across restarts, zero vanishing messages.
