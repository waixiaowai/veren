# iLink 发送面契约（v1）

> **状态：已由外部证据裁决。** 本文件把 2026-11-02「生产 sendmessage 恒 `-14`」事故中
> 三个未裁决假设（notifystart 缺失、版本头错位、TS 参照可证）交给线上原文判决。
> 裁决语料：录制反代（`D:\cms\scripts\ilink-recorder`）在 `im.hub.base_url` 上逐请求
> 落盘的 JSONL；语料副本与 SHA256 见 §5。
>
> 边界：本文只描述 iLink **发送面**（`notifystart` / `sendmessage`）的线上事实与两个
> 客户端的分类义务；不改 `docs/taskhub-protocol.cn.md` 的帧形状，只在附录 A 增补
> 「发送面事实」。

## 1. 端点与线上形状

### 1.1 端点

| 端点 | 方法 | 作用 | 鉴权 |
|------|------|------|------|
| `/ilink/bot/msg/notifystart` | POST | 开启 bot 的消息会话 | Bearer bot token |
| `/ilink/bot/sendmessage` | POST | 向一个用户投递一条消息 | Bearer bot token |
| `/ilink/bot/getupdates` | POST | 长轮询入站消息（仅作发送面判据的对照） | Bearer bot token |

### 1.2 请求头（两个发送端点共用）

| 头 | 值 | 必要性 | 证据 |
|----|----|--------|------|
| `iLink-App-Id` | `bot` | 必带 | 全部录制帧一致 |
| `iLink-App-ClientVersion` | 十进制版本号 | 必带；**值不是门槛** | 132102 与 4102 均成功（§4 F2） |
| `content-type` | `application/json` | 有 body 时必带 | 全部录制帧一致 |
| `AuthorizationType` | `ilink_bot_token` | 鉴权请求必带 | 全部录制帧一致 |
| `X-WECHAT-UIN` | 4 字节随机数 base64 | 必带（无身份语义） | 每次请求不同，服务端接受 |
| `Authorization` | `Bearer <bot token>` | 必带 | 缺失/篡改 → `-14` |

### 1.3 body 形状

`notifystart`：

```json
{"base_info":{"channel_version":"2.4.6","bot_agent":"cms-imhub/0.1.0"}}
```

`sendmessage`：

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<wxid>@im.wechat",
    "client_id": "cms-imhub-<unixnano>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [{"type": 1, "text_item": {"text": "<正文>"}}],
    "context_token": "<可选；入站消息带来的会话令牌>"
  },
  "base_info": {"channel_version": "2.4.6", "bot_agent": "cms-imhub/0.1.0"}
}
```

- `context_token` **可省略**：录制格 `no-context` 返回 200 + `message_id`（§4 F3）。
  省略时上游仍按 `to_user_id` 投递；带上是更稳的路径（TS 参照总是带）。
- `item_list` 只支持文本（type=1）；图片/文件不在本契约内。

### 1.4 响应形状

成功：HTTP 200，body 至少含 `message_id`（大整数，客户端须按原文/字符串处理）：

```json
{"message_id":7523196763132315000}
```

失败：HTTP 200 + 错误码字段（`ret` 或 `errcode`），常见原文：

```json
{"ret":-3}
{"errcode":-14,"errmsg":"session timeout"}
```

## 2. 错误码语义与客户端分类

| 上游原文 | 语义 | Go（`internal/imhub`） | TS（`@veren/im-wechat`） |
|----------|------|------------------------|--------------------------|
| 无 `ret`/`errcode` 或 0，有 `message_id` | 已投递 | 成功 | 成功 |
| `errcode:-14` / `ret:-14`（`session timeout`） | 会话失效 | `ErrAuthRequired`（dae4b926 起） | `IM_SEND_REJECTED`（**分歧，见 §4 F5**） |
| `ret:-3` | 收件人不可解析 | `ErrSendRejected` | `IM_SEND_REJECTED` |
| 其他非零 | 业务拒绝 | `ErrSendRejected` | `IM_SEND_REJECTED` |

`-14` 是**会话级**的：同一个 token 在 `getupdates` 与 `sendmessage` 上同时失效
（2026-11-02 11:15 起 getupdates 报 -14；13:49 起 sendmessage 也报 -14）。
不存在「轮询死而发送活」的已录证据，客户端不得据此分流。

## 3. 会话生命周期（观测）

```text
扫码授权 ──▶ bot token（新会话）
                │
                ├─ notifystart（开消息会话；TS 参照每次长轮询前调用）
                ├─ sendmessage（发送面）
                └─ getupdates（入站面）
                │
        上游判死（errcode:-14, "session timeout"）
                │
                ▼
        重新扫码授权（唯一恢复路径；客户端无续期接口）
```

已观测的 token 年龄：

| bot | 授权时间（UTC） | 最后一次成功发送（UTC） | 年龄 | 备注 |
|-----|------------------|--------------------------|------|------|
| `37a660d79cde@im.bot` | 2026-10-27T17:50:53Z | 无（13:49 起全部 -14） | 5.8 天时失效 | 失效后重授权 |
| `959aef235f2b@im.bot` | 2026-11-02T14:57:50Z | 2026-11-03T01:38:32Z | 10 小时 40 分（观测时） | 仍活 |

结论（观测级，不宣称 TTL）：token 可以在一周内被上游判死；`-14` 的唯一已证恢复
路径是重新扫码。请求形状（版本头、context_token、notifystart）**不改变**一个已死
会话的 `-14`。

## 4. 裁决（预注册假设 → 线上证据）

| 编号 | 假设 | 证据 | 裁决 |
|------|------|------|------|
| F1 | 缺失 notifystart 是 `-14` 主因 | 当前 token 在服务启动时已调用 notifystart（01:37:57，ret=0），随后发送成功；但「从未调用 notifystart 的同 token」不可构造（旧 token 已死、新 token 需用户扫码），故无法给出干净反事实 | **未证伪、未证实**：notifystart 保留为客户端义务，不能宣称它是 11-02 事故的根因 |
| F2 | 版本头 `4102` 参与 `-14` | 探针 `version-4102` 格：notifystart ret=0、sendmessage 200 + `message_id`（录制格 `sendmessage-ok-4102`） | **证伪**：版本头值不是门槛；132102 是客户端约定，不是上游硬要求 |
| F3 | `context_token` 是发送必需 | 探针 `no-context` 格：省略后仍 200 + `message_id` | **证伪**：可选；带上更稳，缺失不构成拒绝 |
| F4 | TS 参照在生产验证过同龄 token 的发送 | 可检索范围内，TS 直连账号（`32beb5e8c47d@im.bot`）的持久令牌最后刷新于 2026-10-26；此后该账号的入站/回复全部走 im_hub（provider=hub），TS 直连 `sendmessage` 无生产成功记录 | **证伪**：TS 发送路径只有单测，没有生产实证；不能拿它当「已修好」的参照 |
| F5 | 两侧对 `-14` 的分类一致 | 录制格 `sendmessage-ret-14`：Go 归 `ErrAuthRequired`，TS 归 `IM_SEND_REJECTED`（TS 是刻意保留的对照组，本波不改行为） | **分歧已钉**：契约要求新客户端按「会话失效」分类；TS 的差异是已知欠账，不在本波修复 |

**事故归因（证据级）**：11-02 的 `-14` 与请求形状无关；它是上游对旧会话的判死
（`session timeout`）。当天 14:57 的重新扫码是唯一生效的恢复动作。四笔修复中，
dae4b926（-14 分类）修正了**重试语义**（不再把死会话当业务拒绝无限外打），
4b3aaf3b（notifystart）是**对齐 TS 参照的加固**，f2d7d863（看门狗）与 8873935
（完成/拒绝回报）修的是**投递与收敛**，它们都不是 `-14` 的因。

## 5. 录制语料与双端回放

- 语料：`docs/evidence/ilink-send-20261103/ilink-send-cases.jsonl`（6 例）
- SHA256：`bbeef4cf3706f0066615b0605d117342048465b94a829af132f5ec97b2ea6a41`
- 双侧副本（逐字节相同，CI 校验 SHA256）：
  - Go：`D:\cms\internal\imhub\testdata\ilink-send-cases.jsonl`（`corpus_test.go`）
  - TS：`plugins/im/wechat/tests/fixtures/ilink-send-cases.jsonl`（`tests/ilink-replay.spec.ts`）

用例清单：

| id | 上游原文 | Go 判级 | TS 判级 |
|----|----------|---------|---------|
| `notifystart-ok` | `{"ret":0}` | 成功 | 成功 |
| `notifystart-ret-14` | `{"errcode":-14,"errmsg":"session timeout"}` | 会话失效 | `IM_AUTH_REQUIRED` |
| `sendmessage-ok` | `{"message_id":7523196763132315000}` | 成功 | 成功 |
| `sendmessage-ok-4102` | `{"message_id":7523205129804093000}`（请求头 4102） | 成功 | 成功 |
| `sendmessage-ret-14` | `{"errcode":-14,"errmsg":"session timeout"}` | 会话失效 | `IM_SEND_REJECTED`（已知分歧） |
| `sendmessage-ret-3` | `{"ret":-3}` | 投递拒绝 | `IM_SEND_REJECTED` |

CI 义务：

- Go：`go test ./internal/imhub -run 'Corpus'`——逐例回放响应 + 请求形状钉死。
- TS：`pnpm --dir plugins/im/wechat test`——同一语料的响应回放 + 形状钉死。
- 任一仓库复制语料后 SHA256 漂移即红；改语料必须先改本文档的 SHA 与用例表。

## 6. 未决与后续

1. **notifystart 的必要性**（F1）需要一次「新扫码 token 且从不在其上调用
   notifystart」的实验；只有用户能提供新 token。在此之前，客户端必须调用它。
2. **TS 的 -14 分类**（F5）：TS 是对照组，本波不改；后续若 TS 进入生产发送路径，
   必须按 §2 改成会话失效并停止重试。
3. **token 生命周期**：需要至少一周的被动观测（记录授权时间与首个 `-14` 时间）
   才能给出 TTL 区间；本契约只记录已观测点。

## 附录 A：发送面事实（给 `taskhub-protocol` 的只增附录）

- 来源投递失败分两类：**会话失效（-14）**与**投递拒绝（-2/-3/其他）**。前者不得
  计入「投递失败重试」，应直接落 `failed` 并提示重新授权；后者才进入重试预算。
- 一次 `sendmessage` 的成功判据是 HTTP 200 且响应原文含 `message_id`；`ret=0` 也
  可接受，但 `message_id` 是唯一可核对的投递标识。
- `context_token` 是会话级提示，不是消息级必需；缺它仍可能投递成功，客户端不得
  因缺 token 拒绝发送。
- 负回复与结果回复共用同一投递面：每条任务最多一条成功外打（账本 UNIQUE + 进程内
  串行化），`-14` 时按会话失效处理。

## 附录 B：证据索引

| 文件 | 内容 |
|------|------|
| `docs/evidence/ilink-send-20261103/probe-matrix.jsonl` | 探针矩阵逐格结果（baseline / 4102 / no-context / no-notifystart / dead-token / bad-target） |
| `docs/evidence/ilink-send-20261103/history.json` | 生产授权/失效/投递事件时间线（无凭据） |
| `docs/evidence/ilink-send-20261103/ilink-send-cases.jsonl` | 录制语料（脱敏） |
| `docs/l1-fleg-rerun-2026-11-03.cn.md` | L1 预注册单与判级表 |
