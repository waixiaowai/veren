# iLink send-face contract (v1)

> **Status: adjudicated by external evidence.** This document submits the three
> unproven assumptions behind the 2026-11-02 "production sendmessage is always
> `-14`" incident (missing notifystart, misplaced version header, TS reference
> as proof) to the verdict of recorded wire traffic. The corpus is the JSONL
> written per request by the recording proxy (`D:\cms\scripts\ilink-recorder`)
> inserted at `im.hub.base_url`; copies and SHA256 live in §5.
>
> Scope: the iLink **send face** (`notifystart` / `sendmessage`) only. The frame
> shapes in `docs/taskhub-protocol.cn.md` are untouched; appendix A adds the
> send-face facts to that contract's world.

## 1. Endpoints and wire shape

### 1.1 Endpoints

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/ilink/bot/msg/notifystart` | POST | open the bot's message session | Bearer bot token |
| `/ilink/bot/sendmessage` | POST | deliver one message to one user | Bearer bot token |
| `/ilink/bot/getupdates` | POST | long-poll inbound (control only here) | Bearer bot token |

### 1.2 Request headers (shared by both send endpoints)

| Header | Value | Required | Evidence |
|--------|-------|----------|----------|
| `iLink-App-Id` | `bot` | always | every recorded frame |
| `iLink-App-ClientVersion` | decimal version | always; **the value is not a gate** | 132102 and 4102 both succeed (§4 F2) |
| `content-type` | `application/json` | with a body | every recorded frame |
| `AuthorizationType` | `ilink_bot_token` | authenticated calls | every recorded frame |
| `X-WECHAT-UIN` | 4 random bytes, base64 | always (no identity meaning) | differs per call, accepted |
| `Authorization` | `Bearer <bot token>` | always | missing/tampered → `-14` |

### 1.3 Bodies

`notifystart`:

```json
{"base_info":{"channel_version":"2.4.6","bot_agent":"cms-imhub/0.1.0"}}
```

`sendmessage`:

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<wxid>@im.wechat",
    "client_id": "cms-imhub-<unixnano>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [{"type": 1, "text_item": {"text": "<body>"}}],
    "context_token": "<optional; the session token carried by an inbound message>"
  },
  "base_info": {"channel_version": "2.4.6", "bot_agent": "cms-imhub/0.1.0"}
}
```

- `context_token` **may be omitted**: the `no-context` probe cell returns 200 +
  `message_id` (§4 F3). The upstream still delivers by `to_user_id`; sending it
  is the safer path (the TS reference always does).
- `item_list` is text-only (type=1); images/files are out of scope.

### 1.4 Responses

Success: HTTP 200 with `message_id` (a large integer; clients must treat it as
text or preserve it exactly):

```json
{"message_id":7523196763132315000}
```

Failure: HTTP 200 with an error field (`ret` or `errcode`), verbatim examples:

```json
{"ret":-3}
{"errcode":-14,"errmsg":"session timeout"}
```

## 2. Error semantics and client classification

| Upstream | Meaning | Go (`internal/imhub`) | TS (`@veren/im-wechat`) |
|----------|---------|------------------------|--------------------------|
| no `ret`/`errcode` or 0, with `message_id` | delivered | success | success |
| `errcode:-14` / `ret:-14` (`session timeout`) | session dead | `ErrAuthRequired` (since dae4b926) | `IM_SEND_REJECTED` (**divergence, §4 F5**) |
| `ret:-3` | unresolvable recipient | `ErrSendRejected` | `IM_SEND_REJECTED` |
| any other non-zero | business refusal | `ErrSendRejected` | `IM_SEND_REJECTED` |

`-14` is **session-level**: the same token dies for both `getupdates` and
`sendmessage` (2026-11-02: getupdates returned -14 from 11:15; sendmessage from
13:49). There is no recorded case of "poll dead but send alive"; clients must
not split the two.

## 3. Session lifecycle (observed)

```text
QR authorization ──▶ bot token (new session)
                        │
                        ├─ notifystart (open the message session; TS calls it before polling)
                        ├─ sendmessage (send face)
                        └─ getupdates (inbound face)
                        │
                upstream declares it dead (errcode:-14, "session timeout")
                        │
                        ▼
                re-scan the QR (the only recovery; no renewal API)
```

Observed token ages:

| bot | authorized (UTC) | last successful send (UTC) | age | note |
|-----|------------------|----------------------------|-----|------|
| `37a660d79cde@im.bot` | 2026-10-27T17:50:53Z | none (all -14 from 13:49) | dead at 5.8 days | re-authorized |
| `959aef235f2b@im.bot` | 2026-11-02T14:57:50Z | 2026-11-03T01:38:32Z | 10h40m (at observation) | still alive |

Conclusion (observational, not a claimed TTL): a token can be declared dead
within a week; the only proven recovery is a fresh QR scan. Request shape
(version header, context_token, notifystart) does **not** clear `-14` on a dead
session.

**Raw material: notifystart in the reference implementations.** The Node spike
`apps/im-hub/src/session.ts` (`startPolling`) calls `getUpdates` directly and
does **not** call `notifyStart`; the TS reference `@veren/im-wechat`
(`monitor.ts`) calls `notifyStart` before the long-poll loop. The Go hub was
ported from the spike, which is where the omission came from — evidence that the
port followed the wrong reference, not evidence that notifystart is necessary
for `-14` (see F1).

## 4. Adjudication (pre-registered assumptions → wire evidence)

| Id | Assumption | Evidence | Verdict |
|----|------------|----------|---------|
| F1 | The missing notifystart is the main cause of `-14` | The current token had notifystart called at service start (01:37:57, ret=0) and then sent successfully; but "the same token with notifystart never called" cannot be constructed (the old token is dead, a new one needs a user scan) | **Neither falsified nor proven**: notifystart stays a client duty; it cannot be called the incident's root cause |
| F2 | The `4102` version header contributes to `-14` | Probe `version-4102`: notifystart ret=0, sendmessage 200 + `message_id` (corpus case `sendmessage-ok-4102`) | **Falsified**: the value is not a gate; 132102 is a client convention, not an upstream requirement |
| F3 | `context_token` is required to send | Probe `no-context`: omitted, still 200 + `message_id` | **Falsified**: optional; sending it is safer, its absence is not a refusal |
| F4 | The TS reference verified same-age-token sending in production | In the searchable estate the TS direct account (`32beb5e8c47d@im.bot`) last refreshed its token on 2026-10-26; every later inbound/reply for that account went through im_hub (provider=hub), and the TS direct `sendmessage` has no production success record | **Falsified**: the TS send path is unit-tested only, so it cannot stand as "already fixed" proof |
| F5 | Both clients classify `-14` the same | Corpus case `sendmessage-ret-14`: Go → `ErrAuthRequired`, TS → `IM_SEND_REJECTED` (TS is the deliberately unchanged control group) | **Divergence pinned**: the contract requires new clients to classify it as session-dead; the TS gap is known debt, out of scope here |

**Incident attribution (evidence level)**: the 11-02 `-14` was not about request
shape; it was the upstream declaring the old session dead (`session timeout`).
The re-scan at 14:57 was the only recovery that worked. Among the four fixes,
dae4b926 (-14 classification) corrected **retry semantics** (a dead session is
no longer retried as a business refusal), 4b3aaf3b (notifystart) is
**alignment hardening** with the TS reference, and f2d7d863 (watchdog) plus
8873935 (completion/refusal reporting) fix **delivery and convergence**. None of
them is the cause of `-14`.

## 5. Recorded corpus and dual-client replay

- Corpus: `docs/evidence/ilink-send-20261103/ilink-send-cases.jsonl` (6 cases)
- SHA256: `bbeef4cf3706f0066615b0605d117342048465b94a829af132f5ec97b2ea6a41`
- Byte-identical copies (CI checks the hash):
  - Go: `D:\cms\internal\imhub\testdata\ilink-send-cases.jsonl` (`corpus_test.go`)
  - TS: `plugins/im/wechat/tests/fixtures/ilink-send-cases.jsonl` (`tests/ilink-replay.spec.ts`)

Cases:

| id | upstream body | Go verdict | TS verdict |
|----|---------------|------------|------------|
| `notifystart-ok` | `{"ret":0}` | success | success |
| `notifystart-ret-14` | `{"errcode":-14,"errmsg":"session timeout"}` | session dead | `IM_AUTH_REQUIRED` |
| `sendmessage-ok` | `{"message_id":7523196763132315000}` | success | success |
| `sendmessage-ok-4102` | `{"message_id":7523205129804093000}` (request header 4102) | success | success |
| `sendmessage-ret-14` | `{"errcode":-14,"errmsg":"session timeout"}` | session dead | `IM_SEND_REJECTED` (known divergence) |
| `sendmessage-ret-3` | `{"ret":-3}` | delivery refusal | `IM_SEND_REJECTED` |

CI duties:

- Go: `go test ./internal/imhub -run 'Corpus'` — replay responses + pin request shape.
- TS: `pnpm --dir plugins/im/wechat test` — same corpus, response replay + shape pin.
- Copying the corpus without updating §5's SHA and case table is caught by the hash test.

## 6. Open items

1. **notifystart necessity** (F1) needs a new scanned token on which notifystart
   is never called; only the user can mint that token. Until then, clients must
   call it.
2. **TS `-14` classification** (F5): TS is the control group and is unchanged
   here; if it ever takes the production send path it must classify the error as
   session-dead and stop retrying.
3. **Token lifetime**: at least a week of passive observation (authorization
   time vs first `-14`) is needed before quoting a TTL range; this contract
   records points, not a curve.
4. **The old-token probe cell was not run**: the only older real token belongs
   to the TS direct account (`32beb5e8`, refreshed 2026-10-26), a different bot
   family, and moving a desktop credential onto the production box exceeds this
   wave's credential policy. The axis is marked "not exercised (needs a new
   user-minted token or explicit permission to migrate the old one)"; see
   `docs/evidence/ilink-send-20261103/ts-send-history.json`.

## Appendix A: send-face facts (append-only appendix for `taskhub-protocol`)

- Origin delivery failures split into **session-dead (-14)** and **delivery
  refused (-2/-3/other)**. The former must not consume the delivery-retry
  budget; it ends the task as `failed` with a re-authorize notice. Only the
  latter enters the retry budget.
- A `sendmessage` success is HTTP 200 with `message_id` in the body; `ret=0` is
  acceptable, but `message_id` is the only checkable delivery identity.
- `context_token` is a session hint, not a per-message requirement; its absence
  can still deliver, so a client must not refuse to send for lack of it.
- Negative replies and result replies share one delivery face: at most one
  successful outbound per task (ledger UNIQUE + in-process serialization), and
  `-14` is handled as session-dead.

## Appendix B: evidence index

| File | Content |
|------|---------|
| `docs/evidence/ilink-send-20261103/probe-matrix.jsonl` | per-cell probe results (baseline / 4102 / no-context / no-notifystart / dead-token / bad-target) |
| `docs/evidence/ilink-send-20261103/history.json` | production authorization/staleness/delivery timeline (no credentials) |
| `docs/evidence/ilink-send-20261103/ts-send-history.json` | the TS direct account's token time and the checkable "no direct send record" fact |
| `docs/evidence/ilink-send-20261103/ilink-send-cases.jsonl` | recorded corpus (redacted) |
| `docs/l1-fleg-rerun-2026-11-03.md` | L1 pre-registration and verdict table |
