# L3 class killers: evidence and ledger (2026-11-03)

> External evidence index for the three L3 deliverables: the gate's red/green
> transcripts, the outbound-liveness code/test surface, and the watchdog chaos
> ledger with latency quantiles. Every number comes from a script or test
> output, never from prose.
>
> Repos: cms (`D:\cms`) and cursour; evidence under `docs/evidence/l3-20261103/`.

## 1. Deployment-integrity gate (L3①)

### 1.1 Tracked-import assertion (CI)

- Implementation: `D:\cms\cmd\server\imports_tracked_test.go`
  (`TestLocalImportsPointAtTrackedFiles`). It parses every `.go` file, and for each
  `cms/...` import asserts the target is covered by `git ls-files`; a directory
  import needs at least one tracked file.
- Red direction (real interception): an untracked package
  `internal/untrackedprobe` plus a test importing it produced:

  ```
  --- FAIL: TestLocalImportsPointAtTrackedFiles
      部署完整性门禁：1 个 import 指向未入库路径
          D:/cms/internal/imhub/zz_gate_red_test.go imports untracked cms/internal/untrackedprobe
  ```

  Transcript: `docs/evidence/l3-20261103/gate-red.log`.
- Green direction (after removing the probe): `ok cms/cmd/server` in
  `gate-green.log`.

### 1.2 Runtime rev vs deploy script

- Startup line: `[build] runtime version=… git_sha=… built_at=…`
  (`cmd/server/main.go`).
- Public identity face: `GET /versionz` → `{"version","git_sha","built_at"}`
  (`cmd/server/build_info.go`).
- Deploy gate: `deploy/lib.sh::verify_build_rev` compares the runtime `git_sha`
  with `CMS_EXPECT_GIT_SHA`; a mismatch takes the rollback path
  (`deploy/deploy.sh`); `scripts/deploy-local-pkg.sh` passes the release's build
  point.
- Live red/green (2026-11-03, production box):

  ```
  runtime rev: {"git_sha":"79e89191", ...}
  [gate-check] build rev OK: 79e89191            → GREEN_OK
  [gate-check] build rev MISMATCH: runtime=79e89191 expected=deadbeef → EXPECTED_FAIL
  ```

  Transcript: `docs/evidence/l3-20261103/deploy-rev-gate.log`. A concurrent
  session then deployed `2ccf9571` (02:49Z) and `/versionz` kept naming the new
  rev — the gate demands agreement per build point, which is its job.
- The node follows the same rule: image `LABEL org.opencontainers.image.revision`
  plus the entrypoint's first `[boot] image git_rev=…` line; the r9 container
  reported `git_rev=69cd81e1c4d2…` at 02:39:53Z.

## 2. Outbound liveness (L3②)

- Data face: `internal/imhub/service.go` adds `lastSendOK` (last success instant)
  and `lastSendRet` (raw ret: `"0"`/`"-14"`/`"transport"`/`""`); `Reply` records
  it from `SendTextReceipt`.
- API face: `GET /v1/im/hub/session` adds `last_send_ok_at`, `last_send_ret`
  (`routes.go`).
- Console: the WeChat channel page gained "last successful send / last send ret"
  rows and a separate outbound badge (`wechat-outbound-live|idle|dead`) beside
  the poll badge — a live poll does not imply a live send face.
- Tests (red/green on file):
  - Go: `TestReplyRecordsSendLiveness` (success advances lastSendOK; a -14 keeps
    the ret and does not erase the last success) and
    `TestSendReceiptCarriesMessageIDAndRet`.
  - Web: two new cases in `wechat-page.test.tsx` (poll alive + outbound -14 =
    dead; last send success state).
- Effect: a "-14 burst" like 11-02 is visible in the session API instead of
  requiring SQL or log digging.

## 3. Watchdog chaos drill (L3③)

### 3.1 Ledger

| Scenario | Invariant | Red (before fix) | Green (after fix) |
|----------|-----------|------------------|-------------------|
| ① concurrent ticks (8 × 40ms slow send) | one outbound per pending event | **8 sends** (`chaos-red-concurrency.log`) | 1 |
| ② ledger replay (5 ticks after terminal) | zero extra outbound | — | 1 (the first) |
| ③ kill worker (silent accepted + concurrent watchdog/deliver) | park once, negative reply once | — | 1 / 1 |
| ④ kill cms (delivery failure then 4 replays) | exactly one successful outbound, failure recorded | — | reply_failed=1, success=1 |
| ⑤ negative control (dead token, -14 sentinel) | never a false success; failed after 10 and stops | — | success=0, failed then stops |

Transcripts: `chaos-green.log` (per-test PASS). The tests are the judge; no human
reading is involved.

### 3.2 The red→green fix

Duplicate sends under concurrent ticks are a defect the drill **newly found**:
`PendingReplies`' "not yet replied" read and the `reply_sent` write have no
cross-tick exclusion, so a slow send (4.5s on the real wire) overlaps the next
tick and duplicates. The fix serializes the delivery tick with
`Service.deliverMu` (`dispatch.go`); after a process crash the guarantee is
still at-least-once (the provider has no idempotency key, and the contract does
not claim exactly-once across crashes).

### 3.3 Latency quantiles (on file)

Sources: production `taskhub_events` (matched→reply_sent) and recording-proxy
sendmessage durations.

| Metric | n | p50 | p90 | max |
|--------|---|-----|-----|-----|
| Task dispatch→delivered (fresh runs, s) | 3 | 4 | 12 | 12 |
| Task dispatch→delivered (11-02 stale incident, s) | 2 | — | — | 40014 |
| sendmessage round trip (ms) | 12 | 400 | 526 | 4504 |

Raw: `docs/evidence/l3-20261103/latency.json` (per-task detail included).

## 4. Boundaries and open items

- Delivery serialization is **in-process**; multi-instance cms is out of scope
  (single-binary deployment shape).
- Duplicates across a process crash cannot be removed by an iLink idempotency
  key (the send face has none); ledger UNIQUE prevents duplicate records, not
  duplicate wire sends.
- Liveness is in-memory: after a restart `last_send_ok_at=0` and the console
  says "this process has not sent yet" — correct semantics, not a fault.
