# CMS 公共任务路由服务（taskhub）× dsh-superagent 工作节点 — 四问加深任务书

状态：**待执行**（2026-11-02 立项，四问加深 + 取证在案）。
本文档是任务书，不是设计定案：§3 的架构裁决点按推荐执行，执行中证据推翻推荐时，先改本文档再改代码。

---

## 0. 需求原话与一句话重述

原话（2026-11-02）：

> superagent 中任务分发接收应该有一个公共的路由服务，部署在 cms 中。
> `dsh --profile superagent` 只注册一个工作节点，每个节点有 title/description，router 根据这些信息分派消息；
> 完成后收集消息，从哪里来的回复哪里，谁下的任务，就回复谁，如：email/wechat/飞书等。

一句话：在 cms 里新建公共任务路由域 **taskhub**：外部渠道消息进来 → 按「工作节点自述的 title/description」路由到一个 `dsh --profile superagent` 节点 → 节点走 superagent 既有流水线完成 → 结果沿「来源渠道 + 下单人」原路送回。

---

## 1. 取证在案（写代码前必须知道的事实）

### 1.1 superagent 侧（`plugins/dsh-superagent`，fork，@deepseek-ai 作用域）

- 现有流水线：Source → Trigger → Eval（闸门+评估）→ Decision → Ticket（含 Mandate）→ Assignment → Executor（**进程内** worker 会话）→ Report → Outbox → Channel 回来源。域文档 `docs/001-domain.md`、`002-authorization.md`、`003-execution.md`、`007-architecture.md`；新增来源配方 `docs/008-cookbook.md`。
- 来源是一等可插拔协议：`SourceKind`（`src/sources/kind.ts:87-115`）：kind/schema/fields/scope/policy/channel/threadContext/find/environment。gitea 的接入体量是样板——cordis 入口仅约 14 行（`src/sources/gitea.ts:116-129`：注册 kind + 起 watch）。
- 回复通道契约已定型：`SourceChannel.send` 按 message.id 幂等，返回 `'sent' | 'gone'`（`kind.ts:48-58`）；Outbox 是带重试的持久效果队列（5s→300s，`src/app/outbox.ts`）。Ticket 持有 `ChannelRef`（source + thread + address）——**单实例内的回复路由早已是一等数据**。
- worker 目前只是进程内概念（`worker-<ticketId>` 会话 + `WorkerSlots`/`executor.maxWorkers` 并发上限），**没有远程节点概念**。
- 没有任何 websocket 客户端；HTTP 仅环回面板 API（强制 127.0.0.1 Host）。外部 I/O 全走 CLI 子进程。
- fork 特立：cordis 4.0.5-alpha.1（@deepseek-ai 线）、依赖无关的 `tools/gitea-cli`、凭据进配置文件不进 env（DSH 会剥凭据形 env）。
- 部署：Olares chart（`deploy/olares/`，未提交）+ profile `superagent`，端口 3082。

### 1.2 cms 侧（`D:\cms`，单二进制 Go：chi + SQLite WAL + sqlc）

- **wsgw**（`/v1/ws`，gorilla）：插件长连已具备「节点身份 + 指令下发」两面：
  - `node.identity` 事件 → `ws_nodes` UPSERT（键 `(user_id, node_id)`），载荷 `{nodeId, nodeName, nodeDescription, nodeIcon}`（`internal/wsgw/nodes.go`；插件侧 `plugins/cms-bridge/src/identity.ts`）。
  - 指令帧下行 `{type:'command',id,action,payload}` / 回执上行 `{type:'result',id,ok,...}`，帧形态与 cms-bridge `protocol.ts` 同形且 Go 注释钉死（`internal/wsgw/command.go:11-13`）；`DefaultCommandTimeout = 10s`（`command.go:18`）；目标离线即 `ErrConnOffline`；帧原文双向留痕 `ws_messages`。
  - 插件可主动上报 `{type:'event',id,name,payload,ts}`；cms-bridge 的 reporter 有**离线 FIFO 补报**（`src/reporter.ts`）。
- **imhub**（`internal/imhub`，生产在用）：云端持 iLink 微信会话；设备长轮询 `GET /v1/im/hub/messages`（25s hold、after 游标、新设备 only ≤5min 防吞史）+ `POST /v1/im/hub/replies {conversation_id, text}`；people 目录；错误码段 7600-7699；迁移 0207/0208。这是 cms 内「云端中枢 + 回信路由」最近先例：消息幂等入库 `UNIQUE(device,message_id)`、游标推进、至少一次批量送达后才推游标。
- 新域接入清单（该仓 AGENTS.md）：迁移下一号实测（当前 0210 起，取号前 `ls migrations/*.up.sql | tail`）；sqlc 每域一个 yaml；`internal/<domain>/{store,service,routes,codes}.go`；`cmd/server/domain_build.go` + `domain_mount.go` 追加式注册；rbac 权限码中央登记；错误码段向中央台账申领；**文件 ≤300 行 / 函数 ≤60 行**；测试先行红绿双向；后台 goroutine 在 `domain_stack.go` 挂停止句柄。
- `internal/llm` 已存在（LLM 域）——匹配器将来可选加分项。

### 1.3 一处硬协议约束（决定架构形态）

wsgw 指令回执是**同步等待且上限 10s**（`command.go:18`），而 superagent 任务是分钟~小时级 ⇒ **任务完成不能走 result 帧**。
正确形态：result 帧只承载「接/拒」（assignment ack）；完成经 EventFrame `task.result` 上报，以 taskId 关联；cms-bridge 式离线补报保证完成事件不丢。

---

## 2. 四问

### Q1 专业人士会多做什么（需求没要求、缺了必炸）

1. **持久任务队列，不是"收到就转发"**：任务落库、租约（lease + 可见性超时）、节点崩溃/离线自动重排、幂等键防重复投递；至少一次语义 + 节点侧幂等。imhub 已在同一仓库交过这笔学费（幂等入库 + 游标 + 先送达后推游标）。
2. **回复地址 = 任务信封一等数据**：`origin = {source_kind, conversation, requester}` 在 intake 定格、全生命周期不可变；「任务完成」与「回复已送达」是两个独立持久状态（回复自有 outbox + 重试 + gone 终态）。「从哪里来回哪里、谁下单回复谁」由此从口号变成字段。
3. **失败路径全数建模**：无节点匹配 → 停放 + 对请求者负回复；多节点竞争 → 确定性 tie-break；节点拒绝 → 拒绝理由作为负回复送达；回复通道 gone → 可见终态。**请求者对任何结局都有回声**。
4. **授权边界不旁路**：router 匹配只是"建议"，节点 superagent 的 Eval/Policy/Mandate（docs/002）保留否决权——这是"谁可以让机器干活"的最终防线，路由层短路它等于拆掉授权体系。cms 侧：谁可下单（people/白名单/intake 规则配置化）、谁可注册节点（cms 用户 API Key 已门 WS）。
5. **全程 task_id 时间线**：intake→routed→acked→running→reported→replied/failed 每跳留痕（复用 `ws_messages` 审计模式 + `task_events` 表），admin 可回放任意一单。
6. **容量与背压**：节点注册带 maxConcurrent（对齐 superagent 既有 `executor.maxWorkers`），心跳带在载，任务 TTL，队列深度可见。

### Q2 最原生材料（从哪里开工，而不是从谁的转述开工）

- `plugins/dsh-superagent/docs/001-domain.md`、`002-authorization.md`、`003-execution.md`、`007-architecture.md`、`008-cookbook.md`（新增 SourceKind 的配方即 008）
- `plugins/dsh-superagent/src/sources/kind.ts`（SourceKind/SourceChannel 协议全文）、`src/app/outbox.ts` + `src/app/runtime.ts`（effects/事件挂点）、`src/core/model.ts`（ChannelRef/Trigger）、`src/sources/gitea.ts`（接入样板）、`tests/fixtures/host.ts`（仿真 DSH 宿主）
- `D:\cms\internal\wsgw\command.go`、`nodes.go`、`hub.go`、`routes_admin.go` + 迁移 0200/0202（帧契约与节点登记的原始实现）
- `D:\cms\internal\imhub\` 全套 + `docs/notes/adopted/2026-10-27-imhub.md` + 迁移 0207/0208（中枢+回信先例）
- `plugins/cms-bridge/src/protocol.ts`、`connection.ts`、`reporter.ts`（帧镜像 + 重连/补报语义）
- `plugins/im/hub/src/provider.ts`（设备侧拉取/回信/游标的运行实现）
- 外部先例**只取不变式命名、不抄实现**：AMQP 0-9-1 的 at-least-once/ack/redelivery 语义章节、NATS JetStream ack 模型、Temporal task queue 概念。

### Q3 方法与工具

1. **契约先行**：`docs/taskhub-protocol.{cn,}.md` 版本化 wire contract——任务信封 JSON、动作（下行 `task.dispatch`；上行事件 `task.result`/`task.heartbeat`）、错误码、生命周期状态、幂等规则；Go/TS 双侧镜像 + **共享 JSON fixtures 契约测试**（先例：`command.go` 首注钉 `protocol.ts`）。
2. **cms 侧按该仓 AGENTS.md**：红绿双向测试；迁移 0210（实测取号）；sqlc 每域 yaml；`internal/taskhub/{store,service,routes,codes,matcher,deliverer}.go`（文件≤300行/函数≤60行）；`domain_build`/`domain_mount` 追加式；rbac `task:read`/`task:manage`；错误码段中央申领；派发/租约 goroutine 挂停止句柄。
3. **节点侧**：fork 内**自持薄 WS 客户端**（同形帧协议、零 cordis 依赖，放 `src/infra/`，凭据进 schemastery secret 配置）——**不引 @veren/cms-bridge**（其 @veren/core 依赖会在 fork 的 @deepseek-ai/cordis 树里装出第二份 cordis 实例，AGENTS.md 红线）；新增 `taskhub` SourceKind（008 配方）+ worker 注册/心跳 + 派发命令处理（→ `ctx.orchestrator.receive(Trigger)` 走既有 Eval 闸门）+ `ticket.ended` → `task.result` 事件。
4. **性质测试（表格驱动状态机）**：不重复投递、不丢回复、origin 不可变、租约过期重排不双重认领、幂等键去重、拒绝必达。
5. **环境链（三隔离）**：本地源码起 cms + 3080 稳定节点集成 → staging 3100 演练 → 生产 veren.top 走 `deploy-local-pkg.sh`；superagent 节点按既有 Olares chart / 稳定测试节点规则。

### Q4 外部裁决者（不由你我不由实现者裁决）

1. **真实手机**：微信发一句任务 → 完成回复落回**同一会话**、显示在真实手机上（imhub 生产链在位，今天就可裁）。
2. **SQLite 时间线**：`im_hub_messages` 行 → `tasks` 行（origin 三元组）→ `ws_messages` 派发帧 → result/事件帧 → replies POST——一条 task_id 串起全部，admin 可回放。
3. **混沌注入裁决不变式**：杀节点（任务在途）/杀 cms（派发在途）/重复派发——裁决"不丢任务、源线程不重复回复"两条。
4. **拒绝路径**：违反节点 Policy 的任务 → 拒绝理由作为负回复**送达请求者**（不是静默丢弃、不是只进日志）。
5. **盲写第二客户端**：只凭契约文档实现 TS 客户端与 Go 侧互通——文档即裁决者。
6. **无匹配场景**：请求者收到"暂无可用节点"负回复 + admin 可见 parked 行。

---

## 3. 架构裁决点（第一裁决，推荐如下）

| # | 分叉 | 推荐 | 依据 |
|---|------|------|------|
| D1 | 派发方向：push（wsgw command 下发）vs pull（imhub 式长轮询） | **push** | wsgw command 面现成（pending map + 留痕 + ErrConnOffline）；离线任务停放即可。pull 留作后备 |
| D2 | 谁做匹配 | **cms 粗配（title/description + 标签关键词），节点 Eval 终裁** | cms 不该懂节点语义；节点保留否决权（授权红线）；`internal/llm` 留作将来加分 |
| D3 | 完成传输 | **result 帧只承载接/拒；完成走 EventFrame `task.result`（taskId 关联）** | §1.3 硬约束（10s 同步上限 vs 分钟级任务） |
| D4 | v1 来源适配 | **仅微信**（imhub 生产在位）；origin 地址空间预留 email/feishu/webhook；**既有节点侧 gitea/github/feishu 来源不迁移不替换**——taskhub 是新增 SourceKind，不是替换 | 深不要大；唯一今天可真机裁决的回信链 |
| D5 | worker 元数据存储 | **taskhub 自持 `worker_meta` 表**（键 `(user_id, node_id)`），wsgw 与 `ws_nodes` 不动 | 域边界干净；wsgw 保持薄透传 |
| D6 | 节点侧传输实现 | **fork 内自持薄 WS 客户端**（同形协议、零 cordis 依赖），不引 @veren/cms-bridge | 防第二份 cordis 实例（AGENTS.md 红线）；符合 fork 依赖无关传统（gitea-cli 先例） |
| D7 | intake 规则（哪些微信消息成任务） | **配置化**：默认「指定会话 或 消息前缀 + people 白名单」，cms config 热读（沿 `im.hub.*` 惯例） | 不硬编码；规则是运营面不是代码面 |

## 4. 数据与协议草案（契约文档定稿前的底稿）

- `tasks`：id(ulid) / origin(kind, conversation, requester) / intent(text) / status / lease(worker_node_id, expires_at) / idempotency_key / created_at / updated_at
- `task_events`：task_id / seq / type / payload / at —— 时间线（回放面）
- `worker_meta`：(user_id, node_id) / title / description / tags / max_concurrent / last_heartbeat
- 状态机：`received → routed → accepted → running → reported → replied`；旁路终态 `parked`（无匹配）/ `failed` / `requeued`（租约过期或节点拒接后回池）
- 协议动作：下行命令 `task.dispatch`（信封含 taskId/origin/intent/上下文）；上行事件 `task.result {taskId, outcome, summary}`、`task.heartbeat {taskId?, load}`；result 帧即 assignment ack（`{accepted:true|false, reason?}`）
- 节点侧映射：信封 → Trigger（source=`taskhub`，thread key `taskhub:<taskId>`，Mandate basis 携带 origin.requester）→ 既有 Eval/Policy 全流程；回复经该 SourceKind 的 `SourceChannel.send` 汇成 `task.result`

## 5. 任务分解与验收（六腿）

- **A cms 域**：迁移 0210（up/down + frontier pin 测试）、store/service（红绿）、matcher（关键词粗配 + tie-break + 无匹配停放）、deliverer（push + 租约 + 重排 goroutine）、admin routes（列表/详情/重排/时间线）、intake 规则（配置热读）+ rbac/错误码段登记。
- **B 节点侧**：薄 WS 客户端（重连/退避/凭证失败停泊/离线补报）、`taskhub` SourceKind（schema/fields/policy/channel）、worker 注册与心跳、派发→Trigger→Ticket→`task.result` 全链；vitest + 仿真宿主 + 假 cms WS 服务。
- **C 契约**：`taskhub-protocol.{cn,}.md` + 共享 fixtures + Go/TS 双侧契约测试 + 盲写第二客户端验证。
- **D 集成**：本地源码 cms + 3080 节点：模拟微信消息 → 任务 → 节点 superagent 会话 → 回信落回模拟会话；时间线回放核验。
- **E 混沌**：杀节点/杀 cms/重复派发三剧本，不变式裁决（不丢、不重）。
- **F 真机**：staging 3100 演练 → 生产 `deploy-local-pkg.sh`；真机清单 = §2 Q4 六条逐一取证（手机截图 + SQLite 行 + admin 回放）。

## 6. 约束红线（照抄两仓 AGENTS.md，执行时逐条自查）

- cms：文件≤300行/函数≤60行；测试先行红绿双向；迁移/sqlc/权限码/错误码段**中央登记追加式**；域逻辑与传输分离（薄 handler）。
- 本仓：schemastery 定义 config；单文件300行/单函数30行；测试放包级 tests/；规范"单独跑才过的 spec 是缺陷"；**任何 dsh 命令必须显式 DSH_HOME**；禁止写 `~/.dsh`；三环境隔离铁律；版本变更先 bump 再发布；本地导入带 `.ts` 后缀全 ESM NodeNext。
- 凭据：cms token 走 schemastery secret / 配置文件，绝不进 env（DSH 剥凭据形 env）。

## 7. 终止条件

真实微信里发一句任务 → 手机收到带结论的回复（同一会话）；cms 审计时间线完整可回放；混沌三剧本不变式全过；无匹配与拒绝两条负路径均有送达证据。此四条齐，任务才算完成。

---

## 交付记录（2026-11-02，A–E 腿完成）

- **cms 侧**（main d6393377 → 3458ccf9，八笔）：契约登记（TODO 72/SESSIONS/adopted）→ 迁移 0210 四表（前沿钉）→ 错误码 7700-7799 + 权限码 taskhub:read/manage（中央登记小提交）→ 域核心（持久队列/租约重排/粗配/幂等 intake/origin 投递，红绿）→ wsgw 两个 append-only 窄口（通用事件 tap + ConnByNode + Uplink 收口）→ admin 路由 + 装配三件 + config seed 六键 + 金标 311→315 + openapi 重产 → **全链旅程测试**（真 wsgw 指令面 + 假 WS 节点 + 真库：intake→匹配→派发→接单→回复→完成→回信→时间线回放）。
- **节点侧**（cursour 573a627）：`src/infra/taskhub/{protocol,connection}.ts`（零 cordis 薄 WS 客户端：重连退避/凭证停泊 4401/离线 FIFO 补报+ack/命令分发——契约字面双侧钉）+ `src/sources/taskhub.ts`（SourceKind 'taskhub'：注册/心跳/派发→Trigger→Eval 闸门全保留→Outbox→task.reply；ticket.ended/decision.recorded 挂 runtime.ts）+ patch yml `dsh-superagent-taskhub`（默认 disabled）+ 007 文档表 + bundle-patch 金标更新。
- **测试**：cms 域 23 测 + wsgw 窄口 3 测 + 旅程 1 测 + 迁移 2 测全绿；fork 14 测绿（连接 5/契约 5/kind 4），typecheck + build 绿；全量套件与基线逐一对齐（Windows 预存环境失败零新增）。
- **混沌剧本的在程覆盖**：杀节点=LeaseTick 重排（3 次到限停放+负回复，测在案）；杀 cms=节点离线 FIFO 补报（fork 连接测在案）；重复派发=节点 taskId 幂等 + cms UNIQUE(task_id,type,ref)（双侧测在案）。
- **F 腿待真机**（见 §5，唯一剩余）：① staging cms 部署演练；② 生产 `deploy-local-pkg.sh`；③ 真机清单 = §2 Q4 六条（真实微信发单→手机收回复、SQLite 时间线、无匹配/拒绝负回复送达）；④ 节点侧真机 = 3080 或 Olares chart 启用 `dsh-superagent-taskhub` 行并配 url/token/title/tags。

## 交付记录·F 腿（2026-11-02 续）

- **F1 双进程演练**（cms `scripts/taskhub-rehearsal/`，f5652c9e）：真 cms 二进制 + 盲写假节点（只凭契约文档实现）+ mock iLink。**首跑即抓出 node.identity 缺失缺陷**（fork 真实客户端同款——in-process 旅程测被掩蔽的集成缺口），三处修复：契约 §2 钉两段注册、fork connection.ts 修（a87b9bb）、演练假节点修。混沌三剧本全过：杀节点=重排 2 次→停放+负回复送达；杀 cms=节点 1006→2s 自重连→死亡期间种的任务照常完成；重复派发=Engine intake `duplicate` 幂等（fork 真引擎测试钉死）。outbox 11 条 = 3 停放负回复 + 4 完成单×2，分毫不差。
- **F2/F3 生产上线**（cms main 49c26606 → veren.top）：顺手修复 `copy-button.tsx` 缺 Button 导入的预存破损（a57832d5 起阻塞一切正规 web 构建，49c26606）；deploy-local-pkg.sh 全链（组包→scp→box 校验→原子换位→信封验证→自动回切就绪）EXIT=0，release `20261102130422`。部署后核验：schema_migrations MAX=210、taskhub 四表在册、公开面 `/v1/admin/taskhub/tasks` 回 1003（路由在册+守卫生效）、rbac 自动补绑 taskhub:read/manage 日志实证。
- **取证**：生产微信会话 -14 失效首现于归档日志 11:15:25Z，早于部署（13:04Z）约两小时——iLink 服务端自行过期，与部署无关；真实微信链路需重新扫码授权（本来就是用户步骤）。
- **F4 待用户**：①管理面重新扫码授权微信；②建节点 API Key；③平台参数设 task.hub.* 六键；④任一节点启用 `dsh-superagent-taskhub` 行（上线指南 = fork docs/009-taskhub.{cn,}.md）；⑤真机六条验收（§2 Q4）。
