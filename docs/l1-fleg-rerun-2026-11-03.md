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

(pending; filled line by line from the raw corpus and watcher output under
`docs/evidence/l1-rerun-20261103/`.)
