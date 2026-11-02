# cms Admin "Channel Ops" GUI (WeChat channel + taskhub) — Deepened Task Book (Four Questions)

Status: **awaiting execution** (filed 2026-11-03; four-question deepening + forensics on record).
Origin: user asked "does the cms admin have WeChat/Feishu binding pages" → verdict: OAuth login binding exists (/profile, six platforms), **message-channel/bot binding GUI is absent** (full imhub API exists, zero hits in web) → user ordered the four-question deepening.

## 0. One-sentence restatement

Turn every step hand-performed during the 2026-11-02 WeChat-channel rescue (start challenge → render QR → poll → discover the required service restart → verify cursor advance → deliver a test reply) into two admin pages: "Message channel" (imhub WeChat authorization funnel + liveness evidence + message log + structured intake switches) and "Task router" (taskhub list + per-task timeline replay + requeue + worker pool); fix the authorized-doesn't-resume-polling defect **first**; Feishu gets a **bounded decision memo only**, zero code.

**Depth-not-breadth hard boundary (three zeros)**: zero new permission codes (imhub:manage / taskhub:read|manage / config:manage all exist), zero new migrations, zero protocol changes.

## 1. Forensics on record

- **Defect ⑤ (foundation, fix first)**: the `domain_stack.go` assembly comment promises "takes over within 5s after QR authorization", but `imhub/service.go pollOnce` lets the poller goroutine **exit permanently** on -14 (ErrAuthRequired); the "idle wait, re-check session row" path exists only for the never-had-a-session case. Proven live: 2026-11-02 production authorized landed while the channel stayed dead until `systemctl restart cms` (delivery notes on record).
- **"authorized" ≠ alive**: a session row existed (2026-10-28) while iLink was actually -14 for days; raw SQL + unsealed-token direct probe settled it. **No liveness read face exists** (last successful poll / cursor advance / message throughput have no API).
- **imhub API complete** (`routes.go`/`user_routes.go`): authorize/status/verify, session projection, messages log, people directory, replies delivery (device face Bearer + imhub:read). Envelope {code,message,data}.
- **LoginStatus closed set** (ilink.go verbatim): wait|scaned|need_verifycode|confirmed|expired|verify_code_blocked|binded_redirect; -14 = login dead.
- **QR challenge expires in ~2 minutes** (2026-11-02: the first QR died before the user scanned); repeated POST authorize returns the current attempt (no stacking).
- **taskhub API complete**: tasks list/detail (task_events timeline)/requeue/workers (codes 7700-7799, taskhub:read|manage). Real production data exists: failed task `01M6EAQMVBXZXMESDVHVPW7W0C` timeline holds received→matched→task_reply→10×reply_failed(-14)→failed — the negative-path fixture is ready-made.
- **Closest web precedent**: `web/src/features/ws/` (live connection polling + node identity + raw message panel, tested); structured-config-page precedent T317 (a dedicated form beats a raw KV editor); menu seed C-row + sidebar-data + route-perms double-guard discipline.
- **Inheritable second implementation**: cursour `plugins/im/ui` cloud-tab funnel (a ≥9-state inventory recorded in its rewrite log); for Feishu, read `D:\cms docs/im-content-routing.{cn,}.md` (3b5200e4, pending review) first.
- **OAuth login binding already has a page** (/profile connected-accounts, six platforms): untouched by this task — different semantics (login identity ≠ message channel).

## 2. Four-question conclusions (condensed)

- **Q1 professional additions**: liveness-evidence card (never trust "authorized"); fix the poller-resume defect before building UI; the hand-operations checklist = the missing-affordances checklist; QR countdown + auto-refresh; timeline replay as the centerpiece; intake form states its in-flight semantics (mode change affects new messages only); C reads the review doc before issuing a bounded memo.
- **Q2 rawest material**: §1's Go sources / ws-page precedent / im-ui state inventory / incident records / real events fixture / content-routing review doc.
- **Q3 methods**: per-state one-screen mapping table first; red-green for the defect; component tests drive the funnel through every state (-14 via base_url→stub); real events as fixtures; seed/ROUTE_PERMS/sidebar guard discipline; per-state screenshots.
- **Q4 external judges**: a blind operator completes re-authorization + visible cursor advance + phone receives the reply using only the GUI (no hand tools, no restart); stub proves the dead-channel page says "disconnected"; GUI replay ≡ sqlite double-source; Go pin red→green + staging restart-free takeover; C memo adjudicated against the review doc.

## 3. Ruling points

| # | Fork | Ruling | Basis |
|---|------|--------|-------|
| D1 | Liveness source | **new imhub status read face** (session projection gains last_poll_ok_at + cursor + 1h message count); frontend forbidden from improvising | single fact source; a frontend guess is a second lying face |
| D2 | Funnel state pin | **LoginStatus closed set, one screen per state** (including -14 dead and expired recovery moves), contract-pinned tests | im-ui ≥9-state lesson; we lived it |
| D3 | taskhub page center | **per-task timeline replay first** (reads events directly, negative paths equally prominent), list secondary | yesterday's real debugging path |
| D4 | intake six keys | **in-page structured form** (reads config + PUT /v1/admin/configs/{key}, type:string ready), form states in-flight semantics; no new generic KV entry | T317 precedent |
| D5 | Feishu | **decision memo only** (docs/notes/ candidate), citing im-content-routing's existing scope with bounded options; zero Feishu code in this task | depth, not breadth |
| D6 | Boundary | the three zeros (§0) + no touching /profile OAuth binding + no email/webhook channels | depth, not breadth |

## 4. Breakdown & acceptance

- **B0 foundation (before any UI)**: ① imhub poller-resume defect red-green fix (regression pin "after -14 death → re-authorization → takes over ≤5s without a process restart" — red today) + verify the assembly comment against reality; ② D1 liveness read face + tests. Staging (3100) live: QR re-auth restart-free, cursor advance visible.
- **A message-channel page**: `/channels/wechat` (mounted in the existing admin menu group, seed/sidebar/route-perms triple guard); liveness card, authorization funnel (QR countdown + auto-refresh + verify-code input + per-state screens), message log (reuse the ws panel patterns), people directory, structured intake form. Component tests drive all states including the -14 stub state; screenshots per state.
- **B task-router page**: `/channels/taskhub`: list (status filter) + detail timeline replay (real fixture: yesterday's failed task) + requeue (manage) + worker pool. Replay-vs-sqlite consistency check.
- **C memo**: `docs/notes/` candidate draft — the two Feishu semantics (feishuhub-into-cms vs node-side credential custody), forensics, cost, alignment with the content-routing review doc; user decides; zero code.
- **Final adjudication (Q4's four items, each evidenced)**: blind operator completes everything via GUI → sends "任务：…" on WeChat → taskhub timeline reaches replied + phone receives the reply; dead-channel stub state renders "disconnected"; staging restart-free proof; Go pin red→green.

## 5. Red lines

Both repos' AGENTS.md copied for self-check (cms: ≤300/60 lines, red-green both ways, seed/permission central registries append-only, auditMW on admin write routes; web: three-state completeness, zero console errors, tsc/lint/build green). Envelope always {code,message,data}; never judge availability by HTTP 200. Zero credentials at rest (device key plaintext only in the creation response). No changes to existing imhub endpoint behavior contracts (D1 only adds a read face).

## 6. Termination condition

A blind operator, without internal docs or hand tools, using only these two pages: re-authorizes WeChat (restart-free, cursor advance visible on the page) → sends "任务：…" on WeChat → the taskhub timeline shows every hop and the phone receives the reply; a -14 dead channel is honestly rendered "disconnected" under the stub; yesterday's failed task's GUI replay matches sqlite row-for-row. When all four hold, the task closes.
