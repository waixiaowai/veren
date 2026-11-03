# F-leg rerun pre-registration (2026-11-03)

> **Status: pre-registered, before the rerun.** This sheet is written and committed before any
> F-leg task is triggered; the commit id is the "before the rerun" evidence. After the rerun only
> §6 may be appended. **§3 predictions and criteria must not be edited** — editing them voids the
> pre-registration.
>
> Task brief: `docs/superagent-task-router.md` §5 (F leg). Incident: production sendmessage was
> `-14` for every attempt on 2026-11-02.

## 1. The three assumptions to adjudicate

| Id | Assumption | State | Falsified when |
|----|------------|-------|----------------|
| H1 | The missing `notifystart` is the main cause of sendmessage `-14` | patched in 4b3aaf3b, unproven | `notifystart` is present with ret=0 and sendmessage is still `-14` |
| H2 | The version-header slip (`4102`) contributes to `-14` | pinned to 132102 in dae4b926, unproven | sendmessage is still `-14` with the header at 132102 |
| H3 | The TS reference (`@veren/im-wechat`) verifies same-age-token sending in production | **unproven** | see `docs/ilink-send-contract.md` appendix: the searchable estate holds only Go-hub production send history; the TS direct send path has no production success record |

**Falsification escalates**: if P3 is FAIL (notifystart present, header 132102, sendmessage still
`-14`), H1 and H2 are both falsified and the L2 probe matrix becomes the main task. "Try again"
must not replace a bisection.

## 2. Environment snapshot (before the rerun)

| Item | Value | How it is evidenced |
|------|-------|---------------------|
| cms build | `cee7ac12` (release `20261103013738-3716201`) | `readlink /opt/cms/current` + release SHA256SUMS |
| Recording proxy | `http://127.0.0.1:19090` → `https://ilinkai.weixin.qq.com` | live `im.hub.base_url`; records at `/opt/cms/recorder/records.jsonl` |
| Session bot | `959aef235f2b@im.bot` | `im_hub_session.bot_id` |
| Token fingerprint | `sha256:12797c93e7 len=58` (never the plaintext) | recorder Authorization redaction fingerprint |
| Latest inbound | `2026-11-03T01:38:29Z` (seq 9) | `im_hub_messages` + cms log |
| Node image | `dsh-superagent-0.1.0-r9` (boots with `image git_rev=69cd81e1c4d2…`, a descendant of `8873935`) | the container's first `[boot] image git_rev=…` line (02:39:53Z) |

Precondition: the node image is rebuilt and deployed and `taskhub_workers.last_seen_at` is within
120s; otherwise the rerun is not triggered.

## 3. Pre-registered predictions (each machine-judgeable)

| Id | Prediction | Criterion | Verdict |
|----|------------|-----------|---------|
| P1 | `notifystart` precedes `sendmessage` and has `ret=0` | recorder JSONL: a `path=/ilink/bot/msg/notifystart` exchange whose response has no non-zero ret/errcode, with `ts` earlier than the first `sendmessage` of the same process | PASS / FAIL |
| P2 | `sendmessage` carries `iLink-App-ClientVersion=132102` | that request's `headers["Ilink-App-Clientversion"]=="132102"` | PASS / FAIL |
| P3 | `sendmessage` succeeds (HTTP 200, no non-zero ret/errcode, non-empty message_id) | recorder JSONL response body: `ret`/`errcode` absent or zero and `message_id` non-empty | PASS / FAIL (FAIL falsifies H1/H2) |
| P4 | The task visits each of five states exactly once: `received→routed→accepted→reported→replied` | an external watcher samples `taskhub_tasks.status` every 200ms; the deduplicated sequence must equal that 5-tuple; `taskhub_events` holds exactly one `received`, one `matched`, one `task_result`, and exactly one `reply_sent` with ref=`result` | PASS / FAIL / NOT-EXERCISED (a node refusal path is a legal degradation, with refusal evidence) |
| P5 | The negative reply is sent outbound exactly once | exactly one recorded `sendmessage` carrying that task's text; exactly one `reply_sent`, zero `reply_failed` | PASS / FAIL |
| P6 | `dispatch→delivered` latency is within bounds | `matched.created_at` → `reply_sent.created_at`; refusal path ≤180s, accept path ≤900s | PASS / FAIL + measured seconds |
| P7 | No `-14` during the rerun | no `ret=-14` in any sendmessage/notifystart response | PASS / FAIL |

Verdict rules:

- **PASS**: every criterion holds; evidence paths go into §6.
- **FAIL**: any criterion fails; the raw (redacted) frame and failure time must be recorded.
- **NOT-EXERCISED**: only when the prediction's trigger objectively did not happen (e.g. the node
  refusal meant P4's accept path never ran), and direct evidence of the absent trigger must be
  attached. "We did not get there" is not a verdict.

## 4. Rerun scenario (trigger shape)

1. Insert one synthetic inbound message (bypassing the phone; same conversation):
   - `message_id = l1-rerun-20261103-a`
   - `conversation_id = p2p:o9cq80ziUhplM9PWI8mdW_Rfqs6w@im.wechat`
   - `text = 任务：请评估这个请求是否属于你的工作范围` (deliberately outside the copy/visual
     rules so the node refuses)
2. `IntakeTick` (1s) creates the task → `MatchTick` routes to `rehearsal-01` → `DispatchTick`
   dispatches; the node answers `accepted:true` → cms `accepted`.
3. The node's Eval refuses → `task.result(outcome=stopped)` → cms `reported` → `DeliverTick`
   delivers the refusal summary → `replied`.
4. A watcher samples the task row and event table every 200ms starting 10s before insertion and
   writes `docs/evidence/l1-rerun-20261103/`.
5. Only frames after the trigger, from the same process, are judged. Earlier frames are
   environment sanity only.

## 5. Prohibitions

- No "send once more and see" after a P3 FAIL; escalate to L2 per §1.
- No loosening the recorder redaction to keep token plaintext; the credential red line stands.
- No editing §3 after the fact; verdicts are appended to §6 only.

## 6. Verdict table (appended after the rerun)

- Run id: task `01M6FMP8V33AKWED5EBXA782R4`
- Trigger: 2026-11-03T02:44:21Z (`trigger-b.txt` = 1793673861)
- cms rev during the run: `78429e47` (deployed by a concurrent session at 02:40; see §6.3);
  node rev: `69cd81e1c4d2…`
- Judge: `scripts/l1-rerun/verdict.py` (the table is its output; raw output `verdict-b.json`)
- Evidence: `docs/evidence/l1-rerun-20261103/`

| Prediction | Grade | Criterion (verbatim judge output) |
|------------|-------|-----------------------------------|
| P1 | **PASS** | notify_ts=2026-11-03T02:43:45.042049794Z ret=0 send_ts=2026-11-03T02:44:26.041486044Z same_token=True |
| P2 | **PASS** | header=132102 |
| P3 | **PASS** | ret=0 message_id=7523213472945919000 |
| P4 | **PASS** | sequence=received->routed->accepted->reported->replied; events received:1 matched:1 accepted:1 result:1 reply_sent(result):1 |
| P5 | **PASS** | result_sendmessage_frames=1; reply_sent(result)=1; reply_sent(all)=2; reply_failed=0 |
| P6 | **PASS** | latency_s=2.0 (bound=180, refusal path) |
| P7 | **PASS** | frames_with_ret_-14=0 |

### 6.1 Evidence index

| File | Content |
|------|---------|
| `records-slice-b.jsonl` | recording-proxy slice (02:43:40–02:44:35: notifystart, getupdates, two sendmessage frames with ret/errcode and all headers) |
| `watch-b.jsonl` | external watcher's per-change samples (task row + event table) |
| `transitions-b.jsonl` | DB-trigger state transitions (one each: received→routed→accepted→reported→replied) |
| `verdict-b.json` / `verdict-b.md` | judge output (machine criteria) |
| `trigger-b.txt` | trigger epoch |

### 6.2 P5 wording note (no criterion change, only the counted object)

The node first sent a **process reply** (`task_reply`, "这条消息仍只有范围询问…") and then the
**result reply** (`task_result`, "该节点评估后未接下此任务。"). They are distinct events, each
delivered exactly once; P5's "negative reply" is counted as the **result** reply (`reply_sent`
with `ref=result`), hence PASS. Total outbound is 2 with `reply_failed=0` — no duplicate delivery.

### 6.3 Deviations (recorded as they happened)

1. **Instrument upgrade**: the pre-registration named a 200ms row sampler; `received→routed→accepted`
   happen within one second, so the sampler only saw `accepted` onward. To get exact transitions an
   append-only DB trigger (`taskhub_status_probe`, AFTER UPDATE OF status) was added; its stream is
   `transitions-b.jsonl`. This strengthens observation; it does not relax criteria.
2. **First trial void**: task `01M6FMGSR21SCYFXGH3WEQ4GSH` (02:41) was triggered after a concurrent
   session had restored `im.hub.base_url` to the official host at 02:20 and stopped the recorder, so
   its sends never entered the corpus. It is not judged; only task B (the table above) is the rerun.
3. **Build-point drift**: §2 recorded `cee7ac12`; a concurrent session deployed `78429e47` at 02:40
   (`accepted` events, delivery dedupe). The rerun actually ran on `78429e47`. Both builds contain
   the four incident fixes and `/versionz` verifies the revision; P1–P7 criteria read only wire
   bodies and the ledger, so the drift does not change them.
4. **PASS is not causation**: P1–P3 passing proves the send face is alive and the request shape is
   accepted. The 11-02 `-14` was a dead session (`errcode:-14, errmsg:"session timeout"`); request
   shape does not clear it. H1 (notifystart necessity) remains neither cleanly falsified nor proven;
   see `docs/ilink-send-contract.md` §4 F1.
