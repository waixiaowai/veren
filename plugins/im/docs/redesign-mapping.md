# im family redesign mapping (Cumora → DSH)

> Basis: the Cumora design under `plugins/im/design/` (a 16-module product; baseline
> `deepseek/yetone/cumora` 0.18.9), plus the workspace rulings of 2026-11-04:
> **storage via dsh storage, register dsh tools, register dsh skills, agents are dsh
> presets, projects are dsh workspaces, and the product end is a dsh client**.
> This document records every decision made while translating that design into the DSH
> plugin family. Where the design and this document appear to conflict, **the design is
> the authority and this document is the mapping record**.

## 1. Concept mapping

| Cumora concept | DSH landing | Notes |
| --- | --- | --- |
| companyId (workspace) | the DSH instance (fixed `personal` seed) | the design's own data dictionary seeds a single workspace `personal`; single host, single workspace; no tenancy/invitations/roles |
| project (projectId) | DSH workspace (`workspaceRegistry`) | memory's `project_id` scope is the DSH workspace id |
| agent (persona + engine + model) | DSH preset (`agents.create({meta: {agentPreset}})`) | persona, model, engine all live in the preset; the participant id is `agent:<presetId>`; the synthesized `agent:default` has no preset and answers with the deployment persona |
| participant (human/agent) | a roster projection, no table | owner = `human:owner`, preset agents = `agent:<presetId>`, external humans = `human:<personId>` (people-directory rows) |
| Conversation (rooms/messages/sequences/reads) | `@veren/im-conversation` (storage domain `im_conversation`) | room ids: `conv:*` (internal) / `chan:<provider>:<account>:<conversation>` (channel-backed, deterministic) |
| Turn (runs/inbox/terminal states) | `@veren/im-turn` (storage domain `im_turn`) | one wake = one run row + an event timeline; sessions are keyed per agent × room |
| Coordination (triage/gates/budgets) | `@veren/im-coordination` (storage domain `im_coordination`, only watermarks are durable) | v1 triage is fully deterministic; write gates are judged inside the room write chain via `post(gate)` |
| database transactions / outbox | dsh storage domains + cordis events | "persist first, distribute later": write the domain table, then `ctx.emit`; push is an accelerator, clients reconcile by pulling |
| bash / set_turn_status engine tools | the DSH session's own tool loop + `im_*` tools (`ctx.tools.register`) | Cumora's engine-tool model is not ported; the model's turn text IS the room message |
| skill directory | DSH skill (`ctx.skills.registerProvider`, `im-collaboration`) | teaches the model: reply contract, HELD semantics, quiet discipline, memory etiquette |
| the four product ends | DSH client (`@veren/im-ui` web panel) | conversations / cloud / intake tabs; desktop, mobile, and the admin console are not ported |
| realtime long connections | cordis events + the panel's 5s polling + incremental fetch | event chain: `im/message-observed` → `im/message-new` → `im/wake-request` → `im/run-updated` |
| Billing/Admin/Shipping/Email/Schedule/Document/Board | **not ported** (peripheral domains, later iterations) | design §9/§10/§12/§15/§16/§17 and parts of §11 remain extension points |

## 2. Family structure (10 packages)

```
plugins/im/
  core          @veren/im               contracts, participant roster, memory, provider registry
                                        (emits im/message-observed), people directory, intake, accounts
  conversation  @veren/im-conversation  rooms/members/messages/sequences/reads + channel ingest
                                        (emits im/message-new)
  coordination  @veren/im-coordination  deterministic triage + low-priority budget + watermarks
                                        + write gates (emits im/wake-request, the only wake source)
  turn          @veren/im-turn          run records + inbox + fingerprints + per-agent preset sessions
                                        + hold loops + terminal states
  tool          @veren/im-tool          im_* tools (write via conversation + coordination gates)
                                        + the collaboration skill
  wechat        @veren/im-wechat        channel: inbound observations → registry; outbound: subscribes
                                        im/message-new and delivers agent-authored room messages
  hub           @veren/im-hub           channel (CMS cloud gateway, long-poll): both directions as above
  ui            @veren/im-ui            web panel: conversations (new) / cloud / intake; mounts the
                                        `im` and `imConv` remote namespaces
  testkit       @veren/im-testkit       fake provider + conformance suite + per-domain in-memory seams
../im-bundle    @veren/im-bundle        bundle row order: core → conversation → coordination → turn
                                        → wechat → tool → ui
```

Version: the whole family moves to `3.0.0-rc.1` (contract and storage-semantics break →
MAJOR via rc prerelease; publishing follows the three-environment pipeline separately).

## 3. The fact pipeline (one human message, end to end)

```
channel provider.listen
  → ImRegistry emits im/message-observed
  → [core] observeInbound (people bookkeeping + cloud push) → intake.handle (stranger
      question, deterministic)
  → [conversation] Ingest.observe: deterministic room id + seat the sender + idempotent
      write with clientId = messageId → emits im/message-new
  → [coordination] Fanout.onMessageNew: 60s claim → triage the room members → budget
      → emits im/wake-request (seen-and-silent candidates advance their watermark so
      later turns never reload them)
  → [turn] Runner.onWake (serialized per agent): load the inbox (non-self messages after
      the watermark) → fingerprint check → ensure the session (preset) → prompt envelope
      (room + roster + unread + reply contract) → the session turn produces reply text
      → conversation.post(input, coordination.gatePost(...))   ← gates judged in the chain
          HELD_FRESHNESS / HELD_VERBATIM → buildHoldPrompt retry (≤3 rounds) → give up as
          skipped(held-out)
      → success: markSeen → run completed → emits im/run-updated
  → [wechat/hub] subscribe im/message-new: channel-backed room + agent author
      → provider.send delivers outbound
```

## 4. How design §1.10's ten invariants landed

| Invariant | Landing |
| --- | --- |
| persist before distribute | the conversation domain writes the table first, then emits; outbound channel failures only warn |
| exclusive sequences | the per-room counter row + an in-process per-room write chain (single host, single writer) |
| actionable refusals | HELD_* errors carry ≤8 unseen lines and `attempts` in `details`; the turn converts them into re-prompts |
| signals open, permissions closed | a missing watermark passes (freshness fail-open); a failed membership check reads as "not found" |
| credentials never leave the host | the engine is a DSH session and holds no server credentials |
| every cost is booked | v1 keeps no ledger (Billing is not ported) — recorded as a known cut, never fabricated |
| tenant scope in every query | single workspace (`personal`); queries are bounded by construction |
| cross-tenant reads as "not found" | non-member reads/writes of a room → CONVERSATION_NOT_FOUND, cause undisclosed |
| evidence cannot self-certify | Shipping is not ported |
| the UI invents no state | the panel renders remote facts only; opening a conversation advances the owner's read cursor (server fact) |

## 5. v1 cuts (explicitly not built, with reasons)

| Item | Design source | Handling |
| --- | --- | --- |
| whisper/email rooms, attachment/poll message kinds | §2 | the unions admit only `direct|group` / `text|system`; the extension point is type-level, not a new mechanism |
| the cheap-model judgment (triage's support-model) | §4.2 | v1 triage is fully deterministic (direct rooms wake, mentions route, everything else stays quiet); the model judgment is a configuration extension point |
| meetings (convene), elections, work-claim leases | §4 | not ported (same-room arbitration is already covered by the gates; meetings are the next iteration) |
| hop/context-watermark budgets | §3.2 | the DSH session owns its loop and budget; the turn-level hard boundary is replyTimeoutMs |
| usage/cost ledger | §3/§15 | not ported; run records carry no usage fields (no fabricated numbers) |
| Board/Schedule/Document/Email/Storage attachments | §9-§14 | not ported |
| hosts (managed sandboxes / device pairing) | §8 | the engine is a local DSH session; the three-placement model is not ported |

## 6. Migration and compatibility

- The `im` storage domain **stays at version 1**: accounts/conversations/people/addresses/
  intakes are all preserved; `messages` (the old queue rows), `bindings`, and
  `conversation_sessions` become dormant (definitions kept so older files still open); a new
  `memories` table joins (missing tables read as empty, older files are not rejected).
- New domains: `im_conversation` (rooms/members/messages/counters/reads/client_ids),
  `im_coordination` (watermarks), `im_turn` (runs/run_events/agent_sessions). No data
  migration is needed — room timelines are new facts, while channel accounts and the people
  directory carry over seamlessly.
- **Queue semantics replaced**: inbound durability = the idempotent write keyed by the
  channel message id as clientId (redelivery replays); "crashed mid-processing" = a lagging
  watermark + inbox catch-up on the next wake (design §3.6: never replay a turn, recover via
  the inbox). The old `im_messages` dead-letter/retry machinery is deleted.
- The `autoCreateSession` config is deleted; its replacements are the channel room's fixed
  seat (`channelAgentPreset` in `@veren/im-conversation`) plus coordination triage.
  `replyTimeoutMs` moved to `@veren/im-turn`.
- Compatibility risk: `@veren/im` no longer exports `ImRouter`, `ImMessageQueue`,
  `ImSessionGateway`, or `ImPromptSource` — im-tool/wechat/hub/ui were rewritten in the same
  redesign.

## 7. Adjudicated deviations from the design

| Deviation | Reason |
| --- | --- |
| `companyId` → fixed `personal`, no workspace table | single-host product; the design's own seed convention supports this shape (data.md 21.1) |
| participants are not stored (projection, not a table) | presets live in the host and humans live in the people directory; a table would drift (the shadow-copy ban) |
| the verbatim gate appears both in preflight and in post(gate) | the design requires comparison inside the write transaction; PostGate runs inside the room write chain — equivalent atomicity |
| the panel viewer is fixed to `human:owner` | single-user host; multiple members belong to the Workspace domain, which is not ported |
