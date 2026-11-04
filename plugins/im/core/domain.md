# im/core domain (领域模型)

> **SUPERSEDED (2026-11-04, 3.0.0-rc.1) / 已被取代（2026-11-04，3.0.0-rc.1）**:
> The queue, the active-binding router, and the private session mapping described below
> were removed by the family redesign. The authoritative record is now
> `plugins/im/docs/redesign-mapping.{cn,}.md`; only the people-directory and
> account-lifecycle sections below still describe live code.
> 下文的队列、active-binding 路由与会话私有化已被家族重设计移除。权威记录改为
> `plugins/im/docs/redesign-mapping.{cn,}.md`；下文仅人员目录与账号生命周期两节仍描述
> 存活代码。

> Decision record for the im core plugin (the WeChat-path message domain).
> English is primary; Chinese key terms stay in parentheses. Every invariant
> names the test that guards it; one without a guard is marked `unguarded`.
> Declared faces at the bottom are checked by `scripts/check-docs.mjs`.
> 本文件是 im/core 的决策沉淀：概念表 + 不变式 + 拒绝清单 + 已知妥协。
> 语义规格基准是 docs/im-message-queue.cn.md（2.1.8 重构）；代码与规格冲突时先改规格。

## Concepts (概念)

| Concept | Definition | Rules it keeps |
| --- | --- | --- |
| Message queue (消息队列) | The durable inbound queue (`ImMessageQueue` over the `im` storage domain): idempotent enqueue, per-conversation FIFO, bounded retries, dead-letter terminal state, restart recovery | The queue owns durable state only; consuming lives in the router's per-conversation chains, which drive it row by row |
| Conversation (会话) | The user-facing unit: `account + conversation_id`. Users never see sessions | One conversation is one FIFO chain; cross-conversation runs in parallel (no global head-of-line) |
| Private session mapping (会话私有化) | `conversation_id → session_id` private map (`conversation_sessions`), lazily created, recovered inside `gateway.ask`, never rotated | Sessions are not a user concept and cannot be manually bound; `conversation_id` is the stable key across account retargets |
| Account lifecycle (账号生命周期) | QR authorization attempts, the durable account table, retirement/replacement (`ImBindings` is the account domain only — it never routes a conversation) | Since 2.1.8 there are no bindings: the message path is the queue and sessions are private |
| Delivery semantics (投递语义) | At-least-once: a crash while `consuming` re-queues on restart (duplicate replies possible, never silent); ack on queueing only when the conversation already has in-flight/queued messages | Every row ends `replied` / `failed` (notified) / `dead` (notified) — no message sinks silently |
| People directory (人员目录) | Claims, merges and resolution of people records (`people-*` modules) | Resolution returns a match record (`matchedBy`/`matchedValue`) instead of guessing |

## Invariants (不变式)

1. **Not lost (不丢)**: every inbound message reaches a terminal state
   `replied`/`failed`/`dead`, each notified to the user. No ending = violation.
   Guard: `plugins/im/core/tests/queue.spec.ts` 「marks replies with an excerpt and
   reaches the replied terminal state」+ dead-letter test; the "user notified on
   every terminal state" wording is `unguarded` as a whole-path property.
2. **Not duplicated (不重)**: one `message_id` has at most one queue row; a
   duplicate enqueue is a no-op reporting `'duplicate'`.
   Guard: `tests/queue.spec.ts` 「enqueues idempotently: the same message id is a
   duplicate no-op」.
3. **Ordered (有序)**: within one conversation, consumption order = `received_at`
   order; at most one row `consuming` at a time.
   Guard: `tests/queue.spec.ts` 「claims per conversation in received_at order」.
4. **Self-healing (自愈)**: after a restart every `consuming` row returns to
   `queued`; failed rows retry up to `MAX_MESSAGE_ATTEMPTS` (3) and land `dead`.
   Guard: `tests/queue.spec.ts` 「recovers rows stuck in consuming after a restart」
   + 「retries failed attempts and lands in the dead letter after the budget」.
5. **Session privacy (会话私有化)**: the same conversation always maps to the
   same private session; lazy creation on first consume; no rotation.
   Guard: `tests/queue.spec.ts` 「remembers the private session per conversation」.
6. **Account replacement migrates in-flight rows (账号退役迁移)**: rows on a
   dying account move onto the replacing account, keyed only by
   `conversation_id` — the session map needs no migration.
   Guard: `tests/queue.spec.ts` 「migrates in-flight rows onto the replacing account」
   + `tests/account-replace.spec.ts`.

## Known compromises (已知妥协)

- **attempts have no dispose (attempts 无 dispose)** — terminal (`replied`/
  `failed`/`dead`) rows are never pruned; the audit view reads `recent(50)`.
  In-案 P3 debt (docs/optimization-plan.cn.md G1), unguarded.
- **`matchedValue` can be stale (matchedValue 失真)** — people resolution
  records the matched string at resolve time; later renames/merges do not
  rewrite past records. In-案 P3 debt (people-resolve), guarded only for
  current-shape behavior by `tests/people-resolve.spec.ts`; the staleness itself
  is `unguarded`.

## Rejected (拒绝清单)

| Rejected | Reason |
| --- | --- |
| The bindings table and the bind/unbind service face (绑定表) | 2.1.8: sessions are private per conversation — a user-facing binding action has no owner left; the whole dual-track surface was deleted, not deprecated |
| The `im_link` model tool (绑定工具) | Sessions need no binding action once the conversation→session map is private and lazy |
| `autoCreateSession` config (自动建会话配置) | Sessions are always created privately; the switch would only re-introduce the "message with nowhere to land" state |
| Session rotation on account retarget (会话轮换) | `conversation_id` is the stable key across retargets (实证); rotation would break the private-session identity for zero benefit |
| A global FIFO across conversations (全局队头) | One heavy user must never block others; per-conversation chains give fairness by construction |
| In-memory `seen` dedup ring (内存去重环) | Restart amnesia was the root cause of sunk messages; the durable unique key replaces it |

## Declared faces (check-docs 声明面)

> 3.0 起本节的队列/会话声明已随重设计移除；存活声明只有人员目录与账号授权面。
> Since 3.0 the queue/session declarations here left with the redesign; the live
> declarations are only the people-directory and account faces.
- service: `ImPeople`
- service: `ImBindings`
