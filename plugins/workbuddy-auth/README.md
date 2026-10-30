# @veren/workbuddy-auth

Bridges WorkBuddy (CN, copilot.tencent.com) and WorkBuddy AI (international,
workbuddy.ai) into DSH through the **plugin-owned OAuth device-code flow**: one
`workbuddy` model route, both regions as first-class concepts, a multi-account
pool, and rotation-safe token refresh.

- **One route, two regions**: the region rides with the credential; the model
  picker shows a single group (display names carry a `CN`/`Intl` tag and the
  billing rate; model ids carry `cn:`/`global:` prefixes — upstream ids collide
  across regions).
- **Multi-account**: several accounts per region; selection rotates and skips
  cooled accounts automatically. Credit exhaustion parks one account (1h), rate
  limits cool 1min, server errors cool 10s.
- **Sticky but never stuck on a bad account**: a conversation keeps its account;
  once that account cools, the next message lands on a healthy one (messages
  live in DSH, not on the account).
- **In-process translation**: no loopback port, no shared secret, no gateway
  process; the harness message vocabulary translates onto WorkBuddy's
  OpenAI-compatible wire inside the adapter (protocol facts in
  [docs/workbuddy-protocol.md](../../docs/workbuddy-protocol.md)).
- **Zero-fingerprint sign-in**: device fingerprints appear only on chat/billing
  endpoints and derive deterministically from the uid; the OAuth trio carries no
  device identity at all.

## Usage

The WorkBuddy card in Settings → Models: pick "Sign in · CN / International" →
finish the authorization in the browser → the card waits and lands the
credential (saved only after the online catalog check). Signed in, the card
shows the account table: credits, disable/enable, sign out, and the
reasoning-effort probe (**consumes real credits; double-confirm before it
fires**).

Depends on the protocol library
[`@veren/workbuddy-protocol`](../../packages/workbuddy-protocol) (zero DSH
dependencies, fully tested offline); this package only wires host seams.

## Tests

```bash
pnpm --dir plugins/workbuddy-auth test    # vitest, never touches the network (upstreams mocked)
```

Every risk-control invariant is an executable test: refresh single flight
(N callers → one request), the lock spanning the network call, zero-fingerprint
login, the poll-cadence floor, region-locked states, stickiness that never
sticks to a bad account, the cooldown taxonomy, logout's four-class purge
(credential/cooldowns/disabled/probes erased per uid atomically), display-layer
redaction.

## When the upstream drifts

Re-run the Phase 0 probes and diff `tests/fixtures/` first (procedure and
caveats in the protocol document §9); probes consume real credits — **every
capture round needs explicit user confirmation**.
