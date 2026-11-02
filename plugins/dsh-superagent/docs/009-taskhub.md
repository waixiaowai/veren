# 009 · CMS Task Router (taskhub) Worker Onboarding

> This fork's taskhub Source turns `dsh --profile superagent` into a worker node of the cms public task router.
> cms dispatches tasks from external channels (v1: WeChat) to you by the node's self-declared title/description/tags, and returns replies to the origin channel and requester when done.
> Wire contract: cursour repo `docs/taskhub-protocol.md` v1 (pinned verbatim by contract tests on both sides).
> Two-process rehearsal & chaos scripts: cms repo `scripts/taskhub-rehearsal/README.md`.

## 1. Concepts (one minute)

- **Registration (two events, both required)**: after connecting to the cms WebSocket, send `node.identity` (into the wsgw connection registry — the precondition for dispatch addressing), then `taskhub.worker.hello` (the title/description/tags routing self-description); a heartbeat every 60s after that.
- **Dispatch**: cms sends a `task.dispatch` command (taskId/intent/origin); the result frame answers only accept/reject (≤10s). Once accepted, the existing superagent pipeline takes over: Trigger → Eval/Policy gate (**the node keeps veto power**) → Ticket → execution.
- **Reporting**: each progress reply goes up as `taskhub.task.reply`; the ticket terminal state goes up once as `taskhub.task.result`. cms delivers replies to the `origin` frozen at intake (source channel + conversation + requester) — **replies go where they came from, to whoever ordered the work**.
- **Reliability**: tasks are rows in cms; a lease (default 900s) expiring without acceptance requeues automatically; beyond the cap the task parks with a negative reply to the requester; reply delivery is UNIQUE-idempotent — replays never resend.

## 2. cms-side preparation (admin, once)

1. **Create an API Key for the node**: the admin console's API Key page (its capabilities are whatever you tick; WS access alone needs no business permission codes).
2. **Turn on intake**: the Platform Parameters page (hot-read, effective immediately):

| Key | Suggested value | Meaning |
|-----|-----------------|---------|
| `task.hub.owner_user_id` | your user id (e.g. 1) | the worker-pool anchor tasks belong to; **empty = intake fully off** |
| `task.hub.intake_mode` | `prefix` | `off`/`all`/`prefix`: which WeChat messages become tasks |
| `task.hub.intake_prefix` | `任务：` | a prefix match creates the task and the prefix is stripped; ignored in `all` mode |
| `task.hub.intake_device` | empty | empty = follow `im.hub.default_device` |
| `task.hub.lease_seconds` | 900 | dispatch lease seconds |
| `task.hub.max_attempts` | 3 | requeue cap; beyond it park + negative reply |

3. (Acceptance face) task list/timeline: `GET /v1/admin/taskhub/tasks`, `GET /v1/admin/taskhub/tasks/{id}` (taskhub:read; GUI page is a candidate-pool item).

## 3. Node-side onboarding (this fork)

1. Enable the taskhub row in the profile's `cordis.patch.yml` (remove `disabled: true`):
   `- id: dsh-superagent-taskhub` / `name: dsh-superagent/taskhub-watch`.
2. Open the **CMS task router** Source in the panel and fill the four routing keys:
   - **cms WS endpoint**: `wss://veren.top/v1/ws` (or LAN `ws://…:18081/v1/ws`)
   - **cms user API Key**: the key from step 2
   - **Node ID**: a stable unique string (survives restarts; cms remembers the node by it)
   - **Title/Description/Tags**: state what this node is good at — cms coarse-matching scores tags×4 + title×2 + description×1, tags weigh most
   - **Max concurrent**: align with the profile's `executor.maxWorkers`
3. Once saved and the Source health shows "Connected to cms", registration is done; `GET /v1/admin/taskhub/workers` on cms should list this node.

## 4. Real-machine acceptance checklist (task book §2 Q4)

1. Send `任务：…` from the phone in WeChat → the same conversation receives the completion reply (to whoever ordered it).
2. cms admin: the `tasks/{id}` timeline threads received→matched→accepted→reported→replied with one task_id.
3. Kill the node mid-task → lease requeue → it still completes after reconnect; the source conversation never sees a duplicate reply.
4. No match (all nodes offline) → the requester receives the "no worker available" negative reply + admin sees the parked row.
5. A task violating the node's Policy → the refusal text is **delivered** to the requester (never silently dropped).
6. A deliberately unroutable description (irrelevant tags with multiple nodes online) → parked + visible negative reply.

## 5. Troubleshooting

| Symptom | Check |
|---------|-------|
| Node "connected" but never dispatched | did the node send `node.identity`? (2026-11-02 rehearsal: worker.hello alone = ErrWorkerOffline forever) |
| Credential parked, no reconnect | close 4401 = API Key invalid or user disabled; re-save the Source with a fresh key |
| Tasks stuck in routed | node offline, waiting for lease requeue; attempts beyond `max_attempts` park with a negative reply |
| Reply never reaches WeChat | is the `im_hub` session alive (manage-plane authorize); look for reply_failed rows in task_events |

## 6. Explicitly out of scope (v1)

email/Feishu origin adapters (the origin address space is reserved); migrating the existing node-side gitea/github/feishu Sources into cms intake; a taskhub admin GUI; LLM-assisted matching (`internal/llm` stays a candidate-pool item).
