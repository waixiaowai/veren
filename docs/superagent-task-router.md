# CMS Public Task-Router Service (taskhub) × dsh-superagent Worker Nodes — Deepened Task Book (Four Questions)

Status: **awaiting execution** (filed 2026-11-02; four-question deepening + forensics on record).
This is a task book, not a settled design: execute per the recommendations in §3; if evidence overturns a recommendation mid-flight, amend this document before the code.

---

## 0. Original request, restated

Original (2026-11-02, translated):

> In superagent, task dispatch/reception should have a public routing service, deployed in cms.
> `dsh --profile superagent` registers a single worker node; each node has title/description; the router dispatches messages by these. After completion, collect the message and reply where it came from — whoever issued the task gets the reply (email/wechat/Feishu, etc.).

One sentence: build a public task-routing domain **taskhub** in cms: messages arrive from external channels → routed by "the worker node's self-declared title/description" to a `dsh --profile superagent` node → the node completes it through the existing superagent pipeline → the result returns along "origin channel + original requester".

---

## 1. Forensics on record (facts you must know before writing code)

### 1.1 superagent side (`plugins/dsh-superagent`, fork, @deepseek-ai scope)

- Existing pipeline: Source → Trigger → Eval (gate + assessment) → Decision → Ticket (with Mandate) → Assignment → Executor (**in-process** worker session) → Report → Outbox → Channel back to source. Domain docs `docs/001-domain.md`, `002-authorization.md`, `003-execution.md`, `007-architecture.md`; new-source recipe `docs/008-cookbook.md`.
- Sources are a first-class pluggable protocol: `SourceKind` (`src/sources/kind.ts:87-115`): kind/schema/fields/scope/policy/channel/threadContext/find/environment. Gitea is the size template — its cordis entry is ~14 lines (`src/sources/gitea.ts:116-129`: register kind + start watch).
- Reply-channel contract is settled: `SourceChannel.send` is idempotent by message.id, returns `'sent' | 'gone'` (`kind.ts:48-58`); the Outbox is a durable effect queue with retry (5s→300s, `src/app/outbox.ts`). Tickets hold `ChannelRef` (source + thread + address) — **reply routing is already first-class data within one instance**.
- "Worker" is today only an in-process concept (`worker-<ticketId>` sessions + `WorkerSlots`/`executor.maxWorkers` concurrency cap); **there is no remote-node concept**.
- No websocket client anywhere; HTTP is a loopback panel API only (127.0.0.1 Host enforced). All external I/O goes through CLI subprocesses.
- Fork specifics: cordis 4.0.5-alpha.1 (@deepseek-ai line), dependency-free `tools/gitea-cli`, credentials in config files not env (DSH strips credential-shaped env).
- Deployment: Olares chart (`deploy/olares/`, untracked) + profile `superagent`, port 3082.

### 1.2 cms side (`D:\cms`, single Go binary: chi + SQLite WAL + sqlc)

- **wsgw** (`/v1/ws`, gorilla): the plugin long-connection already has both "node identity" and "command dispatch":
  - `node.identity` event → `ws_nodes` UPSERT keyed `(user_id, node_id)`, payload `{nodeId, nodeName, nodeDescription, nodeIcon}` (`internal/wsgw/nodes.go`; plugin side `plugins/cms-bridge/src/identity.ts`).
  - Command frames down `{type:'command',id,action,payload}` / result frames up `{type:'result',id,ok,...}` — byte-identical to cms-bridge `protocol.ts`, pinned in the Go comment (`internal/wsgw/command.go:11-13`); `DefaultCommandTimeout = 10s` (`command.go:18`); offline target = `ErrConnOffline`; raw frames audited both directions into `ws_messages`.
  - Plugins may report `{type:'event',id,name,payload,ts}`; cms-bridge's reporter has an **offline FIFO replay** (`src/reporter.ts`).
- **imhub** (`internal/imhub`, in production): cloud holds the iLink WeChat session; devices long-poll `GET /v1/im/hub/messages` (25s hold, after-cursor, new devices only see ≤5min-old messages) + `POST /v1/im/hub/replies {conversation_id, text}`; people directory; error-code segment 7600-7699; migrations 0207/0208. This is cms's newest "cloud hub + reply routing" precedent: idempotent insert `UNIQUE(device,message_id)`, cursor advance only after at-least-once batch delivery.
- New-domain checklist (that repo's AGENTS.md): next migration number measured (0210 next; run `ls migrations/*.up.sql | tail` before taking); one sqlc yaml per domain; `internal/<domain>/{store,service,routes,codes}.go`; append-only registration in `cmd/server/domain_build.go` + `domain_mount.go`; central rbac permission registry; error-code segment from the central ledger; **files ≤300 lines / functions ≤60 lines**; test-first red-green both ways; background goroutines get stop handles in `domain_stack.go`.
- `internal/llm` exists — an optional future aid for the matcher.

### 1.3 One hard protocol constraint (it dictates the architecture)

The wsgw command result is a **synchronous wait capped at 10s** (`command.go:18`), while superagent tasks run minutes-to-hours ⇒ **task completion cannot travel on the result frame**.
Correct shape: the result frame carries only accept/reject (assignment ack); completion arrives as an EventFrame `task.result` correlated by taskId; cms-bridge-style offline replay guarantees the completion event is not lost.

---

## 2. The four questions

### Q1 What a top professional would add (unrequested, but its absence is fatal)

1. **A durable task queue, not match-and-forward**: rows in SQLite, lease + visibility timeout, automatic requeue on node crash/offline, idempotency keys against duplicate delivery; at-least-once + node-side dedup. imhub already paid this tuition in the same repo (idempotent insert + cursor + deliver-then-advance).
2. **Reply address as first-class envelope data**: `origin = {source_kind, conversation, requester}` frozen at intake, immutable for the task's life; "task done" and "reply delivered" are two independent durable states (the reply has its own outbox + retry + `gone` terminal state). "Reply where it came from, to whoever ordered it" thereby becomes fields, not slogans.
3. **Every failure path models a reply**: no node matches → parked + negative reply to the requester; contested match → deterministic tie-break; node refuses → the refusal text is the reply; reply channel gone → visible terminal state. **The requester always gets an echo.**
4. **Authorization is not bypassed by the router**: the router's match is a *suggestion*; the node's Eval/Policy/Mandate (docs/002) retains veto — the last line of defense for "who may set the machine to work"; short-circuiting it from the routing layer dismantles the authorization system. On cms: who may order (people/allowlist/configurable intake rules), who may register a node (cms user API key already gates the WS).
5. **A task_id timeline end-to-end**: intake→routed→acked→running→reported→replied/failed, every hop audited (reuse the `ws_messages` audit pattern + a `task_events` table); admin can replay any single task.
6. **Capacity and backpressure**: registration carries maxConcurrent (aligned with superagent's existing `executor.maxWorkers`), heartbeat carries load, tasks have TTL, queue depth is visible.

### Q2 The rawest material to start from

- `plugins/dsh-superagent/docs/001-domain.md`, `002-authorization.md`, `003-execution.md`, `007-architecture.md`, `008-cookbook.md` (008 is the new-SourceKind recipe)
- `plugins/dsh-superagent/src/sources/kind.ts` (full SourceKind/SourceChannel protocol), `src/app/outbox.ts` + `src/app/runtime.ts` (effects/event hooks), `src/core/model.ts` (ChannelRef/Trigger), `src/sources/gitea.ts` (integration template), `tests/fixtures/host.ts` (simulated DSH host)
- `D:\cms\internal\wsgw\command.go`, `nodes.go`, `hub.go`, `routes_admin.go` + migrations 0200/0202 (the original frame-contract and node-registration implementations)
- `D:\cms\internal\imhub\` in full + `docs/notes/adopted/2026-10-27-imhub.md` + migrations 0207/0208 (the hub-and-reply precedent)
- `plugins/cms-bridge/src/protocol.ts`, `connection.ts`, `reporter.ts` (frame mirror + reconnect/replay semantics)
- `plugins/im/hub/src/provider.ts` (a running device-side pull/reply/cursor loop)
- External precedents **for naming invariants only, not copying**: AMQP 0-9-1's at-least-once/ack/redelivery semantics, NATS JetStream ack model, Temporal task-queue concepts.

### Q3 Methods and tools

1. **Contract first**: a versioned wire contract `docs/taskhub-protocol.{cn,}.md` — task-envelope JSON, actions (down `task.dispatch`; up events `task.result`/`task.heartbeat`), error codes, lifecycle states, idempotency rules; mirrored Go/TS with **shared JSON fixture contract tests** (precedent: `command.go` pins `protocol.ts` in its header comment).
2. **cms side per that repo's AGENTS.md**: red-green tests both ways; migration 0210 (measured); per-domain sqlc yaml; `internal/taskhub/{store,service,routes,codes,matcher,deliverer}.go` (≤300-line files / ≤60-line functions); append-only `domain_build`/`domain_mount`; rbac `task:read`/`task:manage`; error-code segment from the central ledger; the dispatch/lease goroutine gets a stop handle.
3. **Node side**: a **self-held thin WS client inside the fork** (same frame shapes, zero cordis dependency, under `src/infra/`, credentials in schemastery secret config) — **not** a dependency on `@veren/cms-bridge` (its @veren/core dependency would install a second cordis instance into the fork's @deepseek-ai/cordis tree — an AGENTS.md red line); a new `taskhub` SourceKind (008 recipe) + worker registration/heartbeat + dispatch command handling (→ `ctx.orchestrator.receive(Trigger)` through the existing Eval gate) + `ticket.ended` → `task.result` event.
4. **Property tests (table-driven state machine)**: no double delivery, no lost reply, origin immutability, lease-expiry requeue without double-claim, idempotency-key dedup, refusals always delivered.
5. **Environment chain (three-way isolation)**: local-source cms + 3080 stable node integration → staging 3100 rehearsal → production veren.top via `deploy-local-pkg.sh`; the superagent node follows the existing Olares chart / stable-test-node rules.

### Q4 External judges (not you, not me, not the implementer)

1. **A real phone**: send a task via WeChat → the completion reply lands in the **same conversation**, visible on the actual phone (imhub production chain exists — judgeable today).
2. **The SQLite timeline**: `im_hub_messages` row → `tasks` row (origin triple) → `ws_messages` dispatch frame → result/event frames → replies POST — one task_id threading all of it, replayable in admin.
3. **Chaos injections judge the invariants**: kill the node (task in flight) / kill cms (dispatch in flight) / duplicate dispatch — verdicts: "no lost task, no duplicate reply in the source thread".
4. **The refusal path**: a task violating node Policy → the refusal text is **delivered** to the requester (not silently dropped, not log-only).
5. **Blind second client**: a TS client implemented from the contract doc alone interoperates with the Go side — the doc is the arbiter.
6. **The no-match case**: the requester visibly receives a "no worker available" negative reply + admin sees the parked row.

---

## 3. Architecture decision points (first ruling; recommendations)

| # | Fork | Recommendation | Basis |
|---|------|----------------|-------|
| D1 | Dispatch direction: push (wsgw command) vs pull (imhub-style long-poll) | **push** | The wsgw command face exists (pending map + audit + ErrConnOffline); offline tasks simply park. Pull kept as fallback |
| D2 | Who matches | **cms coarse-matches (title/description + tag keywords), the node's Eval has final veto** | cms should not understand node semantics; the node keeps refusal rights (authorization red line); `internal/llm` reserved as a future aid |
| D3 | Completion transport | **result frame carries only accept/reject; completion travels as EventFrame `task.result` (taskId-correlated)** | §1.3 hard constraint (10s sync cap vs minutes-long tasks) |
| D4 | v1 origin adapters | **WeChat only** (imhub in production); the origin address space reserves email/feishu/webhook; **existing node-side gitea/github/feishu sources are neither migrated nor replaced** — taskhub is an additional SourceKind, not a replacement | Depth, not breadth; the only reply chain that can be judged on a real machine today |
| D5 | Worker metadata storage | **taskhub owns a `worker_meta` table** keyed `(user_id, node_id)`; wsgw and `ws_nodes` untouched | Clean domain boundary; wsgw stays a thin pipe |
| D6 | Node-side transport implementation | **A thin WS client held inside the fork** (same protocol, zero cordis dependency), not @veren/cms-bridge | Prevents a second cordis instance (AGENTS.md red line); fits the fork's dependency-free tradition (gitea-cli precedent) |
| D7 | Intake rule (which WeChat messages become tasks) | **Configurable**: default "designated conversation OR message prefix + people allowlist", hot-read cms config (following the `im.hub.*` convention) | Not hard-coded; the rule is an operations face, not a code face |

## 4. Data & protocol sketch (draft until the contract doc settles)

- `tasks`: id(ulid) / origin(kind, conversation, requester) / intent(text) / status / lease(worker_node_id, expires_at) / idempotency_key / created_at / updated_at
- `task_events`: task_id / seq / type / payload / at — the timeline (replay face)
- `worker_meta`: (user_id, node_id) / title / description / tags / max_concurrent / last_heartbeat
- State machine: `received → routed → accepted → running → reported → replied`; side terminal states `parked` (no match) / `failed` / `requeued` (lease expiry or refusal returns it to the pool)
- Protocol actions: down command `task.dispatch` (envelope: taskId/origin/intent/context); up events `task.result {taskId, outcome, summary}`, `task.heartbeat {taskId?, load}`; the result frame is the assignment ack (`{accepted:true|false, reason?}`)
- Node-side mapping: envelope → Trigger (source=`taskhub`, thread key `taskhub:<taskId>`, Mandate basis carries origin.requester) → the existing Eval/Policy flow in full; replies flow through this SourceKind's `SourceChannel.send` into `task.result`

## 5. Task breakdown & acceptance (six legs)

- **A cms domain**: migration 0210 (up/down + frontier-pin tests), store/service (red-green), matcher (keyword coarse match + tie-break + park-on-no-match), deliverer (push + lease + requeue goroutine), admin routes (list/detail/requeue/timeline), intake rules (hot-read config) + rbac/error-code registration.
- **B node side**: thin WS client (reconnect/backoff/credential-park/offline replay), the `taskhub` SourceKind (schema/fields/policy/channel), worker registration & heartbeat, dispatch→Trigger→Ticket→`task.result` full chain; vitest + simulated host + fake cms WS server.
- **C contract**: `taskhub-protocol.{cn,}.md` + shared fixtures + Go/TS contract tests both sides + blind second-client verification.
- **D integration**: local-source cms + 3080 node: simulated WeChat message → task → node superagent session → reply lands back in the simulated conversation; timeline replay verified.
- **E chaos**: three scripts (kill node / kill cms / duplicate dispatch), invariant verdicts (no loss, no duplicates).
- **F real machine**: staging 3100 rehearsal → production `deploy-local-pkg.sh`; the real-machine checklist = §2 Q4's six items, each with evidence (phone screenshots + SQLite rows + admin replay).

## 6. Constraint red lines (copied from both repos' AGENTS.md; self-check each)

- cms: files ≤300 lines / functions ≤60 lines; test-first red-green both ways; migrations/sqlc/permission codes/error-code segments **centrally registered, append-only**; domain logic separated from transport (thin handlers).
- This repo: config via schemastery; ≤300-line files / ≤30-line functions; tests in package-level tests/; "a spec that only passes in isolation is a defect"; **every dsh command must set DSH_HOME explicitly**; never write `~/.dsh`; the three-environment isolation iron rules; bump before any release; local imports carry `.ts` suffixes, full ESM NodeNext.
- Credentials: the cms token lives in schemastery secret / config files, never env (DSH strips credential-shaped env).

## 7. Termination condition

Send one task via real WeChat → the phone receives the reply with conclusions (same conversation); the cms audit timeline is complete and replayable; all three chaos scripts pass their invariants; both negative paths (no-match and refusal) have delivery evidence. Only when all four hold is the task done.
