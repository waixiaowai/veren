# F 腿重跑预注册单（2026-11-03）

> **状态：预注册，先于重跑。** 本单在触发任何 F 腿任务之前写入并提交；提交号即"先于重跑"的
> 时间证据。重跑结束后只允许在 §6 追加判级表，**不得回改 §3 的预测与判据**——否则预注册失效。
>
> 任务书：`docs/superagent-task-router.cn.md` §5 F 腿；事故：2026-11-02 生产 sendmessage 恒 `-14`。

## 1. 要裁决的三个假设

| 编号 | 假设 | 当前状态 | 证伪条件 |
|------|------|----------|----------|
| H1 | 缺失 `notifystart` 是 sendmessage `-14` 的主因 | 4b3aaf3b 已补，未证 | notifystart 出现且 ret=0 后，sendmessage 仍 `-14` |
| H2 | 版本头错位（`4102` 抄写错误）参与 `-14` | dae4b926 已钉 132102，未证 | 版本头=132102 时 sendmessage 仍 `-14` |
| H3 | TS 参照（`@veren/im-wechat`）在生产验证过同龄 token 的发送 | **未经证实** | 见 `docs/ilink-send-contract.cn.md` §附：可检索范围内只有 Go hub 的生产发送史，TS 直连发送无生产成功记录 |

**证伪即升级**：若 P3 判 FAIL（notifystart 在位、版本头 132102，sendmessage 仍 `-14`），H1/H2
同时被证伪，L2 探针矩阵升格为主任务；禁止以"再试一次"代替二分。

## 2. 环境快照（重跑前）

| 项 | 值 | 取证方式 |
|----|----|----------|
| cms 版本 | `cee7ac12`（release `20261103013738-3716201`） | `readlink /opt/cms/current` + 发布包 SHA256SUMS |
| 录制反代 | `http://127.0.0.1:19090` → `https://ilinkai.weixin.qq.com` | `im.hub.base_url` 现读值；记录文件 `/opt/cms/recorder/records.jsonl` |
| 会话 bot | `959aef235f2b@im.bot` | `im_hub_session.bot_id` |
| token 指纹 | `sha256:12797c93e7 len=58`（不落明文） | 录制器 Authorization 脱敏指纹 |
| 最近入站 | `2026-11-03T01:38:29Z`（seq 9） | `im_hub_messages` + cms 日志 |
| 节点镜像 | `dsh-superagent-0.1.0-r9`（启动打印 `image git_rev=69cd81e1c4d2…`，为 `8873935` 的后代） | 容器首行 `[boot] image git_rev=…`（02:39:53Z） |

前置：节点重建镜像并部署完成、`taskhub_workers.last_seen_at` 在 120s 内；否则不触发重跑。

## 3. 预注册预测（逐条可判级）

| 编号 | 预测 | 判据（机器可判） | 判级 |
|------|------|------------------|------|
| P1 | `notifystart` 在 `sendmessage` 之前出现且 `ret=0` | 录制 JSONL：存在 `path=/ilink/bot/msg/notifystart` 且响应体无"非零 ret/errcode"，其 `ts` 早于同一进程内第一条 `sendmessage` 的 `ts` | PASS / FAIL |
| P2 | `sendmessage` 请求头 `iLink-App-ClientVersion=132102` | 录制 JSONL 该请求 `headers["Ilink-App-Clientversion"]=="132102"` | PASS / FAIL |
| P3 | `sendmessage` 成功（HTTP 200、无非零 ret/errcode、有 message_id） | 录制 JSONL 响应体：无 `ret`/`errcode` 或均为 0，且 `message_id` 非空 | PASS / FAIL（FAIL 即 H1/H2 证伪） |
| P4 | 任务状态五态各恰好一次：`received→routed→accepted→reported→replied` | 外部观察器 200ms 采样 `taskhub_tasks.status`，去重后序列必须**逐项等于**该五元组；`taskhub_events` 中 `received`/`matched`/`task_result` 各恰 1 条，`reply_sent` 中 ref=`result` 恰 1 条 | PASS / FAIL / NOT-EXERCISED（节点拒绝路径为合法降级，须附拒绝证据） |
| P5 | 负回复恰一次外打 | 录制 JSONL 中该任务文本的 `sendmessage` 恰 1 帧；`taskhub_events` 中 `reply_sent` 恰 1 条、`reply_failed` 0 条 | PASS / FAIL |
| P6 | `dispatch→delivered` 时延落界内 | `matched` 事件 `created_at` → `reply_sent` 事件 `created_at`；拒绝路径界 ≤180s，接受路径界 ≤900s | PASS / FAIL + 实测秒数 |
| P7 | 重跑期间无 `-14` | 录制 JSONL 中 sendmessage/notifystart 响应无 `ret=-14` | PASS / FAIL |

判级规则：

- **PASS**：判据全部成立，证据文件路径入 §6。
- **FAIL**：判据任一不成立；必须记录原始帧（脱敏）与失败时刻。
- **NOT-EXERCISED**：仅当该预测的触发条件客观上未发生（如节点拒绝使 P4 的 accepted 路径未走），
  且必须附"触发条件未发生"的直接证据；不得用"没跑到"代替判级。

## 4. 重跑剧本（触发形态）

1. 插入一条合成入站消息（绕过手机，来源与会话不变）：
   - `message_id = l1-rerun-20261103-a`
   - `conversation_id = p2p:o9cq80ziUhplM9PWI8mdW_Rfqs6w@im.wechat`
   - `text = 任务：请评估这个请求是否属于你的工作范围`（故意不匹配 copy/visual 规则，节点应拒绝）
2. 等待 `IntakeTick`（每秒）建单 → `MatchTick` 路由到 `rehearsal-01` → `DispatchTick` 下发；
   节点 `accepted:true` 回执 → cms `accepted`。
3. 节点 Eval 拒绝 → `task.result(outcome=stopped)` → cms `reported` → `DeliverTick` 投递
   拒绝摘要 → `replied`。
4. 观察器从插入前 10s 起每 200ms 采样一次任务行与事件表，落 `docs/evidence/l1-rerun-20261103/`。
5. 只取触发时刻之后、同一进程内的录制帧作判据；插入前的帧仅作环境 sanity，不进判级。

## 5. 明令禁止

- 禁止在 P3 FAIL 后重复"再发一次看看"；按 §1 升级 L2。
- 禁止修改录制器脱敏策略来"保留 token 原文"；凭据红线不变。
- 禁止事后修改本单 §3；判级表只能追加在 §6。

## 6. 判级表（重跑后追加）

（待重跑；由 `docs/evidence/l1-rerun-20261103/` 下的原始语料与观察器输出逐条填写。）
