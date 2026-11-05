# im 家族重设计映射（Cumora → DSH）

> 依据：`plugins/im/design/` 下的 Cumora 设计方案（16 模块完整产品，基线 `deepseek/yetone/cumora` 0.18.9），
> 加上工作区裁定（2026-11-04）：**存储用 dsh storage、注册 dsh tools、注册 dsh skill、
> agent 是 dsh preset、项目是 dsh 工作区、编写 dsh client**。
> 本文档记录把该方案翻译成 DSH 插件家族的每一个决定；设计文档与本文冲突时，**以设计文档为准，
> 以本文为映射依据**。

## 1. 概念映射表

| Cumora 概念 | DSH 落地 | 说明 |
| --- | --- | --- |
| companyId（工作区） | DSH 实例（固定 `personal` 种子） | 设计自己的数据字典就把单工作区种成 `personal`；单宿主单工作区，多租户/邀请/角色不移植 |
| 项目（projectId） | DSH 工作区（`workspaceRegistry`） | 记忆的 `project_id` 作用域即 DSH 工作区 id |
| 智能体（Persona + 引擎 + 模型） | DSH preset（`agents.create({meta: {agentPreset}})`） | 人格、模型、引擎全在 preset；`agent:<presetId>` 即参与者 id；合成 `agent:default` 无 preset，以部署人格应答 |
| 参与者（human/agent） | 名册投影，无独立表 | owner=`human:owner`、preset 智能体=`agent:<presetId>`、外部人=`human:<personId>`（people 目录行） |
| Conversation（房间/消息/序号/已读） | `@veren/im-conversation`（存储域 `im_conversation`） | 房间号 `conv:*`（内部）/`chan:<provider>:<account>:<会话>`（渠道背书，确定性） |
| Turn（运行记录/收件箱/终态） | `@veren/im-turn`（存储域 `im_turn`） | 一次唤醒 = 一行 run + 事件时间线；会话按「智能体×房间」键控 |
| Coordination（分流/闸门/预算） | `@veren/im-coordination`（存储域 `im_coordination`，只有水位持久） | 分流 v1 全确定性；写入闸门经 `post(gate)` 在房间写链内判定 |
| 数据库事务/外发箱 | dsh storage 域 + cordis 事件 | 「先落库后分发」：先写域表再 `ctx.emit`；推送只是加速，客户端拉取对账 |
| bash/set_turn_status 引擎工具 | DSH 会话自带工具循环 + `im_*` 工具（`ctx.tools.register`） | Cumora 的引擎工具模型不移植；模型的回合文本就是房间消息 |
| 技能目录 | DSH skill（`ctx.skills.registerProvider`，`im-collaboration`） | 教模型：回复契约、HELD 语义、安静纪律、记忆礼仪 |
| 4 个产品端 | DSH client（`@veren/im-ui` web 面板） | 会话/账号/人员/设置四页签——会话是入口，也是唯一的人类写入路径（`post`、`createRoom`）；桌面/移动/运营后台不移植 |
| Realtime 长连 | cordis 事件 + 面板 5s 轮询 + 增量拉取 | 事件类型：`im/message-observed` → `im/message-new` → `im/wake-request` → `im/run-updated` |
| Billing/Admin/Shipping/Email/Schedule/Document/Board | **不移植**（外围域，后续迭代） | 设计的 §9/§10/§12/§15/§16/§17 与 §11 的对应部分留作扩展点 |

## 2. 家族结构（10 包）

```
plugins/im/
  core          @veren/im               契约、参与者名册、记忆、渠道注册表（发 im/message-observed）、人员目录、采集、账号授权
  conversation  @veren/im-conversation  房间/成员/消息/序号/已读 + 渠道吸收（写入路径在每次新提交后发 im/message-new）
  coordination  @veren/im-coordination  确定性分流 + 低优先预算 + 水位 + 写入闸门（发 im/wake-request，唯一唤醒源）
  turn          @veren/im-turn          运行记录 + 收件箱 + 指纹 + 按智能体的 preset 会话 + 被拒循环 + 终态
  tool          @veren/im-tool          im_* 工具（经 conversation 写入 + coordination 闸门）+ 协作技能
  wechat        @veren/im-wechat        渠道：入站观察 → 注册表；出站：订阅 im/message-new 投递智能体房间消息
  hub           @veren/im-hub           渠道（CMS 云网关长轮询）：同上双向
  ui            @veren/im-ui            web 面板：会话（入口）/账号/人员/设置；挂载 im + imConv 两个远端命名空间
  testkit       @veren/im-testkit       假 provider + 契约套件 + 各域内存接缝假实现
../im-bundle    @veren/im-bundle        组合包：行序 = core → conversation → coordination → turn → wechat → tool → ui
```

版本：全家族统一 3.0.0-rc.3（契约与存储语义破坏 → MAJOR，走 rc 预发布；发布另走三环境流水线）。

## 3. 事实管线（一次人发言的完整链路）

```
渠道 provider.listen
  → ImRegistry 发 im/message-observed
  → [core] observeInbound（people 记账 + 云端上报）→ intake.handle（陌生人询问，确定性）
  → [conversation] 写入路径：确定性房间号 + 发送者入座 + clientId=messageId 幂等写入，新提交后
      发 im/message-new（渠道吸收、im_send 与 Web 输入区共用这一次宣告）
  → [coordination] Fanout.onMessageNew：60s 认领 → 按房间成员分流 → 预算 → 发 im/wake-request
      （已读不回者水位推进，稍后回合不再装载）
  → [turn] Runner.onWake（按智能体串行）：装载收件箱（水位之后的非自身消息）
      → 指纹查重 → ensure 会话（preset）→ prompt 信封（房间+名册+未读+回复契约）
      → 会话回合产出回复文本
      → conversation.post(input, coordination.gatePost(...))   ← 闸门在写链内判定
          HELD_FRESHNESS / HELD_VERBATIM → buildHoldPrompt 重试（≤3 轮）→ 放弃记 skipped(held-out)
      → 成功：markSeen → run completed
      → 发 im/run-updated
  → [wechat/hub] 订阅 im/message-new：渠道背书房间 + agent 作者 → provider.send 出站投递
```

## 4. 设计 §1.10 十条不变量的落地

| 不变量 | 落地 |
| --- | --- |
| 先落库后分发 | 会话域先写表后 emit；渠道出站失败只告警 |
| 序号独占 | 房间计数器行 + 进程内按房间写链（单宿主单写者） |
| 拒绝可行动 | HELD_* 错误 details 携带 ≤8 条未看消息与 attempts；turn 转成再提示 |
| 信号开放、权限关闭 | 水位缺失放行（freshness fail-open）；成员检查失败按不存在拒绝 |
| 凭据不出宿主 | 引擎=DSH 会话，天然不持服务端凭据 |
| 成本必记账 | v1 无台账（Billing 不移植）——记录为已知剪裁，不伪造 |
| 租户范围入查询 | 单工作区（personal），查询天然带界 |
| 跨租户即不存在 | 非成员写/读房间 → CONVERSATION_NOT_FOUND，不区分原因 |
| 证据不可自证 | Shipping 不移植 |
| 界面不发明状态 | 面板只读远端面事实；会话页打开即推进所有者的已读游标（服务端事实） |

## 5. v1 剪裁清单（明确不做 + 理由）

| 项 | 设计出处 | 处理 |
| --- | --- | --- |
| whisper/email 房间、attachment/poll 等消息类型 | §2 | 类型联合只收 `direct|group` / `text|system`；扩展点是类型层，不是新机制 |
| 廉价模型判断（triage 的 support-model） | §4.2 | v1 全确定性分流（私聊唤醒/点名路由/其余安静）；模型判断是配置化扩展点 |
| 会议（convene）、选举、认领租约 | §4 | 不移植（多智能体同房间仲裁已由闸门覆盖，会议是下一迭代） |
| 跳数/上下文水位预算 | §3.2 | DSH 会话自带循环与预算；回合层硬边界 = replyTimeoutMs |
| 用量/成本台账 | §3/§15 | 不移植，run 记录不含 usage 字段（不伪造数字） |
| Board/Schedule/Document/Email/Storage 附件 | §9-§14 | 不移植 |
| 宿主（托管沙箱/设备配对） | §8 | 引擎 = 本机 DSH 会话，三位置模型不移植 |

## 6. 迁移与兼容

- `im` 存储域**沿用且版本不动**（1）：accounts/conversations/people/addresses/intakes 全保；`messages`（旧队列行）与
  `bindings`、`conversation_sessions` 转休眠（定义保留，旧文件可开）；新增 `memories` 表（缺失表读空，旧文件不拒）。
- 新域：`im_conversation`（rooms/members/messages/counters/reads/client_ids）、`im_coordination`（watermarks）、
  `im_turn`（runs/run_events/agent_sessions）。旧数据无需迁移——房间时间线是新事实，渠道账号与人员目录无缝延续。
- **队列语义被取代**：入站持久性 = 渠道消息 id 作为 clientId 的幂等写入（重投即回放）；「处理中崩溃」=
  水位滞后 + 下次唤醒收件箱补读（设计 §3.6：回合不可重放，恢复靠收件箱）。旧 `im_messages` 死信/重试机制删除。
- `autoCreateSession` 配置删除；替代物 = 渠道房间固定座席（`@veren/im-conversation` 的 `channelAgentPreset` 配置）
  + coordination 分流策略。`replyTimeoutMs` 移到 `@veren/im-turn`。
- 兼容风险：`@veren/im` 不再导出 `ImRouter/ImMessageQueue/ImSessionGateway/ImPromptSource`——im-tool/wechat/hub/ui
  已随本次重设计同步改写。

## 7. 与设计文档的差异裁定记录

| 差异 | 理由 |
| --- | --- |
| `companyId` → 固定 `personal`，不建 workspace 表 | 单宿主产品；设计自身的种子约定支持此形态（data.md 21.1） |
| 参与者不入库（投影而非表） | preset 在宿主、人在 people 目录，落表必然漂移（影子副本禁令） |
| 逐字闸门在 preflight + post(gate) 双面呈现 | 设计要求写事务内比对；PostGate 在房间写链内运行，等价原子 |
| 面板查看者固定 `human:owner` | 单用户宿主；多成员是 Workspace 域的事，不移植 |
