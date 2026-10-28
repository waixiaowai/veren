# @veren/opencode-go

English | [中文](README.cn.md)

## Summary

Serve the OpenCode Go subscription plan as a first-class dsh model route. The plugin registers a dedicated `opencode-go` provider adapter (OpenAI-compatible wire against `https://opencode.ai/inference/go`) plus a guided sign-in flow that provisions the plan API key through the harness authorization and credential seams. Use it when this deployment holds an OpenCode Go subscription; skip it when it does not.

## Use this package

1. **Mount** the plugin on the profile (see `cordis.patch.yml` for the overlay example, or add it to your bundle).
2. **Sign in** from the dsh authorization surface (Models page / settings). Two methods:
   - **opencode.ai/auth** — the flow opens `https://opencode.ai/auth` (the v2 console no longer displays keys; this page is where a Go key is created), you paste the key, the plugin validates it online against `GET /models` and only then stores it.
   - **Local CLI import** — if the machine's opencode CLI is signed in with a Go key, the plugin imports it read-only from `~/.local/share/opencode/auth.json`.
3. **Pick a model** — after sign-in the `opencode-go` route advertises the Go catalog (`deepseek-v4.1-flash`, `glm-5.3-flash`, `kimi-k3`, …). No restart is needed; the stored key applies to the next request.

The key is stored only in the harness credential store as the `opencode-go/account` record. It never enters configuration files or logs. HTTP 401 from the gateway surfaces as `KEY_INVALID` and never deletes the stored sign-in; removal is an explicit user action.

## Configuration

All fields optional; defaults match the official gateway.

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://opencode.ai/inference/go/openai/v1` | OpenAI-compatible root; chat completions land at `{baseURL}/chat/completions` |
| `listingBaseURL` | `https://opencode.ai/inference/go/v1` | Protocol-neutral catalog root; the listing lands at `{listingBaseURL}/models` |
| `modelsTimeoutMs` | `5000` | Deadline of one listing request |
| `modelsMaxAgeMs` | `600000` | Listing age after which the next access refreshes it in the background |
| `requestTimeoutMs` | `600000` | Wall clock guard for one model request |

## Error codes

| Code | Meaning |
|---|---|
| `SIGN_IN_REQUIRED` | No key stored; run the sign-in flow |
| `KEY_INVALID` | Gateway answered 401; the stored sign-in is kept |
| `QUOTA_EXCEEDED` | Gateway answered 402 |
| `ROUTE_FORBIDDEN` | Gateway answered 403 |
| `UPSTREAM_ERROR` | Any other gateway failure (status preserved) |
| `LOCAL_IMPORT_UNAVAILABLE` | The local CLI import found no usable `opencode-go` entry |
| `SIGN_IN_CANCELLED` | The sign-in attempt ended with an empty key |

## Gateway contract notes (verified live 2026-10)

- Chat requests carry `Authorization: Bearer <key>`, `x-opencode-session` (the harness session id, so the gateway can route and cache), and the harness attribution headers with an honest user agent.
- The listing is the standard OpenAI `{"object":"list","data":[{"id":…}]}` shape.
- Every response's `usage` carries `usage.opencode = { billing_source, list_cost, allowance, tokens }` — the plan quota surface. The harness `TokenUsage` conversion subtracts cached input from `prompt_tokens` (counts are disjoint).
- Reasoning models return `reasoning_content`; the adapter emits it as the harness `reasoning` block ahead of prose.

## Catalog data

`src/catalog-data.ts` is a generated snapshot of the Go model catalog (source: `@earendil-works/pi-ai@1.1.0 providers/data/opencode-go.json`, upstream models.dev). The online listing keeps availability fresh; regenerate the snapshot when the plan's lineup changes.

## Dev

```bash
pnpm --dir plugins/opencode-go install
pnpm --dir plugins/opencode-go run typecheck
pnpm --dir plugins/opencode-go test
```

Design and forensics record: [docs/opencode-go-plugin.md](../../docs/opencode-go-plugin.md) (English) / [docs/opencode-go-plugin.cn.md](../../docs/opencode-go-plugin.cn.md) (中文).
