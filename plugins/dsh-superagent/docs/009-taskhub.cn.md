# 009 · CMS 任务路由（taskhub）工作节点上线指南

> 本 fork 的 taskhub 来源：把 `dsh --profile superagent` 变成 cms 公共任务路由的一个工作节点。
> cms 侧按「节点自述的 title/description/tags」把外部渠道（v1：微信）的任务派给你，完成后回信沿原路送达下单人。
> 线契约：cursour 仓库 `docs/taskhub-protocol.cn.md` v1（双侧契约测试逐字钉）。
> 双进程演练与混沌剧本：cms 仓库 `scripts/taskhub-rehearsal/README.md`。

## 1. 概念（一分钟版）

- **节点注册（两段，缺一不可）**：连入 cms 的 WS 后先发 `node.identity`（进 wsgw 连接注册表——派发寻址的前提），再发 `taskhub.worker.hello`（title/description/tags 路由自述）；之后每 60s 一次心跳。
- **派发**：cms 下行 `task.dispatch` 信封（taskId/intent/origin）；result 帧只答接/拒（≤10s）。接单后走 superagent 既有流水线：Trigger → Eval/Policy 闸门（**节点保留否决权**）→ Ticket → 执行。
- **回报**：过程回复每条经 `taskhub.task.reply` 上行；工单终态经 `taskhub.task.result` 一次。cms 按信封里 intake 时定格的 `origin`（来源渠道 + 会话 + 下单人）投递回信——**从哪里来的回复哪里，谁下单回复谁**。
- **可靠性**：任务在 cms 落库，租约（默认 900s）到期未接单自动重排，超限停放并给下单人负回复；回复投递 UNIQUE 幂等，重放不重发。

## 2. cms 侧准备（管理员，一次性）

1. **建节点用的 API Key**：管理后台「API Key」页创建（key 能力 = 勾选你给它的权限；仅接入 WS 无需业务权限码）。
2. **开 intake**：「平台参数」页设置（热读，即时生效）：

| 键 | 建议值 | 说明 |
|----|--------|------|
| `task.hub.owner_user_id` | 你的用户 id（如 1） | 任务归属的工作节点池锚点；**空 = intake 整体关闭** |
| `task.hub.intake_mode` | `prefix` | `off`/`all`/`prefix`：哪些微信消息建任务 |
| `task.hub.intake_prefix` | `任务：` | 命中前缀即建单，前缀剥除；`all` 模式忽略本键 |
| `task.hub.intake_device` | 空 | 空 = 沿用 `im.hub.default_device` |
| `task.hub.lease_seconds` | 900 | 派发租约秒数 |
| `task.hub.max_attempts` | 3 | 重排上限，超过停放+负回复 |

3. （验收面）任务清单/时间线：`GET /v1/admin/taskhub/tasks`、`GET /v1/admin/taskhub/tasks/{id}`（taskhub:read；GUI 页候选池）。

## 3. 节点侧上线（本 fork）

1. profile 的 `cordis.patch.yml` 里启用 taskhub 行（去掉 `disabled: true`）：
   `- id: dsh-superagent-taskhub` / `name: dsh-superagent/taskhub-watch`。
2. 面板「来源」页打开 **CMS 任务路由**，填四个路由依据字段：
   - **cms WS 端点**：`wss://veren.top/v1/ws`（或内网 `ws://…:18081/v1/ws`）
   - **cms 用户 API Key**：第 2 步建的 key
   - **节点 ID**：稳定唯一串（跨重启不变，cms 按它记住本节点）
   - **标题/简介/标签**：写清本节点擅长什么——cms 粗配按 tags×4 + title×2 + 简介×1 打分，标签权重最高
   - **并发上限**：与 profile 的 `executor.maxWorkers` 对齐
3. 保存后来源健康变「已连接 cms」即注册完成；cms `GET /v1/admin/taskhub/workers` 应看到本节点。

## 4. 真机验收清单（任务书 §2 Q4）

1. 手机微信发 `任务：…` → 该会话收到完成回复（同一会话，谁下单回复谁）。
2. cms admin：`tasks/{id}` 时间线一条 task_id 串起 received→matched→accepted→reported→replied 全跳。
3. 杀节点（任务在途）→ 租约重排 → 重连后照常完成；全程源会话不重复回复。
4. 无匹配（节点全下线）→ 请求者收到「暂无可用的工作节点」负回复 + admin 见 parked 行。
5. 违反节点 Policy 的任务 → 拒绝理由作为负回复**送达请求者**（不是静默丢弃）。
6. 首单故意派给不可路由描述（如 tags 全不相关且多节点在线）→ 停放 + 负回复可见。

## 5. 故障速查

| 症状 | 断言面 |
|------|--------|
| 节点「已连接」但永不被派发 | 节点是否发了 `node.identity`（2026-11-02 演练实锤：只发 worker.hello = 恒 ErrWorkerOffline） |
| 凭证被拒停泊不重连 | close 4401 = API Key 失效/用户被禁；换 key 后重新保存来源配置 |
| 任务停在 routed | 节点离线等租约重排；attempts 到 `max_attempts` 后停放+负回复 |
| 回复没到微信 | `im_hub` 会话是否存活（管理面 authorize）；task_events 里 reply_failed 行 |

## 6. 明确不做（v1 边界）

email/飞书来源适配器（origin 地址空间已预留）；把既有 gitea/github/feishu 节点侧来源迁到 cms intake；taskhub 管理 GUI；LLM 辅助匹配（`internal/llm` 留候选池）。
