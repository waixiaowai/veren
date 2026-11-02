# taskhub Wire Protocol Contract v1

> Status: **pinned (external shape)**. This file is the **single wire contract** between cms `internal/taskhub`
> and the dsh-superagent node-side bridge; both implementations pin the literal JSON examples below
> (contract tests compare them verbatim). Change this document first, then both sides.
> Basis: `docs/superagent-task-router.md` (task book, rulings D1-D7).
> Precedent: `D:\cms\internal\wsgw\command.go` pins `plugins/cms-bridge/src/protocol.ts` in its header — same discipline.

## 1. Transport & auth (existing face, zero additions)

- Endpoint: `GET /v1/ws` (existing wsgw upgrade, gorilla).
- Auth: handshake carries `Authorization: Bearer <cms user API Key>` (wsgw tri-state chain; rejected credential = HTTP 401 or close 4401 → client parks awaiting reconfiguration, no pointless reconnects).
- Frames: JSON text frames, four shapes:
  - down `{type:'command', id, action, payload}`
  - up `{type:'result', id, ok, result?}` / `{type:'result', id, ok:false, code, message}`
  - up `{type:'event', id, name, payload, ts}`; optional down `{type:'event_ack', id}`
  - The up-event `id` is client-generated (`evt_` + random); the server audits raw frames into `ws_messages` (existing behavior).

## 2. Worker registration & heartbeat (taskhub semantics, node → cms)

A node reports **two** registration events after connecting (or when its own config changes); a heartbeat every 60s while running.

**First `node.identity`** (the existing wsgw connection-registry face — the `ws_nodes` UPSERT is the precondition for dispatch addressing; without it a node can never be dispatched to):

```json
{ "type": "event", "id": "evt_00", "name": "node.identity", "ts": 1762000000000,
  "payload": { "nodeId": "3f2a…uuid", "nodeName": "Gitea code worker", "nodeDescription": "Writes Go/TS, pushes to Gitea", "nodeIcon": "🛰️" } }
```

**Second `taskhub.worker.hello`** (the taskhub semantics face, the routing self-description):

```json
{ "type": "event", "id": "evt_01", "name": "taskhub.worker.hello", "ts": 1762000000000,
  "payload": { "nodeId": "3f2a…uuid", "title": "Gitea code worker", "description": "Writes Go/TS, pushes to Gitea",
               "tags": ["gitea", "code", "go"], "maxConcurrent": 2 } }
```

```json
{ "type": "event", "id": "evt_02", "name": "taskhub.worker.heartbeat", "ts": 1762000060000,
  "payload": { "nodeId": "3f2a…uuid", "running": 1 } }
```

- `nodeId`: the node's stable uuid (same value as `node.identity`'s `nodeId`; the existing wsgw `ws_nodes` UPSERT contract is untouched).
- `title/description/tags/maxConcurrent`: UPSERTed into the taskhub `worker_meta` table (migration 0210) keyed `(user_id, node_id)`; `user_id` comes from connection ownership, never the payload.
- A missing heartbeat does not imply death (a wsgw disconnect already means unreachable); `running` = tasks this node is currently executing (backpressure observation).

## 3. Task dispatch (cms → node, existing wsgw command face)

cms dispatches with a down command frame, action fixed `task.dispatch`:

```json
{ "type": "command", "id": "wcmd_01J...", "action": "task.dispatch",
  "payload": { "taskId": "01JBYQ8...", "intent": "Find out why CI is red in the repo",
               "origin": { "source": "wechat", "conversation": "p2p:wxid_abc", "requester": "wxid_abc" },
               "createdAt": 1762000000 } }
```

**Node receipt (result frame, synchronous, ≤10s — wsgw `DefaultCommandTimeout`) carries only accept/reject:**

```json
{ "type": "result", "id": "wcmd_01J...", "ok": true, "result": { "accepted": true } }
```

```json
{ "type": "result", "id": "wcmd_01J...", "ok": true, "result": { "accepted": false, "reason": "outside this node's policy" } }
```

- `accepted:true` = the node took the task (enters the superagent pipeline; Eval/Policy retain final veto, expressed as `accepted:false`).
- `accepted:false` = explicit refusal: cms records a `refused` event and tries the next candidate or parks.
- `ok:false` (e.g. `HANDLER_ERROR`) = handler exception; same path as refusal with reason from message.
- Result-frame timeout = treated as offline; the task waits for lease expiry and requeues.
- **Idempotency**: a re-sent `task.dispatch` after requeue carries the **same taskId**; the node must dedup by taskId (an in-flight/accepted taskId answered again → reply `accepted:true` immediately, never create a duplicate ticket).

## 4. Progress replies & completion (node → cms, event face)

**Hard constraint**: tasks run minutes-to-hours while the result frame waits at most 10s ⇒ **completion never travels on the result frame**. Progress replies and completion both go up as events; cms correlates by `taskId`.

Progress reply (one per Outbox message; cms delivers each to the origin channel, dedup by `messageId`):

```json
{ "type": "event", "id": "evt_03", "name": "taskhub.task.reply", "ts": 1762000300000,
  "payload": { "taskId": "01JBYQ8...", "messageId": "msg_9f2…", "text": "Checked — a test-env dependency is down; fixing now." } }
```

Completion report (once at ticket terminal state; cms marks `reported` on receipt, `replied` after origin delivery):

```json
{ "type": "event", "id": "evt_04", "name": "taskhub.task.result", "ts": 1762003600000,
  "payload": { "taskId": "01JBYQ8...", "outcome": "completed", "summary": "CI is green again; root cause and a regression test landed." } }
```

- `outcome`: `completed` | `stopped` | `failed` (a projection of the superagent TicketOutcome closed set; `merged/closed` map to `completed`, `dropped` to `stopped`).
- Events raised while offline are replayed from the client's local queue (FIFO, ordered; cms dedups by UNIQUE constraints — replays are side-effect free).

## 5. Origin delivery (cms → channel, v1 WeChat only)

- WeChat: `imhub.Service.Reply(conversation, text)` (in production); `conversation` = origin.conversation verbatim.
- Delivery idempotency: `task_events` carries `UNIQUE(task_id, type, ref)`; `ref` = the uplink messageId (reply) / the constant `result` (task.result). Replays/restarts never produce duplicate WeChat messages.
- Negative-reply texts (cms-composed, same delivery path): no match = "no worker available, task parked"; all refused = "every candidate node refused this task: {reason}"; delivery retries exhausted = "task result delivery failed".

## 6. Task state machine & lease

```
received ──match──▶ routed(lease) ──accepted──▶ accepted ──task.result──▶ reported ──delivered──▶ replied
   ▲                  │timeout/refused/ack error                 │delivery failed (retries exhausted)
   └──── requeue ◀────┘   all candidates exhausted/no match ──▶ parked └──────────▶ failed
```

- Lease: `task.hub.lease_seconds` (default 900s); expiry before accepted → requeue (attempts+1, back to received); after `task.hub.max_attempts` (default 3) → parked + negative reply.
- Terminal: `replied` (good) / `parked`, `failed` (bad, always with a negative reply).

## 7. Error-code segment 7700-7799 (cms, taskhub domain)

| Code | Constant | Meaning |
|------|----------|---------|
| 7700 | TaskNotFound | task id does not exist |
| 7701 | TaskStateConflict | the state machine disallows this operation |
| 7702 | NoWorkerMatched | no worker matched (task parked) |
| 7703 | WorkerOffline | target node connection offline (waits for lease requeue) |
| 7704 | DispatchTimeout | dispatch receipt wait timed out |
| 7705 | WorkerRefused | node refused (accepted:false) |
| 7706 | OriginDeliveryFailed | origin delivery failed (retrying/exhausted) |
| 7707 | InvalidEnvelope | task.dispatch envelope invalid |
| 7799 | Internal | segment tail reserved for internal errors (same precedent as market 7399) |

## 8. cms config keys (hot-read, seeded)

| Key | Default | Meaning |
|-----|---------|---------|
| `task.hub.owner_user_id` | empty | the cms user tasks belong to (the worker-pool anchor); empty = intake fully off |
| `task.hub.intake_mode` | `off` | `off` \| `all` \| `prefix`: which WeChat messages become tasks |
| `task.hub.intake_prefix` | `任务` | prefix-mode prefix (a match creates the task, prefix stripped) |
| `task.hub.intake_device` | empty | empty = follow `im.hub.default_device` |
| `task.hub.lease_seconds` | `900` | dispatch lease seconds |
| `task.hub.max_attempts` | `3` | requeue cap; beyond it the task parks |

## 9. Permission codes

`taskhub:read` (admin read: task list/detail/workers) / `taskhub:manage` (requeue/redeliver admin actions). Registered in `internal/rbac/permissions.go`, append-only.

## 10. Contract-test obligations (both sides)

- cms: the Go side compares §2/§3/§4 JSON literals verbatim (`taskhub_contract_test.go`).
- fork: the TS side compares the same three sections (`taskhub-protocol.spec.ts`), plus behavior tests for §3 idempotency and §4 offline replay.
- Blind second-client check: either side's client should be implementable from this document alone — the document is the arbiter.
