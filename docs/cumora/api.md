---
title: 服务端接口
description: "四类接口面与各自凭据、按资源分组的端点清单、六个核心契约、分页与幂等、上限与运行时兼容约定。"
sidebar:
  order: 18
  label: 18 服务端接口
draft: false
lastUpdated: 2026-11-04
---

## 18. API

本章把 Cumora 0.18.9 对外的全部 HTTP 入口收敛成四类接口面：人类客户端、智能体运行时、邮件入站与运营后台；随后按资源列出端点与守卫，为六个最容易误用的接口给出完整契约，最后说明分页词汇、幂等收敛、数值上限与运行时的兼容约定。错误码名与重试语义集中在 [错误码与状态模型](./errors/)，此处只引用。

### 18.1 Surfaces and Authentication

四类接口面跑在同一个进程、连同一个数据库，但凭据来源与前置校验完全不同。把人类会话令牌发到运行时面、或把设备令牌发到人类面，必须被直接拒绝，且拒绝理由不能泄漏资源是否存在。

| 接口面 | 前缀 | 凭据 | 前置校验顺序 | 拒绝形态 |
| --- | --- | --- | --- | --- |
| 人类客户端 | `/api` | 会话令牌，`Authorization: Bearer` 或 `x-session-token` | 解析会话并挂上调用者（中间件本身不拒绝）→ 处理器各自要求登录、租户成员、角色 | `401 authentication required`；角色不足 `403`；越权统一 `404` |
| 智能体运行时 | `/runtime` | 运行时 JWT，HS256 | 验签 → 过期 → 租户声明 → 放置关系复核 | 缺头 `401`；缺租户 `403`；放置变化 `403`；复核不可用 `503` |
| 邮件入站 | `/webhooks/email` | `x-cumora-signature` 签名头 | 对原始字节做常量时间比较，通过后才解析 JSON | 验签失败 `401`；secret 未配置 `503` |
| 运营后台 | `/api/admin` | 同一会话令牌，另加平台管理员标记 | 先解析会话，再检查管理员标记 | 非管理员 `403 admin only` |

四类面的凭据各自独立，不允许互相顶替：

- **会话令牌 30 天硬上限加 14 天空闲滑窗。** 库内只存哈希，每次解析刷新最后使用时间；超过硬上限或空闲窗口即删除该行。登出删行；停用账号在同一事务内删除该用户全部会话，撤销因此是即时的。
- **长连票 60 秒一次性。** 先用会话令牌换票，再以查询参数携带建连；票的消费是原子更新，重复使用、过期、未知一律按未认证处理并以 `4401` 关闭。长连本身不携带会话令牌。
- **运行时 JWT 与放置关系绑定。** 声明含智能体、租户、计算机、放置标识与固定 scope；服务端不维护黑名单，而是每次请求复查三者是否仍一致。智能体迁移、设备撤销、成员移除都会让旧令牌在同一请求内失效。
- **入站邮件无时效窗口。** 签名覆盖原始字节，任何重新序列化、字符集转换或字段重排都会导致验签失败；轮换 secret 是唯一撤销手段，secret 未配置时接口整体关闭而不是开放。
- **一次性令牌只回显一次。** OAuth 状态 300 秒；邀请令牌 7 天且库内只存哈希，原文只出现在创建响应里。

| 头 | 适用接口面 | 必填 | 语义与约束 |
| --- | --- | --- | --- |
| `Authorization: Bearer <token>` | `/api`、`/runtime`、设备面 | 除公共面外必填 | 会话令牌、设备令牌、运行时 JWT 共用这一头，按面分别解析，不得跨面复用 |
| `x-session-token` | `/api` | 否 | 仅在缺少 `Authorization` 时读取，供长连风格客户端复用 |
| `x-company-id` | `/api` 租户面 | 否 | 头本身不授权，必须命中成员关系；缺省回退规则与风险见 [权限与多主体](./permissions/) |
| `Content-Type: application/json; charset=utf-8` | 全部 JSON 面 | 是，无体请求除外 | 体上限按面区分，见 18.5 |
| `x-cumora-signature` | `/webhooks/email/inbound` | 是 | 十六进制 HMAC-SHA256，密钥只在服务端环境，不随响应下发 |
| 无幂等头 | 全部创建面 | 不适用 | 幂等靠请求体 `requestId` 或 `clientId` 加部分唯一索引，不设 `Idempotency-Key` |

### 18.2 Endpoint Inventory

按资源分组，共 199 条方法与路径。守卫短码：`P` 公开、`A` 需登录、`C` 需租户成员、`R` 需 owner 或 admin、`O` 仅 owner、`M` 需会话成员、`B` 需看板访问、`D` 需设备令牌、`T` 需开发者工具开关、`N` 需平台管理员、`RT` 需运行时 JWT；一行内多段时，守卫按段顺序一一对应。

公共与认证：

| 方法与路径 | 作用 | 守卫 |
| --- | --- | --- |
| `GET /api/livez` · `GET /api/health` | 存活探针不碰库；就绪探针以 1 秒竞速查一次库 | P |
| `GET /api/public/signup-config` · `GET /api/og` | 候选名单开关，任意来源可读；链接预览抓取，拒绝私网且约 6 秒超时 | P |
| `GET /api/metrics` | Prometheus 文本，未配置共享令牌时直接 404 | 共享令牌 |
| `GET /api/uploads/capabilities` · `POST /api/uploads/presign` · `POST /api/uploads/refresh-url` · `POST /api/uploads` | 存储模式与允许类型；签发直传地址；为已有对象重签下载；base64 落存储，鉴权先于 34MB 解析 | P · C · C · A+C |
| `GET /api/auth/providers` · `GET /api/auth/start/:provider` · `GET /api/auth/callback/:provider` | 可用浏览器提供方；发起授权；回调换会话，回跳按白名单前缀匹配 | P |
| `POST /api/auth/apple/native` · `POST /api/auth/logout` | 校验 Apple 身份令牌并回会话；按 Bearer 删会话行，尽力而为 | P · 无 |
| `POST /api/auth/ws-ticket` | 铸 60 秒一次性长连票 | A |
| `GET /api/auth/me` · `GET /api/me` · `GET /api/me/quota` · `GET /api/me/preferences` · `PUT /api/me/preferences` | 完整身份；只回标识与显示名的旧版桩；配额快照；读偏好；整份覆盖写 | A |
| `DELETE /api/me/account` | 软删账号：盖删除时间、清个人数据、级联、清会话 | A |

公司与成员：

| 方法与路径 | 作用 | 守卫 |
| --- | --- | --- |
| `GET /api/companies` · `POST /api/companies` | 我的工作区与角色；新建工作区，含 slug、owner、参与者镜像与付费档播种 | A · A+配额 |
| `GET /api/companies/:id/members` · `PATCH /api/companies/:id/members/:userId` · `DELETE /api/companies/:id/members/:userId` | 人类成员名册取真实角色；成员与管理员互转，owner 不可经此改；移除成员并保留历史 | R · A+事务内 owner · A+owner 或 admin |
| `DELETE /api/companies/:id` | 硬删租户数据，逐表显式删除后交清理任务 | A+owner+名称确认 |
| `GET /api/companies/:id/invitations` · `POST /api/companies/:id/invitations` · `DELETE /api/companies/:id/invitations/:inviteId` | 邀请列表最多 200 条；铸邮箱锁定或可分享链接；撤销且幂等 | R |
| `GET /api/invitations/:token` · `POST /api/invitations/:token/accept` | 公开预览邀请状态；接受邀请入租户并镜像参与者 | P · A |

计算机与守护进程：

| 方法与路径 | 作用 | 守卫 |
| --- | --- | --- |
| `GET /api/computers` · `POST /api/computers` · `POST /api/computers/pairing-code/rotate` · `POST /api/computers/:id/repair` | 本租户可见计算机；取或铸公司级配对码且不建行；轮换公司配对码且既有设备存活；为已有计算机铸重连码 | C · R · R+O · R |
| `POST /api/computers/pair` · `DELETE /api/computers/:id` | 配对码换设备令牌，码本身即凭据；撤销设备并让该机派生令牌全部失效 | 无 · R |
| `POST /api/computers/:id/detect` · `POST /api/computers/:id/engine-update` · `GET /api/computers/:id/engine-updates/:updateId` · `POST /api/computers/me/engine-updates/:updateId` | 请求探测本机引擎；触发引擎自更新；查更新状态；守护进程上报状态 | R · R · C · D |
| `POST /api/computers/:id/default-engine` · `GET /api/computers/:id/engine-defaults` · `PUT /api/computers/:id/engine-defaults` · `POST /api/computers/me/engines` | 设计算机默认引擎；读每引擎默认模型；写每引擎默认模型；上报可用与被拒引擎 | R · C · R · D |
| `PUT /api/computers/:id/unsandboxed-mode` · `GET /api/computers/me/unsandboxed-mode` | 持久化宿主级免沙箱开关；守护进程读回 | R · D |
| `GET /api/computers/me/control-stream` · `GET /api/computers/me/agents` · `POST /api/computers/heartbeat` | 设备控制流；本机被分配的智能体，每 60 秒轮询；心跳含版本与引擎清单 | D |
| `POST /api/agents/:id/runtime-token` · `POST /api/agents/:id/computer` | 为呼叫设备铸运行时令牌，未分配返回 403；迁智能体，免费档拒绝云端 | D · R |

智能体、项目与参与者：

| 方法与路径 | 作用 | 守卫 |
| --- | --- | --- |
| `GET /api/participants` · `POST /api/agents` | 租户参与者名册并顺带刷新过期状态；建智能体，`requestId` 幂等且受档位上限约束 | C · R |
| `PUT /api/agents/:id` · `DELETE /api/agents/:id` · `POST /api/agents/:id/rehire` | 改人格、模型与工具；停用离场但保留消息；复职 | R |
| `POST /api/agents/:id/avatar/generate` | 调图像模型生成头像，产生费用 | R |
| `GET /api/agents/:id/autonomy` · `PUT /api/agents/:id/autonomy` · `GET /api/agents/autonomy` | 我对该智能体的自治阈值；写阈值；本租户全部记录 | C |
| `GET /api/projects` · `POST /api/projects` · `PUT /api/projects/:id` · `POST /api/projects/:id/archive` | 项目列表含会话数；建项目；改名改色；归档或取消归档 | C · C · R · R |
| `POST /api/conversations/:id/project` | 挂或摘会话到项目，置空即摘 | C |

会话、消息、投票、邮件、搜索、旁听与会议：

| 方法与路径 | 作用 | 守卫 |
| --- | --- | --- |
| `GET /api/conversations` · `POST /api/conversations` · `POST /api/conversations/direct` | 会话列表，单次硬上限 500；建群且调用者入群、至少另有一名成员；找或建一对一直聊，幂等 | C |
| `POST /api/conversations/:id/topic` · `POST /api/conversations/:id/title` · `POST /api/conversations/:id/pin` · `POST /api/conversations/:id/mute` | 设或清主题；改群名，仅群类型；置顶开关；免打扰可带到期时间 | C+成员 |
| `POST /api/conversations/:id/members` · `POST /api/conversations/:id/leave` | 加成员，先落成员关系再写系统行；退群，授权谓词重复写在更新内 | C |
| `POST /api/conversations/:id/typing` · `POST /api/conversations/:id/read` | 打字指示；推进已读游标 | M |
| `GET /api/conversations/:id/messages` · `POST /api/conversations/:id/messages` | 消息分页，按序号向前翻且结果升序；发消息，`clientId` 幂等，附件最多 16 项 | M · C+成员 |
| `GET /api/conversations/:id/messages/:rootId/replies` · `POST /api/messages/:id/reactions` | 单层回复列表；加或取消表情 | M · C |
| `POST /api/polls` · `POST /api/polls/:messageId/vote` · `POST /api/polls/:messageId/close` | 建投票；投票；关闭投票 | C |
| `POST /api/email/send` · `GET /api/email/:messageId/html` · `POST /api/email/reply/:messageId` | 由会话发外发邮件，附件最多 16 个且合计不超过 25MB；取 HTML 供沙箱内嵌；回复正文上限 50k | C · C+成员 · C+成员 |
| `GET /api/search` | 统一搜索，参与者、房间、群、消息按 8/8/8/15 分桶 | C |
| `GET /api/peek/agent-chats` · `GET /api/peek/agent-chats/:id/messages` | 旁听全部智能体私聊；读某条私聊的消息 | R+O |
| `POST /api/conversations/:id/convene` · `GET /api/conversations/:id/convene` · `GET /api/convene/:sessionId/transcript` | 在会话上开会；读当前会议；读逐条记录且须命中会议所属会话 | C+成员 |

开发者工具、可观测、看板、日历、文档与推送：

| 方法与路径 | 作用 | 守卫 |
| --- | --- | --- |
| `GET /api/devtools/capabilities` · `GET /api/devtools/agent-workspace` · `GET /api/devtools/agent-workspace/file` | 能否开开发者工具与当前角色；列智能体工作区文件；读文件 | C · T |
| `GET /api/agents/observability/runs` · `GET /api/agents/observability/runs/:id/events` | 运行列表，停滞阈值 5 分钟；某次运行的事件流 | T |
| `GET /api/agents/observability/triage` · `GET /api/agents/observability/wakes` · `GET /api/agents/observability/llm-spend` | 判断成本账，窗口 1 到 720 小时；唤醒经济性；按用途与模型的花费 | T |
| `GET /api/boards` · `POST /api/boards` · `GET /api/cards/:id` · `GET /api/boards/:id` | 看板列表；建看板并自动生成三列且 `requestId` 幂等；由卡片反查看板与列；全量快照 | C · B |
| `PATCH /api/boards/:id` · `DELETE /api/boards/:id` | 改名改描述；删除并级联列、卡与评论 | B |
| `POST /api/boards/:id/columns` · `PATCH /api/boards/:bid/columns/:cid` · `DELETE /api/boards/:bid/columns/:cid` | 追加列；改名改位置；删列及其卡片 | B |
| `POST /api/boards/:id/cards` · `PATCH /api/boards/:bid/cards/:cid` · `DELETE /api/boards/:bid/cards/:cid` | 建卡并解析提及；改卡、移动列、改负责人；删卡 | B |
| `GET /api/boards/:bid/cards/:cid/comments` · `POST /api/boards/:bid/cards/:cid/comments` · `DELETE /api/boards/:bid/cards/:cid/comments/:mid` | 评论列表；加评论上限 8000 字符；删自己的评论 | B |
| `GET /api/calendar/events` · `POST /api/calendar/events` | 按窗口查事件；建事件，`requestId` 幂等 | C |
| `GET /api/calendar/events/:id` · `PATCH /api/calendar/events/:id` · `DELETE /api/calendar/events/:id` | 读、改、删，租户与可见性折进同一条语句，越权 404 | C |
| `POST /api/calendar/events/:id/run-now` · `GET /api/calendar/events/:id/dispatches` | 立即派发一次；派发历史 | C |
| `GET /api/documents` · `POST /api/documents` · `GET /api/documents/:id` · `PUT /api/documents/:id` · `DELETE /api/documents/:id` | 列表；建文档，`requestId` 幂等且回放返回 200；读元数据；改标题；删文档限创建者或 owner 与 admin | C |
| `POST /api/push/register` · `POST /api/push/unregister` | 注册推送设备，平台限三值；注销设备 | A |

运营后台与交付证据：

| 方法与路径 | 作用 | 守卫 |
| --- | --- | --- |
| `GET /api/admin/me` · `GET /api/admin/settings` · `PUT /api/admin/settings` | 管理员探针；读平台开关；改候选名单与暂停注册，空体 400 | N |
| `GET /api/admin/users` · `GET /api/admin/users/:id` · `PATCH /api/admin/users/:id` · `GET /api/admin/stats` | 用户分页含关键字、档位、上限与偏移并回总数；详情含所属工作区；改档位、管理员标记与停用；仪表盘聚合 | N |
| `GET /api/admin/waitlist` · `POST /api/admin/waitlist/:id/approve` · `POST /api/admin/waitlist/:id/reject` | 候选名单分页；批准并建用户与个人工作区；拒绝可附说明 | N |
| `GET /api/admin/observability/llm` · `GET /api/admin/observability/llm/calls` | 花费大聚合带 30 秒进程内缓存；明细下钻 | N |
| `GET /api/shipping/overview` · `GET /api/shipping/features/:id` · `POST /api/shipping/features` · `PATCH /api/shipping/features/:id` · `POST /api/shipping/features/:id/transition` | 总览；读契约；建契约；改契约；状态转移由服务端判定 | C |
| `POST /api/shipping/features/:id/invariants` · `PATCH /api/shipping/features/:id/invariants/:invariantId` · `POST /api/shipping/features/:id/verifications` · `PATCH /api/shipping/features/:id/verifications/:verificationId` | 登记不变量；更新不变量；提交验证；回读验证且拒绝自证 | C |
| `POST /api/shipping/features/:id/releases` · `POST /api/shipping/features/:id/releases/:releaseId/action` | 建发布；执行发布动作，需 owner 或 admin | C · C+R |
| `GET /api/shipping/friction` · `POST /api/shipping/friction` · `PATCH /api/shipping/friction/:id` · `POST /api/shipping/features/:id/regressions` · `PATCH /api/shipping/features/:id/regressions/:regressionId` | 摩擦报告的读、建、改；登记回归；更新回归 | C |

运行时：

| 方法与路径 | 作用 | 守卫 |
| --- | --- | --- |
| `GET /runtime/wake-stream` · `POST /runtime/cli` | 唤醒长连，每个事件推送前复检授权；执行参数数组，剥离客户端自称身份并以令牌主体为准 | RT |
| `GET /runtime/persona` · `GET /runtime/skills` · `GET /runtime/climate` | 载入人格；技能索引；智能体环境行 | RT |
| `POST /runtime/conversation/company-id` · `GET /runtime/inbox` · `POST /runtime/conversation/mark-read` · `POST /runtime/notices` | 由会话标识反查租户；载入收件箱且探针模式不推进已读；推进已读；写通知行 | RT |
| `GET /runtime/attachment` · `POST /runtime/context` · `POST /runtime/faces` · `POST /runtime/memory/query` | 换取重签下载地址；按会话批量载入上下文；按标识批量取展示面孔；语义与近期记忆检索 | RT |
| `GET /runtime/inbox-triage/payload` · `POST /runtime/triage` · `GET /runtime/agenda` | 廉价判断所需载荷；记录判断决策，尽力而为；卡片、日历与停滞议程 | RT |
| `GET /runtime/system-prompt` · `GET /runtime/roster` | 构建系统提示词；团队名册文本，自带宿主每回合拉取 | RT |
| `POST /runtime/status` · `POST /runtime/status/heartbeat` · `POST /runtime/typing` | 设状态，五值枚举；状态心跳；打字指示且须有会话授权 | RT |
| `POST /runtime/runs` · `POST /runtime/runs/:runId/heartbeat` · `POST /runtime/runs/:runId/finish` · `POST /runtime/events` | 开运行；运行心跳；结束运行落终态；追加运行事件，四级日志 | RT |
| `POST /runtime/llm-calls` | 批量上报模型调用，每批最多 100 跳 | RT |
| `POST /runtime/busy/heartbeat` · `POST /runtime/busy/clear` · `POST /runtime/thinking/mark` · `POST /runtime/thinking/unmark` · `GET /runtime/thinking/peek` | 占用租约心跳，租期 1 到 300 秒；清除占用；标记我在写；取消标记；查某会话声明 | RT |
| `POST /runtime/worklog/claim` · `POST /runtime/worklog/release` · `GET /runtime/worklog/peek` | 抢占重型动作；释放占用；查占用 | RT |
| `GET /runtime/fs/list` · `GET /runtime/fs/read` · `GET /runtime/fs/stat` · `PUT /runtime/fs/write` · `DELETE /runtime/fs/unlink` | 列目录；读文件；取元信息；整文件写且用 34MB 解析器；删文件 | RT |

另有 `POST /webhooks/email/inbound` 一条：25MB 原始体，验签通过后解析入库，守卫为签名头。

### 18.3 Core Requests and Responses

只列六个接口：字段最多、最容易被客户端猜错，也最容易在改动时破坏既有调用方。下文的错误码名是本方案的稳定码，与第 20 章保持一致；当前实现多数只返回英文文案而不返回码，文案到码的映射关系待确认。

**发消息** `POST /api/conversations/:id/messages`。租户成员，处理器内再校验会话成员，非成员与跨租户同码；体上限 256KB。

```ts
interface PostMessageRequest {
  clientId: string; kind: 'text' | 'attachment'; body: string; quotedMessageId?: string
  attachments?: { objectKey: string }[]   // 最多 16 项，以存储元数据为准
}
interface PostMessageResponse { message: { id: string; sequence: number; createdAt: string }; replayed: boolean }
```

错误：`CONVERSATION_NOT_FOUND`（404，非成员、已退群、跨租户同一响应）、`REQUEST_ID_CONFLICT`（409，同一标识不同正文）、`ATTACHMENT_FORBIDDEN`（403）、`PAYLOAD_TOO_LARGE`（413）。见 [错误码与状态模型](./errors/)。

**建立计算机** `POST /api/computers/pair`。无登录态，配对码即凭据；成功后服务端只保存设备令牌的哈希。

```ts
interface PairComputerRequest {
  code: string; hostName: string; version: string; supervised: boolean
  engines: string[]       // 本机探测到的可用引擎标识
}
interface PairComputerResponse { computerId: string; deviceToken: string }   // 令牌仅此一次返回
```

令牌随 `Authorization: Bearer` 用于设备面；轮换公司配对码只影响后续配对，既有设备不受影响，但撤销设备会让该机派生的运行时令牌在同一请求内失效。码无效或已轮换按 `401` 拒绝，确切状态码待确认；同一主机名重复配对当前会复用既有计算机，这条残留风险同样标注待确认。

**运行时工具调用** `POST /runtime/cli`。运行时 JWT，主体由令牌决定，客户端自称的身份被剥离。

```ts
interface RuntimeCliRequest { argv: string[]; cwd?: string }   // 形如 ['reply', 'grp-9', '正文']
interface RuntimeCliResponse {
  ok: boolean; text: string; exitCode: 0 | 1 | 2
  sideEffects?: { kind: 'message.posted'; targetId: string }[]
  attachmentReads?: string[]
}
```

退出码固定三值：`0` 成功；`1` 出错，模型应改写或收手；`2` 表示写入被有意拒绝（新鲜度或重复闸门触发），模型必须基于返回的新事实重新决策，而不是重发同一段文字。解析支持 `--key value` 与 `--key=value`，`--` 之后按字面量处理且不展开转义。错误：`AGENT_NOT_AUTHORIZED`（403）、`RUNTIME_TOKEN_INVALID`（401）、`INVALID_ARGUMENT`（400）。

**移动看板卡片** `PATCH /api/boards/:bid/cards/:cid`。看板访问；跨租户与无权限同为 404。

```ts
interface MoveCardRequest {
  columnId?: string; position?: number      // 目标列内从 0 开始的序号
  assigneeId?: string | null
  expectedVersion?: number                  // 乐观并发：与当前版本不符即拒绝
}
interface MoveCardResponse { card: { id: string; columnId: string; position: number; version: number } }
```

版本不符返回 `409`，响应体带当前版本与当前列，客户端据此重画而不是盲目重试。现状核查：当前实现是否维护卡片版本列尚未确认，本方案要求补上，标注待确认。

**日历派发与立即触发** `POST /api/calendar/events/:id/run-now`。租户成员，事件可见性折进查询，越权 404。

```ts
interface RunNowRequest { scheduledFor?: string }   // 省略则以当前时刻为槽位
interface RunNowResponse { dispatchId: string; eventId: string; scheduledFor: string; status: 'queued' | 'skipped' }
```

幂等由「事件加派发槽位」的唯一约束保证：同一槽位重复触发返回既有派发而不是再派一条。错误：`RESOURCE_NOT_FOUND`（404）、`STATE_CONFLICT`（409，槽位已占用）、`STATE_CONFLICT`（409，已取消或不含派发指令）。三种码与第 20 章的对应关系待确认。

**发布状态转移** `POST /api/shipping/features/:id/transition`。租户成员；发布动作另需 owner 或 admin。

```ts
interface TransitionRequest {
  to: 'draft' | 'ready' | 'releasing' | 'shipped' | 'regressed'
  note?: string; evidenceIds?: string[]     // 指向验证记录，提供者不能同时是验证者
}
interface TransitionResponse { feature: { id: string; status: string; updatedAt: string }; missing: string[] }
```

转移由服务端判定：证据不足返回 `409 INVALID_STATE_TRANSITION` 且 `missing` 非空；重复提交幂等，不重复推进时间线。

### 18.4 Pagination and Idempotency

三套分页词汇并存，不得假设可以互换：

| 场景 | 参数 | 约束 | 响应 |
| --- | --- | --- | --- |
| 消息历史 | `before` 序号加 `limit` | 1 到 500，默认 80；结果按序号升序 | 消息数组，无总数 |
| 管理端集合 | `limit` 加 `offset` | 上限 200，默认 50 | 含 `total`、`limit`、`offset` |
| 其余列表 | 无 | 各自硬上限：会话 500、邀请 200、日历 1000、搜索按桶固定、看板返回全量快照 | 数组或快照对象 |

幂等不设统一请求头，靠五个部分唯一索引加请求指纹收敛：

| 索引 | 覆盖 | 键 |
| --- | --- | --- |
| 消息客户端标识 | `messages` | 会话加作者加 `clientId`，仅非空 |
| 智能体创建 | `participants` | 租户加创建请求标识，仅智能体类型 |
| 看板创建 | `boards` | 租户加创建者加创建请求标识 |
| 文档创建 | `documents` | 租户加创建者加创建请求标识 |
| 日历事件创建 | `calendar_events` | 租户加创建者加创建请求标识 |

创建类请求标识为 1 到 128 字符，字符集限定字母、数字与 `._:-`；服务端对规范化请求体取哈希，先取事务级咨询锁再回查，因此并发的同标识请求会排队而不是双写。同标识同内容返回既有结果并标记回放；同标识不同内容返回 `409 REQUEST_ID_CONFLICT`，绝不覆盖。

客户端重试规则：

- 可重试：连接中断、超时、`5xx`、未就绪。重试必须复用同一请求标识，退避按指数加抖动，上限三次。
- 不可重试：`400`、`401`、`403`、`404`、`409` 且内容不同、`410`、`413`。这些状态重试只会放大错误。
- 读请求可无条件重试，但分页游标只在成功响应后推进；失败响应不得移动游标，否则会永久跳过一段消息。
- 传输层报错而服务端可能已提交时，先按标识回查再决定是否重发，不能直接重建一条新消息。

### 18.5 Limits and Runtime Contract

| 项 | 值 | 失败表现 |
| --- | --- | --- |
| 人类接口 JSON 体 | 256KB，上传路径例外为 34MB | `413`，超限不进入处理器 |
| 运行时 JSON 体 | 4MB，整文件写例外为 34MB | `413` |
| 入站邮件原始体 | 25MB | `413`，在验签前即拒绝 |
| 单文件上传 | 25MB | `413`，声明大小与实到字节同时校验 |
| 出站邮件 | 附件最多 16 个、合计 25MB | `400`，不进入发送队列 |
| 回合跳数 | 每智能体 200 跳 | 以失败终态收尾并附原因，不静默挂起 |
| 模型调用上报 | 每批 100 跳 | 超出被拒，客户端拆批 |
| 唤醒预算 | 低优先唤醒每进程每分钟 20 次；智能体驱动回合每智能体每滚动分钟 30 次 | 计入跳过，写一次性提示并退避 |
| 并发与超时 | 连接池 20、语句 60 秒、空闲事务 30 秒；缓存命令 2 秒、重试 1 次 | 可重试错误，不返回实现细节 |
| 长连缓冲 | 超过 2MB 丢帧，超过 8MB 断连 | 客户端重连后按游标补齐 |

现状是**没有 HTTP 限流中间件**：人类接口、运行时与入站邮件都不做按秒计数，节流只发生在唤醒与回合层。抗压依赖数据库超时与连接池，而不是入口限流；是否对运行时命令行与上传路径增加前置计数，标注待确认。

运行时接口遵循「只增不改」，因为守护进程与服务端同树发布、版本线一致，但总有落后一个版本的设备在线：

- 既有端点不得改变请求字段的含义、响应字段的类型与状态码；新增字段必须可选且可被旧守护进程忽略。
- 允许新增端点；删除端点或改变语义必须跨两个次版本，并在旧版本设备占比归零后执行。
- 未知字段忽略、未知枚举值降级到默认分支而不是崩溃；令牌声明只增不减，scope 取值不得复用。
- 守护进程版本落后最新发布超过一个次版本即标记为落后并提示升级，但服务端不因此拒绝请求。

### 18.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| API-01 | 用户不属于某房间 | 请求该房间的消息列表与历史 | 均返回 `404`，响应体不含"无权访问"字样，也不透露房间是否存在 |
| API-02 | 同一请求标识已成功创建过一次 | 用同标识同内容重放创建请求 | 返回既有对象并标记回放，库中只有一行，订阅者只收到一次变更 |
| API-03 | 请求体超过各自上限 | 上传 30MB 文件，并对运行时整文件写提交 40MB | 两者均返回 `413` 且字节未落库；未认证时先返回 `401` 且不读请求体 |
| API-04 | 智能体已迁移到另一台计算机 | 用迁移前签发的运行时令牌调用命令行 | 返回 `403` 并说明放置关系已变更或撤销；新令牌立即可用 |
| API-05 | 长连票已使用过一次 | 用同一票据再次建连 | 连接被以 `4401` 关闭，服务端不建立第二个会话 |
| API-06 | 入站邮件请求体被篡改一个字节 | 用原签名提交 | 返回 `401`，邮件不落库；secret 轮换后同一请求体同样被拒 |
