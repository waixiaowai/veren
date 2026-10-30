# WorkBuddy / CodeBuddy Upstream Protocol Dossier (CN + International)

> **Evidence status**: every fact in this first edition (2026-10-30) comes from the
> **paid-for, field-measured comments** of the `dsh-workbuddy-oauth/` reference
> implementation (each annotated with its measurement date and upstream provenance)
> and from the request/response shapes defined in its source. **This document does not
> yet contain this plugin's own fresh probe captures** — probes consume real credits
> and carry risk-control exposure; every capture round requires explicit user
> confirmation (see §9). When those rounds run, diff this document against
> `plugins/workbuddy-auth/tests/fixtures/` per §9; where they disagree, the fresh
> capture wins and this document is updated.

Evidence pointer abbreviations:

- **Dossier·file:line** = the annotated code in `dsh-workbuddy-oauth/src/<file>` (each "measured" comment is a paid lesson)
- **fixture:name** = `plugins/workbuddy-auth/tests/fixtures/<name>.json` (this plugin's offline replay sample, shape taken from the dossier)
- **P0-pending** = a fact awaiting the Phase 0 probe rounds

## 0. Region table

The two regions are **separate account systems** (separate quotas, separate sign-in,
different catalog behavior). Regions are data-table driven, never branch-copied.

| | CN (`cn`) | International (`global`) |
|---|---|---|
| API base (chat/catalog/refresh) | `https://copilot.tencent.com` | `https://www.workbuddy.ai` |
| Web origin (Origin/Referer, billing) | `https://www.codebuddy.cn` | `https://www.workbuddy.ai` |
| Login base (OAuth trio) | `https://www.workbuddy.cn` | `https://www.workbuddy.ai` |
| Accept-Language | `zh-CN` | `en-US` |
| X-Auth-Refresh-Source | `workbuddy` | `plugin` |
| chat User-Agent product token | `WorkBuddy/<ver> WorkBuddy/<ver>` | `WorkBuddy AI/<ver> WorkBuddy AI/<ver>` |
| catalog User-Agent | `CLI/2.63.2 CodeBuddy/2.63.2` | `WorkBuddyAI/<ver>` (**no space**) |
| X-Agent-Type: main | **not sent** | sent |

The three domains must **not** be merged: the upstream validates `Origin` against the
web site (Dossier·region.ts:44-48). `loginBase` and `base` are two hosts on purpose:
the state endpoint echoes the host it was called on into the authorization URL, and
the login page is host-scoped per state — the URL the user opens and every follow-up
call for that state must sit on one host (Dossier·region.ts:29-36: phone-number
sign-in on a `copilot.tencent.com` URL is rejected with `无效的token`).

Region inference: the credential's `domain` field (the upstream returns a bare domain
such as `workbuddy.ai`); suffix-matching `workbuddy.ai` ⇒ global, otherwise cn
(Dossier·region.ts:75-78). **Region is recomputed from domain, never trusted from
disk** (Dossier·credentials.ts:151-156).

## 1. OAuth device-code sign-in (the zero-fingerprint zone)

Flow: `state → hand the URL to the user → poll for the token → account`.
Deliberately non-interactive: no TTY, no local callback port (Dossier·oauth.ts:11-13).

The three login endpoints carry **only** the CLI UA and the region's Origin/Referer —
**no device fingerprint headers at all** (no `X-Machine-ID`/`X-Session-ID`; checked
against all three reference implementations; Dossier·fingerprint.ts:26-34). This is
the evidence behind the "zero-fingerprint login" invariant.

### 1.1 POST `/v2/plugin/auth/state?platform=workbuddy` (loginBase)

- Body `{}`. Headers: `loginHeaders(origin)` = JSON Content-Type/Accept +
  `X-Requested-With: XMLHttpRequest` + `Origin`/`Referer` +
  `User-Agent: CLI/2.63.2 CodeBuddy/2.63.2` (Dossier·oauth.ts:24, 131-141).
- `platform=workbuddy`, **not `CLI`**: the desktop app's own authorization URL reports
  `platform=workbuddy`; on a `CLI`-scoped state the page's phone-number flow rejects
  the OneID token (`无效的token`). This is a **evidence-backed divergence from the
  reference implementations** (both send `CLI`) — they are gateway products where the
  CLI flow is the whole product; this plugin signs in on behalf of a desktop-app user
  (Dossier·oauth.ts:27-37).
- Response: `{code:0, msg, data:{state, authUrl}}`.
- The client appends `loginSessionId=<fresh UUID>` to `authUrl` (the endpoint ignores
  it on request; it is the correlation key between the page's OneID phone flow and the
  client — without it the page rejects the token). **`version` is deliberately not
  sent**: the page returns byte-identical HTML with and without it (0.0.1 / 5.5.6 /
  99.0.0 / absent all measured); sending our own would claim a client version nothing
  in the plugin can keep current (Dossier·oauth.ts:39-79).

### 1.2 GET `/v2/plugin/auth/token?state=<state>` (loginBase)

- Same `loginHeaders`. Success: `data:{accessToken, refreshToken, expiresIn(seconds),
  domain}`.
- **Pending shape**: HTTP 200 + `{code:11217, msg:"11217:login ing..."}` with no
  `data` (measured live — tools/login-probe.mjs; an older shape surfaced it as 4xx).
  `code===11217` ∨ `msg` contains `login ing` ∨ HTTP 4xx ⇒ `LoginPending` (a user who
  has simply not finished in the browser must see "waiting", never "failed")
  (Dossier·oauth.ts:265-280).
- Unknown/expired state ⇒ `LoginExpired`; the caller must restart.

### 1.3 GET `/v2/plugin/login/account?state=<state>` (loginBase, Bearer accessToken)

- Response `data:{uid, enterpriseId, nickname}`. A missing uid makes the credential
  unusable (every upstream call needs it) and fails the sign-in
  (Dossier·oauth.ts:406-412).
- On success the state is **retired** (one authorization must not mint a second
  credential); while pending the state must be kept (Dossier·oauth.ts:413-416).

### 1.4 Poll-cadence risk-control constraints (invariants)

- **Poll floor of 3s**: the sign-in endpoints are where an abusive client would hammer
  (tight-loop polling reads as credential stuffing, not a user waiting in a browser).
  The user controls the pace from the browser, so polling faster buys nothing. The
  floor is enforced **before** the request (an impatient retry must not reach the
  upstream at all) (Dossier·oauth.ts:81-96, 344-355).
- **State TTL of 600s**: expire locally a state the upstream has long forgotten
  (matches workbuddy2api-panel's pending window) (Dossier·oauth.ts:98-105).
- **Region-locked redemption**: the region for a poll comes from the **recorded
  attempt**, never a caller argument — a state can only be redeemed at the host that
  issued it (same reason as workbuddy2api's `validateRealmMatch`)
  (Dossier·oauth.ts:332-359).

## 2. Token refresh (rotation semantics)

POST `<base>/v2/plugin/auth/token/refresh`, body `{}`.

- Headers (over the common set): `X-Refresh-Token` (**appears here and nowhere
  else**), `X-Auth-Refresh-Source` (cn=`workbuddy`, global=`plugin` — the upstream
  discriminates refresh origin on this header; getting it wrong is visible to them),
  `X-User-Id`, `X-CodeBuddy-Request: 1`, `Accept-Language` (per region), optional
  `X-Domain`/`X-Enterprise-Id` (Dossier·refresh.ts:70-93).
- The response envelope nests unstably: both `{data:{...}}` and `{data:{data:{...}}}`
  have been seen; unwrap twice (Dossier·refresh.ts:114-134).
- **Rotation**: the response carries a new refresh token and the old one is spent.
  **Two concurrent refreshes race — the second sends a token the first already
  consumed, which the upstream reads as a stolen-token replay**, exactly the shape
  risk control looks for. Therefore: in-process single flight (N callers → one
  request) + the whole read-refresh-write cycle serialized under a lock across
  processes (a second process re-reads the freshly committed token and skips its
  refresh); the lock is held **across the network call** (Dossier·refresh.ts:5-28,
  163-166).
- **Lazy refresh**: refresh only when expiry is within a 5-minute margin (the margin
  exceeds one chat turn, so a token cannot expire between check and use). **Never
  refresh on a timer** — background refreshing multiplies credential traffic for no
  benefit (Dossier·refresh.ts:18-28, 44-51).
- A credential with no refresh token reports "not needed" rather than "needed"
  (otherwise every call attempts a refresh destined to fail); the fix is signing in
  again (Dossier·refresh.ts:107-112).
- When the refresh response omits a new refresh token, the old one remains valid —
  keep it (Dossier·refresh.ts:217-219).

## 3. Chat (streaming completions)

POST `<base>/v2/chat/completions`, an OpenAI-compatible body, **`stream:true`
forced** (the upstream rejects non-streaming).

### 3.1 Request headers (over the common set)

- `Authorization: Bearer <accessToken>`, `Content-Type: application/json`
- Desktop identity family: `X-IDE-Type: WorkBuddy`, `X-IDE-Name: WorkBuddy`,
  `X-IDE-Version: <appVersion>`, `X-Product: SaaS`; chat User-Agent =
  `WorkBuddy/<ver> WorkBuddy AI?/<ver>[ CLI/<cliVer>]` (the international product
  token carries a space: `WorkBuddy AI`) (Dossier·identity.ts:134-145)
- Account identity family: `X-User-Id`/`X-Enterprise-Id`/`X-Domain` — when a field is
  absent send its `X-No-<Field>: 1` counterpart instead; never send a blank header (a
  blank header registers a device with no identity, worse than none)
  (Dossier·upstream.ts:443-460, fingerprint.ts:91-101)
- Device fingerprint family: `X-Machine-ID`/`X-Session-ID` =
  `md5("wb2a:<purpose>:<uid>")` (truncated to 32 hex), derived deterministically from
  the uid — constant per account, isolated across accounts; with an empty uid the
  headers are omitted entirely. **Chat/billing/task endpoints only** (§1 login stays
  zero-fingerprint) (Dossier·fingerprint.ts throughout)
- **X-Agent identity family** (PR #1 measurement: the international gateway answers
  HTTP 400 / 11128 「请求被拦截，请重新发送」 without them):
  - `X-Agent-Intent: craft` + `X-Agent-Purpose: conversation` + `X-Agent-Type: main` —
    the **full trio goes out on both regions**.
  - **Measured divergence from the dossier, 2026-10-30 on the live wire**: the CN chat
    endpoint answers 400/11128 「请求被拦截，请重新发送」 to a request carrying only
    intent/purpose, and passes once `X-Agent-Type: main` is added — CN risk control has
    converged with the international one. The dossier's (2026-09) CN asymmetry is
    obsolete; the trio is the only form measured good everywhere today (evidence: this
    plugin's live acceptance session + the CN assertion in
    `tests/upstream-client.spec.ts`).
- **Conversation-tracking family** (`withGatewayChatHeaders`,
  Dossier·upstream.ts:640-690):
  - `X-Conversation-ID` = first 32 hex of `sha256("<process salt>|conversation|<conversation key>")`;
    the key prefers the harness session key, else the first genuine user message signature
  - `X-Conversation-Request-ID` = first 32 hex of `sha256("<process salt>|turn|<conversation key>|<turn key>")`;
    the turn key = position+content signature of the **last genuine** user message
    (tool-result-only messages are skipped)
  - `X-Conversation-Message-ID` = `X-Request-ID` = fresh random 32 hex (a new pair per
    outbound message)
  - **Why**: the upstream counts one user send as one request by
    `X-Conversation-Request-ID`; a fresh id per call fragments one send into many rows
    in the usage detail. Retries / tool continuations / account changes keep the turn;
    the user's next message starts a new one (Dossier·upstream.ts:525-611)
  - **Raw local session ids are never forwarded**: derived ids are salted (fresh salt
    per process) so they cannot be read back as the text they came from
    (Dossier·upstream.ts:509-517)
  - Caller-carried headers win over derivations; never add case-variant duplicates of
    an existing header (fetch would combine their values) (Dossier·upstream.ts:670-679)

### 3.2 Body translation

- `stream: true` forced; `developer` role rewritten to `system` (the upstream rejects
  the developer role: HTTP 400 / 11128 "Illegal API invocation from an unapproved
  channel") (Dossier·upstream.ts:708-744)
- `tool_choice` flattened to a string: `none` ⇒ drop the field and delete
  `tools`/`functions` with it; object `{type:'auto'|'required'}` ⇒ the literal;
  `{type:'function', function:{name}}` ⇒ the function name; anything else ⇒ drop the
  field. Object forms sent verbatim get 400 (Dossier·upstream.ts:746-784)
- `reasoning_effort: 'off'` is **dropped on both regions** (omission is the only form
  measured good everywhere; a literal `'none'` is *not* a safe substitute — the
  GPT-5.6 family and GLM accept it, `gpt-6-astra` rejects it). The international GPT
  family rejects `off` with 400/11133 (`extError.param='reasoning.effort'`); CN
  rejects it on `onlyReasoning` models with 400/11150 (Dossier·upstream.ts:1654-1686)
- **International only**: the first message must be a system prompt, else 400/11128
  "first message is not system prompt" — prepend
  `{"role":"system","content":"You are a helpful assistant."}` when absent (prepend,
  never merge; existing messages keep their order) (Dossier·upstream.ts:1618-1652)
- International probe `max_tokens` floor: the GPT-5.6 family rejects `1`
  (400/11133 `integer_below_min_value`), so probes ask for 16
  (Dossier·upstream.ts:1266-1288, 1699-1706)

### 3.3 Response

- Success: SSE (`data:` lines of JSON, closed by `[DONE]`). Delta shape is
  OpenAI-compatible (`choices[].delta.{content,reasoning_content,tool_calls}` + a
  usage tail block).
- Failure: a JSON body (truncated to ≤4KB when kept), shapes seen:
  `{error:{data:{code,msg}}}` / `{extError:{code,param}}` / `{displayMsg:{zh,en}}` /
  `{code,msg}`.

## 4. Model catalog

GET `<base>/v3/config`, same path, **split by User-Agent** (the gateway splits the
roster by client identity, and the split is load-bearing):

- CN uses the CLI UA (`CLI/2.63.2 CodeBuddy/2.63.2`) ⇒ the CLI roster — exactly the
  chat models this plugin can serve
- International uses the App UA (`WorkBuddyAI/<ver>`, **no space** — the spaced form
  is rejected with 400/12403) ⇒ the App's internal roster
  (Dossier·upstream.ts:978-1048, identity.ts:147-161)
- International additionally sends `X-Requested-With` + `X-Product: SaaS`
- Two response shapes: usually the `{code,msg,data}` envelope; the international
  `/v3/config` has also answered with the **bare product document** (no envelope) —
  when `data` is missing but the document itself carries `models`/`agents`, the
  document is the answer (Dossier·upstream.ts:1027-1036)
- Membership = the `agents[name='cli'].models` roster ∩ usable rows (no row /
  `disabled:true` / non-positive `maxInputTokens` or `maxOutputTokens` ⇒ dropped); a
  missing roster or empty intersection is a hard error (Dossier·upstream.ts:1406-1475)
- Row fields: `{id,name,maxInputTokens,maxOutputTokens,contextWindow:{defaultLength,supportedLengths}
  (international only),supportsImages,disabledMultimodal,supportsReasoning,onlyReasoning,reasoning:{supportedEfforts,defaultEffort|effort,canDisableThinking},credits,tags}`;
  the effort vocabulary is the closed set `low|medium|high|xhigh|max` (`minimal`
  exists in no upstream vocabulary); `canDisableThinking` counts as true only when
  explicitly `true` (older rows omit the field and several of them reject `off` on the
  wire, so the conservative default is "cannot disable") (Dossier·upstream.ts:227-270)
- Billing: `credits` looks like `x0.79` or `x0.79 credits` (the unit word is trimmed
  to the language-neutral `x0.79`); `badge:<label>:<color>` tags exist only in the
  console document `/console/enterprises/personal/models` (CN merges them in a
  best-effort second read; its failure costs the badges, never the catalog); `x0.00`
  ⇒ free. The international document carries `modelPromotions` (time-boxed discounts;
  only `displayMode:'replace'` is adopted; cached rows are **re-evaluated against the
  clock** — a promotion no longer in force forfeits the quote and reports
  `rateUnknown`, never keeps claiming free) (Dossier·upstream.ts:272-332, 1477-1589)
- The roster churns fast (`auto`, `kimi-k3-1`, `minimax-m3` each appeared and
  vanished within days); the static fallback table is a boot-time placeholder, never
  a promise (Dossier·catalog.ts:14-38)

## 5. Billing / credits

POST (billingBase), two shapes chosen by account type (Dossier·upstream.ts:1102-1263):

- **Personal** (international always; CN accounts without an enterprise id):
  `/v2/billing/meter/get-user-resource`, body
  `{PageNumber:1,PageSize:100,ProductCode:'p_tcaca',Status:[0,3],PackageEndTimeRangeBegin/End:<local
  time YYYY-MM-DD HH:mm:ss>}`; the answer is `data.Response.Data.Accounts[]` with
  `CycleCapacitySize/CycleCapacityRemain/CycleCapacityUsed/CapacityRemain/CapacitySize/PackageName`;
  see Dossier 1160-1181 for the precedence
- **CN enterprise** (cn with a non-empty enterpriseId; the region gate is load-bearing
  — an international credential that happens to carry an enterpriseId stays on the
  measured personal path): `/v2/billing/meter/get-enterprise-user-usage`, body `{}`,
  identity travels in headers only; both official field spellings are accepted
  (`limitNum/credit` vs `limit_num/used_num`); `limitNum===-1` means uncapped (a
  separate flag, never rendered as 0); a missing recognizable field is a **hard
  error**, not 0 ("a plausible wrong number" is exactly how issue #31 stayed
  invisible for years) (Dossier·upstream.ts:1184-1263)
- Headers: `Authorization` + `X-User-Id`/`X-Enterprise-Id`+`X-Tenant-Id`/`X-Domain`
  (Dossier·upstream.ts:692-706)

## 6. Error taxonomy (the load-bearing order)

`classifyUpstreamError(status, body)` (Dossier·upstream.ts:336-370). **Credit is
checked before the status-code fallbacks, deliberately**:

1. HTTP 402 ⇒ `hard_credit`
2. HTTP 401 ⇒ `session_dead` (no business meaning overrides a 401; markers like 12153
   are additional signals only)
3. Body carries a credit marker (lowercase ASCII set + the original Chinese set,
   including 「额度**已**用尽」 — **measured 2026-09-30**: a genuinely exhausted
   account answers **HTTP 429** + `{"error":{"data":{"code":14018,"msg":"额度已用尽，…购买加量包…"}}}`,
   not 402; earlier marker lists missed the 「已」 variants, so exhaustion was
   classified `soft_rate` and dead accounts were retried forever) or body contains
   `14018` ⇒ `hard_credit`
4. Body contains `Offline user session not found` ∨ `12153` ⇒ `session_dead`
5. HTTP 429 ⇒ `soft_rate`; 404 ⇒ `not_found`; 5xx ⇒ `server`; other 4xx ⇒ `client`

Cooldown taxonomy (Dossier·shim.ts:42-45): `hard_credit` 1h (it does not heal until
the user pays), `soft_rate` 1min, `server` 10s. `session_dead`/`client`/`not_found`
get no cooldown (retrying is pointless or needs a human).

User-facing message extraction: `displayMsg.zh` > `displayMsg.en` > `msg`
(Dossier·upstream.ts:372-400).

**11128 is double-meaning**: on CN it reports the developer role; internationally it
reports a non-system first message — **never branch region logic on the code alone**
(Dossier·upstream.ts:1618-1626).

## 7. Reasoning-effort probe (consumes credits; double-confirm)

`probeModel` (Dossier·probe.ts): baseline (no effort) → sentinel (a fresh impossible
value) → per-level sweep. The order is semantics, not optimization: baseline proves
the request path works; the sentinel answers "does the upstream validate the field"
(accepting an impossible value = non-validating, per-level results would be uniformly
false positives); level results mean something only after the sentinel was refused.
Verdicts: `400 + extError.code ∈ {invalid_reasoning_effort (measured CN),
model_param_invalid (measured international 2026-10-01)}` = an attributable
rejection; `200 with one data event actually streamed` = acceptance (the body is
cancelled right after the first event). A non-decisive answer mid-sweep ⇒ the whole
run is `unknown` (a partial list is not a finding). A probe conclusion is ever "the
upstream accepted these spellings", never "these spellings change what the model
does". `off` is never probed (disabling thinking is declared by the catalog's
`canDisableThinking`, not inferred).

## 8. Multi-account pool and logout

- **Selection** (Dossier·store.ts:103-125): region filter → exclude disabled →
  prefer unexpired tokens → prefer uncooled → ring-order rotation; when everything is
  cooled, serve the **soonest-to-recover** account (refusing would park the whole
  pool; a short wait on the least-bad account beats a hard failure)
- **Session stickiness that never sticks to a bad account**
  (Dossier·store.ts:223-245): a conversation's pinned account is reused **only while
  still selectable** (cooled/disabled pins are ignored — a pinned conversation must
  not bypass cooldown); with no live pin, rotate and pin. Stickiness is not persisted
  (a 30-minute TTL does not survive a host restart anyway)
- **Cooldowns persist across restarts**: an account that exhausted its credit an hour
  ago must not be retried right after a restart (the failure it would hit is exactly
  the one the cooldown exists to avoid). The rotation cursor is not persisted
  (restarting from the first account is harmless) (Dossier·cooldown-state.ts:5-15)
- **Logout's four-class purge** (Dossier·account-purge.ts + README): credential /
  cooldowns / disabled state / probe records — **all four are keyed by uid**; deleting
  only the credential leaves the uid in the rest (a privacy leak, and a re-sign-in of
  the same uid would silently re-apply an old disabled flag or stale probe verdict).
  In this plugin all four live in one credential-record document, so logout removes
  the uid from all four atomically (trade-off in the plugin README)

## 9. Maintenance runbook (when the upstream drifts)

1. **Re-run the Phase 0 probes first** (`dsh-workbuddy-oauth/tools/`: login-probe /
   live-probe / credit-error-probe / auth-host-flow-probe) and diff
   `plugins/workbuddy-auth/tests/fixtures/`:
   - Probes consume **real credits** and carry risk-control exposure; **state that
     clearly and obtain user confirmation before every capture round**
   - Capture order per region: auth state → polling (including the 11217 pending
     shape) → account → refresh (verify rotation semantics) → catalog → one real
     chat SSE → error shapes (credit exhausted / rate limited)
   - Tokens/uids/nicknames are **redacted before** anything lands in
     `plugins/workbuddy-auth/tests/fixtures/`
2. Any divergence from the reference implementations needs a measured reason
   (template: the `platform=workbuddy` divergence comment in Dossier·oauth.ts)
3. Contested details are settled by what workbuddy2api-hub/panel + connect observed
4. No stability is promised for the upstream's non-public interfaces; this document
   is the only contract surface for what "stable" means

**P0-pending list** (what this plugin's own probe rounds must re-verify): §1 all
endpoint shapes and the 11217 form, §2 rotation semantics and the
X-Auth-Refresh-Source discriminator, §3.1 live acceptance of the header families,
§4 current state of the two-UA split, §6 credit/rate-limit error shapes, the
dossier's static catalog tables vs the day's live roster.
(Closed item: the X-Agent trio on both regions — measured live on CN, 2026-10-30; see §3.1.)
