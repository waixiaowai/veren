# OpenCode Go Bridge Plugin: Design and Forensics Record

**Status**: implemented, unit tests green (25/25), typecheck passes; stable-node live acceptance and release pending.
中文：[opencode-go-plugin.cn.md](opencode-go-plugin.cn.md)

## 0. One sentence

`@veren/opencode-go` serves the OpenCode Go subscription as a first-class dsh model route: a guided sign-in flow (via the `ctx.authorization` + `ctx.credentials` seams) plus a dedicated provider adapter (via the `ctx.llm` adapter SPI, OpenAI-compatible wire against `opencode.ai/inference/go`).

## 1. Forensics conclusions (2026-10-28, primary evidence throughout)

| Question | Conclusion | Evidence |
|---|---|---|
| v2 auth method | **No OAuth/device flow.** The official channel = create an API key at `https://opencode.ai/auth` and paste it. The CLI's own login hint (extracted from the embedded JS of binary 1.19.2): "Create an api key at https://opencode.ai/auth" | opencode.exe string forensics; local `auth.json` holds two `type:"api"` entries with 51-char keys |
| "Console no longer shows the key" | The v2 console (/console) no longer displays keys; key creation lives on the /auth page | User report + official v2 docs describe only the console subscription path |
| Whitelist / client blocking | **Key holders with an honest UA pass freely.** Live-tested with a non-opencode UA: `GET /inference/go/v1/models` → 200 full listing; `POST /inference/go/openai/v1/chat/completions` (deepseek-v4.1-flash) → 200 real completion | 2026-10-28 live probe (real Go key) |
| Endpoint shape | Listing: `/inference/go/v1/models` (standard OpenAI list); chat: `/inference/go/openai/v1/chat/completions`; per-conversation `x-opencode-session` required; official multi-protocol translation | v2 official docs + live probe |
| Quota surface | Responses carry `usage.opencode = { billing_source:"go", list_cost, allowance, tokens{…} }` | Live response body |
| Client identity | `x-opencode-session` + honest UA (docs explicitly call for non-generic SDK names) | v2 official docs |
| Existing dsh capability | pi-ai already ships opencode-go (models.dev catalog, baseURL stale at /zen/go); its api-key login is paste-only (v2 has no key to paste) — exactly the gap this plugin fills | pi-ai 1.1.0 dist forensics |
| Credential grammar | Records `<scope>/<id>`: `opencode-go/account` is legal (lowercase-hyphenated segment); api-key record shape `{kind:'api-key', key}` | dsh-credentials / llm-pi-ai auth.ts |
| Authorization seam rules | One flow per credential key (`DUPLICATE_FLOW`); a flow must commit its record before resolving (`NOT_COMMITTED`) | dsh-authorization source |

## 2. Architecture

```
Sign-in flow (ctx.authorization.registerFlow)
  Method 1 console-key: notify(/auth entry) → prompt(paste) → GET /models online validation → commit record
  Method 2 import-local-cli: read-only import of the opencode-go entry from ~/.local/share/opencode/auth.json
        ↓ commit {kind:'api-key', key} → the opencode-go/account record (persisted by credentials-local)
Dedicated adapter (ctx.llm.registerAdapter(['opencode-go'], adapter))
  stream(): requireStoredKey → translateRequest → fetch(chat/completions) → SSE aggregation → StreamChunk
  listModels(): signed out = empty (signed-out facade); signed in = static snapshot ordered/appended by the online listing (background freshness)
```

Key decisions:

- **Do not reuse the pi-ai route**: its flow key is taken by the paste-style flow (DUPLICATE_FLOW) and its catalog baseURL lags v2. The dedicated adapter owns the v2 front door, quota semantics, and facade semantics.
- **Invent no new mechanisms**: credentials, authorization, catalog caching, 401-keeps-login — all mapped from the llm-deepseek-account precedent.
- **Key hygiene**: the key exists only inside the credential record and request headers — never in config, never in logs; the local import is strictly read-only.

## 3. Contracts

- **Request headers**: `Authorization: Bearer`, `x-opencode-session` (`GenerateOptions.sessionId`, falling back to a process-stable anonymous value), harness attribution headers (harness-owned names win UA collisions — the honest gateway-facing identity).
- **Error mapping**: 401→`KEY_INVALID` (login kept), 402→`QUOTA_EXCEEDED`, 403→`ROUTE_FORBIDDEN`, others→`UPSTREAM_ERROR` (status preserved); unsigned requests→`SIGN_IN_REQUIRED`.
- **Usage conversion**: TokenUsage counts are disjoint — `inputTokens = prompt_tokens − cached − cache_write`; `reasoning_tokens` reported separately.
- **Block order**: reasoning block first (the DeepSeek-family gateway shape) → prose → tool calls (aggregated by wire index); the stream always settles with one finish (abort → `aborted`).
- **Catalog merge**: the static snapshot (30 models, generated from pi-ai data) is the body; the online listing only orders and appends, never shrinks; a failed fetch keeps the previous catalog.

## 4. Test map (25 cases green)

| File | Coverage |
|---|---|
| `tests/stream.spec.ts` | Real gateway SSE shape red/green, tool aggregation, usage conversion minus cache, abort settling, in-band error, concurrency isolation |
| `tests/wire.spec.ts` | Role dispatch, reasoning not replayable, tool replay, header composition, 4-state error mapping |
| `tests/adapter.spec.ts` | Full chain on a mock gateway (credential → headers → translation → SSE), signed-out facade, 401 keeps login |
| `tests/auth-flow.spec.ts` | Commit only after validation, 401 stores nothing, local import enforces entry shape (temp-path injection) |
| `tests/catalog.spec.ts` | Catalog merge, unknown-id passthrough, capacity metadata (mock gateway; the real gateway is never touched) |

## 5. Acceptance protocol (external adjudication)

Automated parts pass; the following run by hand on the stable node per AGENTS:

1. **Gates**: root `pnpm check:plugins`, `pnpm check:entries` (CI).
2. **Install**: add `@veren/opencode-go` to the stable node's web profile (`dsh plugin --profile web add plugins/opencode-go`, or fold into a bundle) with `DSH_HOME` at `deepseek\.dsh`.
3. **Sign-in funnel**: start the OpenCode Go sign-in from the Models page / authorization surface, method one (create at /auth, paste) — pass: the notice names the exact /auth entry; online validation runs; the credential store gains `opencode-go/account`.
4. **Real conversation**: pick `opencode-go/deepseek-v4.1-flash` in a session and ask a question with a verifiable answer — pass: correct answer, a reasoning block in the session log, `usage.opencode.billing_source == "go"`, real plan quota consumed.
5. **Same-key comparison**: the same question answered via the opencode CLI (Go model) and via this route both succeed.
6. **Error states**: signed out → empty Models page + `SIGN_IN_REQUIRED`; hand-broken key → `KEY_INVALID` with the login record intact.

## 6. Limits and follow-ups

- v1 is a text surface: images/files project to placeholder text (the gateway supports images natively; attachment resolution lands in v2).
- `reasoning_effort` is not sent yet (gateway default); `replayState` is unfilled.
- Bundle/market placement (fold into app-host-bundle or standalone listing) is a release-pipeline decision.
