# taskhub 线协议契约 v1

> 状态：**已钉（外部形态）**。本文件是 cms `internal/taskhub` 与 dsh-superagent 节点侧桥接的**唯一线契约**；
> 两侧实现均以本文档的 JSON 字面示例为钉（契约测试逐字比对）。变更须先改本文档再改两侧代码。
> 依据：`docs/superagent-task-router.cn.md`（任务书，裁决 D1-D7）。
> 先例：`D:\cms\internal\wsgw\command.go` 首注钉 `plugins/cms-bridge/src/protocol.ts` 的同形纪律。

## 1. 传输与鉴权（既有面，零新增）

- 端点：`GET /v1/ws`（wsgw 既有升级面，gorilla）。
- 鉴权：握手带 `Authorization: Bearer <cms 用户 API Key>`（wsgw 三态链；凭证被拒=HTTP 401 或 close 4401 → 客户端停泊等待重配置，不做无谓重连）。
- 帧形态：全部为 JSON 文本帧，四型：
  - 下行 `{type:'command', id, action, payload}`
  - 上行 `{type:'result', id, ok, result?}` / `{type:'result', id, ok:false, code, message}`
  - 上行 `{type:'event', id, name, payload, ts}`；下行可选 `{type:'event_ack', id}`
  - 上行事件 id 由客户端生成（`evt_` + 随机），服务端收到即落 `ws_messages` 审计（原文留痕，既有行为）。

## 2. 工作节点注册与心跳（taskhub 语义，节点 → cms）

节点连入后（或自身配置变化时）上报**两段**注册事件；运行期每 60s 上报一次心跳。

**第一段 `node.identity`**（wsgw 连接注册表面，既有契约不动——`ws_nodes` UPSERT 是派发寻址的前提，缺它节点永不可派发）：

```json
{ "type": "event", "id": "evt_00", "name": "node.identity", "ts": 1762000000000,
  "payload": { "nodeId": "3f2a…uuid", "nodeName": "Gitea 代码节点", "nodeDescription": "会写 Go/TS，能推 Gitea 仓库", "nodeIcon": "🛰️" } }
```

**第二段 `taskhub.worker.hello`**（taskhub 语义面，路由自述）：

```json
{ "type": "event", "id": "evt_01", "name": "taskhub.worker.hello", "ts": 1762000000000,
  "payload": { "nodeId": "3f2a…uuid", "title": "Gitea 代码节点", "description": "会写 Go/TS，能推 Gitea 仓库",
               "tags": ["gitea", "code", "go"], "maxConcurrent": 2 } }
```

```json
{ "type": "event", "id": "evt_02", "name": "taskhub.worker.heartbeat", "ts": 1762000060000,
  "payload": { "nodeId": "3f2a…uuid", "running": 1 } }
```

- `nodeId`：节点稳定 uuid（与 `node.identity` 的 `nodeId` 同值，wsgw `ws_nodes` UPSERT 既有契约不动）。
- `title/description/tags/maxConcurrent`：taskhub `worker_meta` 表（迁移 0210）按 `(user_id, node_id)` UPSERT；`user_id` 取连接归属，不在载荷里。
- 心跳缺失不判死（wsgw 断连即失联）；`running` = 该节点当前在跑的任务数（背压观测面）。

## 3. 任务派发（cms → 节点，wsgw 指令面既有形态）

cms 以下行指令帧派发，action 固定 `task.dispatch`：

```json
{ "type": "command", "id": "wcmd_01J...", "action": "task.dispatch",
  "payload": { "taskId": "01JBYQ8...", "intent": "帮我看看仓库里 CI 为什么红了",
               "origin": { "source": "wechat", "conversation": "p2p:wxid_abc", "requester": "wxid_abc" },
               "createdAt": 1762000000 } }
```

**节点回执（result 帧，同步，≤10s——wsgw `DefaultCommandTimeout`）只承载接/拒：**

```json
{ "type": "result", "id": "wcmd_01J...", "ok": true, "result": { "accepted": true } }
```

```json
{ "type": "result", "id": "wcmd_01J...", "ok": true, "result": { "accepted": false, "reason": "超出本节点策略范围" } }
```

- `accepted:true` = 节点已受理（进 superagent 流水线；Eval/Policy 保留最终否决权，拒绝走 `accepted:false`）。
- `accepted:false` = 节点显式拒绝：cms 记 `refused` 事件并试下家候选或停放。
- `ok:false`（如 `HANDLER_ERROR`）= 处理器异常，同拒绝路径但 reason 取 message。
- 回执超时（`DISPATCH` 无 result 帧）= 视同离线，等租约过期重排。
- **幂等**：重排后重发的 `task.dispatch` 携带**同一 taskId**；节点必须按 taskId 去重（在途/已受理的 taskId 再收到 → 直接回 `accepted:true`，不重复建工单）。

## 4. 过程回复与完成回报（节点 → cms，事件面）

**硬约束**：任务耗时分钟~小时级，而 result 帧同步等待上限 10s ⇒ **完成不走 result 帧**。过程回复与完成都以事件上行，cms 按 `taskId` 关联。

过程回复（每条 Outbox 消息一条；cms 逐条投递来源渠道，按 `messageId` 幂等去重）：

```json
{ "type": "event", "id": "evt_03", "name": "taskhub.task.reply", "ts": 1762000300000,
  "payload": { "taskId": "01JBYQ8...", "messageId": "msg_9f2…", "text": "看了下，是测试环境的依赖挂了，正在修。" } }
```

完成回报（工单终态一次；cms 收到即 `reported`，投递完成即 `replied`）：

```json
{ "type": "event", "id": "evt_04", "name": "taskhub.task.result", "ts": 1762003600000,
  "payload": { "taskId": "01JBYQ8...", "outcome": "completed", "summary": "CI 已修复，原因并合入了回归测试。" } }
```

- `outcome`：`completed` | `stopped` | `failed`（对齐 superagent TicketOutcome 闭集的投影；`merged/closed` 归入 `completed`，`dropped` 归入 `stopped`）。
- 客户端离线期间的事件经本地队列补报（FIFO，保序；cms 侧按 UNIQUE 去重，重复投递无副作用）。

## 5. 来源投递（cms → 渠道，v1 仅微信）

- 微信：`imhub.Service.Reply(conversation, text)`（生产在位）；`conversation` = origin.conversation 原样。
- 投递幂等：`task_events` 表 `UNIQUE(task_id, type, ref)`，`ref` = 上行的 messageId（reply）/ 常量 `result`（task.result）。重放/重启不产生重复微信消息。
- 负回复文案（cms 生成，同走投递）：无匹配=「暂无可用的工作节点，任务已挂起」；拒绝耗尽=「所有候选节点都拒绝了该任务：{原因}」；投递失败重试耗尽=「任务结果投递失败」。

## 6. 任务状态机与租约

```
received ──match──▶ routed(lease) ──accepted──▶ accepted ──task.result──▶ reported ──投递成功──▶ replied
   ▲                  │超时/拒接/回执异常                     │投递失败(重试耗尽)
   └──── requeue ◀────┘   全候选耗尽/无匹配 ──▶ parked      └──────────▶ failed
```

- 租约：`task.hub.lease_seconds`（默认 900s）；到期未 accepted → 重排（attempts+1，回 received）；`task.hub.max_attempts`（默认 3）次后 parked + 负回复。
- 终态：`replied`（好）/ `parked`、`failed`（坏，均带负回复）。

## 7. 错误码段 7700-7799（cms，taskhub 域）

| 码 | 常量 | 语义 |
|----|------|------|
| 7700 | TaskNotFound | 任务 id 不存在 |
| 7701 | TaskStateConflict | 状态机不允许该操作 |
| 7702 | NoWorkerMatched | 无匹配工作节点（任务停放） |
| 7703 | WorkerOffline | 目标节点连接不在线（等租约重排） |
| 7704 | DispatchTimeout | 派发回执等待超时 |
| 7705 | WorkerRefused | 节点拒绝（accepted:false） |
| 7706 | OriginDeliveryFailed | 来源投递失败（重试中/耗尽） |
| 7707 | InvalidEnvelope | task.dispatch 信封非法 |
| 7799 | Internal | 段尾保留内部错误（先例同 market 7399） |

## 8. cms 配置键（热读，seed 登记）

| 键 | 缺省 | 语义 |
|----|------|------|
| `task.hub.owner_user_id` | 空 | 任务归属的 cms 用户（工作节点池锚点）；空=intake 整体关闭 |
| `task.hub.intake_mode` | `off` | `off` \| `all` \| `prefix`：哪些微信消息建任务 |
| `task.hub.intake_prefix` | `任务` | prefix 模式的前缀（命中即建单，前缀本身剥除） |
| `task.hub.intake_device` | 空 | 空=沿用 `im.hub.default_device` |
| `task.hub.lease_seconds` | `900` | 派发租约秒数 |
| `task.hub.max_attempts` | `3` | 重排上限，超过停放 |

## 9. 权限码

`taskhub:read`（管理面只读：任务清单/详情/工作节点）/ `taskhub:manage`（重排/重投等管理动作）。登记 `internal/rbac/permissions.go`，append-only。

## 10. 契约测试义务（两侧）

- cms：Go 侧对 §2/§3/§4 的 JSON 字面示例做序列化/反序列化逐字比对（`taskhub_contract_test.go`）。
- fork：TS 侧对同三节做同字面比对（`taskhub-protocol.spec.ts`），并对 §3 幂等规则、§4 离线补报做行为测试。
- 第二客户端盲写验证：仅凭本文档应能实现任一侧客户端——文档即裁决者。
