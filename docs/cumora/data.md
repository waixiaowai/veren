---
title: 数据字典
description: "逐表给出关键字段、类型、可空性、默认值与含义，并把唯一索引与检查约束翻译成它们承担的业务语义。"
sidebar:
  order: 21
  label: 21 数据字典
draft: false
lastUpdated: 2026-11-04
---

## 21. Data Dictionary

本章是接口章与各模块章的公共底座：字段名、类型、可空性与默认值以这里为准，任何实现都不得另起别名。分组与 [总体方案与架构](./architecture/) 的数据归属表一致，每组第一张表是写方，其余是它的从属事实。"必填"指列是否允许为空，"默认或范围"写默认值与取值约束；唯一索引与检查约束集中在 21.9 说明业务语义。同一张表里语义相邻的次要列合并成一行，主键、租户列、时间列、状态列与唯一约束列一律单列。

### 21.1 Identity and Tenancy

身份与租户决定"谁在哪个工作区里行动"，因此每张表都带租户列，或从属于带租户列的行。

| 表 | 字段 | 类型 | 必填 | 默认或范围 | 含义 |
| --- | --- | --- | --- | --- | --- |
| users | id | TEXT | 是 | 主键 | 全局用户标识 |
| users | email | TEXT | 是 | 唯一，按小写建索引 | 登录与通知地址 |
| users | display_name、tier | TEXT | 是 | 展示名 1 到 80 字符；档位 free、pro、max | 展示名与档位，档位决定额度与能否建托管宿主 |
| users | sub2api_api_key | TEXT | 否 | 不回显 | 网关密钥，当前明文存储，见待确认 |
| users | suspended_at、deleted_at | TIMESTAMPTZ | 否 | 空表示正常 | 停用与软删时间，任一是非空即拒绝新会话 |
| users | created_at | TIMESTAMPTZ | 是 | 默认当前时间 | 注册时间 |
| companies | id | TEXT | 是 | 主键，固定种子行 personal | 工作区标识 |
| companies | name、slug | TEXT | 是 | slug 唯一，最长 63 字符 | 展示名与别名，别名用于邀请地址与邮箱反解 |
| companies | owner_user_id、pair_token | TEXT | 否 | 所有者历史可为空；配对码部分唯一 | 所有者与设备配对码，轮换配对码不影响已配对设备 |
| companies | created_at、updated_at | TIMESTAMPTZ | 是 | 默认当前时间 | 创建与更新时间 |
| company_members | company_id、user_id | TEXT | 是 | 复合主键，级联删除 | 租户列与成员，权限判定的真值 |
| company_members | role、joined_at | TEXT、TIMESTAMPTZ | 是 | owner、admin、member；默认当前时间 | 角色与加入时间，角色决定权限矩阵的列 |
| company_invitations | token_hash | TEXT | 是 | 主键，sha256 | 邀请标识，原值只在创建响应出现一次 |
| company_invitations | company_id、email | TEXT | 是 | 租户列；email 小写可空，空表示链接邀请 | 归属与定向收件地址 |
| company_invitations | max_uses、use_count | INTEGER | 是 | 默认 1 与 0 | 可用次数与已用次数，用尽即失效 |
| company_invitations | expires_at、revoked_at | TIMESTAMPTZ | 是 | 默认 7 天后；撤销时间可空 | 过期与撤销，任一成立即不可用 |
| sessions | token_hash、user_id | TEXT | 是 | 主键；外键级联删除 | 会话凭据指纹与归属 |
| sessions | expires_at | TIMESTAMPTZ | 是 | 30 天硬过期，14 天无活动即过期 | 过期判定以这一列为准 |
| ws_tickets | token_hash | TEXT | 是 | 主键，sha256 | 连接票据指纹，单次消费 |
| ws_tickets | user_id、expires_at、used_at | TEXT、TIMESTAMPTZ | 是 | 60 秒有效；已用时间可空 | 归属、过期与已用，已用即拒绝重放 |
| user_identities | provider、provider_id | TEXT | 是 | 两者组成唯一键 | 身份提供方与提供方侧标识 |
| user_identities | user_id、created_at | TEXT、TIMESTAMPTZ | 是 | 外键；默认当前时间 | 关联本地用户，凭已验证邮箱自动关联 |
| user_preferences | user_id、key、value | TEXT、TEXT、JSONB | 是 | 前两者组成主键 | 偏好键值，列形状待确认 |

本节留了两处待确认：网关密钥以明文列存于用户行，只保证不回显，是否改为加密列或引用外部密钥尚未定；偏好表以键值对形式存在，键的清单还没有收敛成闭集，落地前需要与端侧对齐。

### 21.2 Conversation

会话是团队事实的唯一来源：消息序号、成员真值、已读游标都在这里，其他模块只读。

| 表 | 字段 | 类型 | 必填 | 默认或范围 | 含义 |
| --- | --- | --- | --- | --- | --- |
| conversations | id、company_id | TEXT | 是 | 主键；租户列 | 房间标识与所属工作区，所有查询必须带租户 |
| conversations | kind、title | TEXT | 是 | group、direct、whisper、email；标题最长 80 字符 | 类型决定可见性与是否豁免新鲜度闸门 |
| conversations | members、project_id | JSONB、TEXT | 是 | 成员为有序投影数组；项目外键可空 | 列表投影与项目归属，投影不是权限依据 |
| conversations | created_at、updated_at | TIMESTAMPTZ | 是 | 默认当前时间 | 创建与最后活动时间 |
| conversation_members | conversation_id、participant_id | TEXT | 是 | 复合主键 | 成员真值，权限判定的唯一依据 |
| conversation_members | ordinal、joined_at | INTEGER、TIMESTAMPTZ | 是 | 非负；默认当前时间 | 名册顺序与加入时间，重复加入幂等 |
| messages | id | TEXT | 是 | 主键 | 消息标识 |
| messages | conversation_id、company_id | TEXT | 是 | 外键级联删除；租户列 | 房间与租户，读路径按房与序号建索引 |
| messages | author_id、kind | TEXT | 是 | 参与者标识；八种类型 | 作者与类型，类型决定渲染与默认视图 |
| messages | body、sequence | TEXT、INTEGER | 是 | 正文上限 8 万字符；序号由计数器分配 | 正文与房内严格递增游标，跨房不承诺顺序 |
| messages | client_id | TEXT | 否 | 1 到 80 字符，非空时参与唯一索引 | 幂等键，重复提交靠它收敛 |
| messages | created_at | TIMESTAMPTZ | 是 | 默认当前时间 | 写入时间 |
| conversation_counters | conversation_id、next_sequence | TEXT、INTEGER | 是 | 主键；默认 1，只增不减 | 一房一行，写序号时加锁 |
| conversation_reads | conversation_id、participant_id、last_read_sequence | TEXT、INTEGER | 是 | 复合主键；默认 0，只允许前进 | 已读游标，未读计数由它推导 |
| conversation_mutes | conversation_id、participant_id、muted_until | TEXT、TIMESTAMPTZ | 是 | 复合主键；空表示永久静音 | 静音窗口，只影响投递不影响已读 |
| message_reactions | message_id、participant_id、emoji | TEXT | 是 | 三者组成主键 | 反应，一人一表情一条 |
| poll_votes | message_id、voter_participant_id、option_id | TEXT | 是 | 三者组成主键；选项形如 opt- 加 8 位十六进制 | 票，改票即先删后插 |
| poll_votes | company_id、created_at | TEXT、TIMESTAMPTZ | 是 | 租户列；默认当前时间 | 归属与投票时间 |

### 21.3 Agent

智能体的身份、记忆、运行记录与自我状态都在这里。运行记录与调用台账是排障与计费的共同账本，只追加。

| 表 | 字段 | 类型 | 必填 | 默认或范围 | 含义 |
| --- | --- | --- | --- | --- | --- |
| participants | id、company_id | TEXT | 是 | 复合主键 | 参与者标识与租户列，同一标识可在多租户各存一行 |
| participants | kind、name | TEXT | 是 | human 或 agent；名字按租户唯一 | 类型与展示名，提及解析按名字匹配 |
| participants | engine、computer_id | TEXT | 否 | managed 与自带引擎；宿主外键 | 执行引擎与归属宿主，一个智能体同时只属于一台 |
| participants | email | TEXT | 否 | 按小写唯一，首次触达时铸造 | 真实邮箱地址，邮箱反解依赖它 |
| participants | departed_at、status_updated_at | TIMESTAMPTZ | 否 | 空表示在职 | 离职软删与状态刷新时间，行保留以维持历史可读 |
| agent_runs | id | TEXT | 是 | 形如 run- 加 uuid | 一次唤醒一行 |
| agent_runs | company_id、agent_id | TEXT | 是 | 租户列；参与者标识 | 归属工作区与执行者 |
| agent_runs | status、stage | TEXT | 是 | running、completed、failed、skipped；阶段名 | 状态机见第 20 章，阶段用于回放进度 |
| agent_runs | fingerprint、inbox_count | TEXT、INTEGER | 否 | 收件箱指纹；收件箱条数 | 防重复回合的耐久依据 |
| agent_runs | cost_usd、started_at | DOUBLE PRECISION、TIMESTAMPTZ | 是 | 默认 0，单位美元；默认当前时间 | 估算成本与保留清理的依据 |
| agent_runs | finished_at、error | TIMESTAMPTZ、TEXT | 否 | 空表示未收敛 | 终态时间与失败原因，失败必有原因 |
| agent_events | id、run_id | TEXT | 是 | 主键；外键级联删除 | 事件标识与所属运行 |
| agent_events | kind、data、created_at | TEXT、JSONB、TIMESTAMPTZ | 是 | 约 40 个字符串常量，无中心枚举；载荷单串截断 24000 字符 | 阶段、载荷与时间，回放按它排序 |
| agent_triages | id、agent_id | TEXT | 是 | 主键；参与者标识 | 一次廉价判断一行 |
| agent_triages | actionable、run_id | BOOLEAN、TEXT | 是 | 默认 false；空表示判定后未启动回合 | 判定结果与它唤醒的运行 |
| agent_workspace | agent_id、path | TEXT | 是 | 复合主键；拒绝绝对路径与点点段 | 工作区文件的行式存储，memory 前缀带作用域元数据 |
| agent_workspace | body、embedding | TEXT、VECTOR | 是 | 文件内容；1536 维向量 | 内容与记忆向量，用于语义检索 |
| agent_climate | agent_id、about_id、affinity | TEXT、DOUBLE PRECISION | 是 | 前两者组复合主键；写入时按上下界截断 | 亲疏评分，影响主动开口 |
| agent_tasks | id、agent_id、status、due_at | TEXT、TIMESTAMPTZ | 是 | 主键；open、doing、done、dropped；截止可空 | 智能体私有任务，不进入看板 |
| agent_log | id、agent_id、kind、created_at | TEXT、TIMESTAMPTZ | 是 | 主键；reply、tool、status、note 等类别 | 自述日志，只追加，空闲调度写 note |
| tool_calls | id、message_id、agent_id | TEXT | 是 | 主键；消息外键可空 | 一次工具调用与它产生的消息 |
| tool_calls | name、status、error | TEXT | 是 | 工具名；pending、ok、error | 调用结果，失败必须带原因 |
| convene_sessions | id、conversation_id、state | TEXT | 是 | 形如 cs- 加 uuid；外键；live 或 ended | 一次多智能体会议与它的状态 |
| convene_transcript | id、session_id、kind | TEXT | 是 | 形如 ct- 加 uuid；外键；text、thought、tool、decision | 会内发言，顺序由写入事务决定 |
| agent_routing_claims | message_id、agent_id、status | TEXT | 是 | 主键；pending、served、exhausted | 一条消息只允许一个副本负责选举 |

### 21.4 Host

宿主是可撤销的设备凭据。云端宿主每个工作区一行且由工作区 id 推导，自带宿主由配对产生。

| 表 | 字段 | 类型 | 必填 | 默认或范围 | 含义 |
| --- | --- | --- | --- | --- | --- |
| computers | id | TEXT | 是 | 云端为 cloud- 加工作区 id | 设备标识，由工作区推导所以天然幂等 |
| computers | company_id | TEXT | 是 | 租户列 | 所属工作区 |
| computers | kind、status | TEXT | 是 | cloud、local、vps；online、offline、busy | 执行位置与在线状态，状态由心跳推导 |
| computers | available_engines | JSONB | 是 | 有序数组，首项为默认引擎 | 可用引擎清单，不静默重排 |
| computers | last_seen_at、credential_hash | TIMESTAMPTZ、TEXT | 是 | 心跳写入，超过 90 秒判离线；sha256 | 在线判定依据与设备令牌指纹 |
| computers | revoked_at | TIMESTAMPTZ | 否 | 空表示有效 | 撤销即拒绝该设备与全部派生令牌 |

### 21.5 Work Surfaces

看板、日程、文档与邮件是四个共享工作面，共享同一份成员与权限，也共享同一条"先落库再分发"的写入协议。

| 表 | 字段 | 类型 | 必填 | 默认或范围 | 含义 |
| --- | --- | --- | --- | --- | --- |
| boards | id、company_id | TEXT | 是 | 形如 board- 加 12 位十六进制；租户列 | 看板标识与所属工作区 |
| boards | title、creation_request_id | TEXT | 是 | 标题上限 200 字符；请求标识 1 到 128 字符且按租户与创建者唯一 | 标题与幂等键，重放返回既有看板 |
| boards | created_at、updated_at | TIMESTAMPTZ | 是 | 默认当前时间 | 创建与最后活动时间 |
| board_columns | id、board_id | TEXT | 是 | 形如 col- 加 12 位十六进制；外键级联删除 | 列标识与所属看板 |
| board_columns | title、position、kind | TEXT、DOUBLE PRECISION | 是 | 标题 100 字符；建板时 1000 起递增；todo、doing、done 或空 | 列标题、顺序与语义，语义决定卡片能否推进 |
| board_cards | id、board_id、column_id | TEXT | 是 | 形如 card- 加 12 位十六进制；列必须属于同一看板 | 卡片与所在列，跨板写入即拒绝 |
| board_cards | title、description、position | TEXT、DOUBLE PRECISION | 是 | 200 与 8000 字符；浮点排序，允许插值 | 标题、描述与顺序 |
| board_cards | assignee_id、due_on | TEXT、DATE | 否 | 参与者标识；严格年月日，不带时间 | 负责人与截止日，指派即视为一次提及 |
| board_cards | mentions、created_at | JSONB、TIMESTAMPTZ | 是 | 写入时解析好的被提及者；默认当前时间 | 提及与创建时间 |
| board_card_comments | id、card_id、author_id | TEXT | 是 | 形如 cmt- 加 12 位十六进制；外键 | 评论与作者，只有作者可删自己的评论 |
| board_card_comments | body、mentions、created_at | TEXT、JSONB、TIMESTAMPTZ | 是 | 正文上限 8000 字符 | 评论正文、提及与时间 |
| calendar_events | id、company_id | TEXT | 是 | 主键；租户列 | 事件与所属工作区 |
| calendar_events | kind、title、description | TEXT | 是 | personal 或 agent_task；描述上限 4000 字符 | 类型决定只提醒还是可派发给智能体 |
| calendar_events | start_at、end_at、all_day | TIMESTAMPTZ、BOOLEAN | 是 | 必须早于结束时间；按 UTC 计算 | 起止与全天标记，当前无事件时区字段 |
| calendar_events | recurrence、status | JSONB、TEXT | 是 | 频率、间隔、星期、终止条件；active、paused、done、cancelled | 重复规则与状态，只有 active 参与扫描 |
| calendar_events | assignee_id、target_conversation_id | TEXT | 否 | 参与者标识；目标会话外键 | 被派发者与目标会话，缺失即跳过并记录 |
| calendar_dispatches | id、event_id、scheduled_for | TEXT、TIMESTAMPTZ | 是 | 主键；与事件组成唯一槽位 | 一次派发尝试与它的槽位，重复插入即去重 |
| calendar_dispatches | status、message_id、error | TEXT | 是 | dispatched、skipped、failed、duplicate；消息可空 | 派发结果与失败原因 |
| calendar_reminders | id、event_id、scheduled_for | TEXT、TIMESTAMPTZ | 是 | 主键；槽位取事件开始时间而非触发时刻 | 一次提醒尝试，唯一槽位防重复打扰 |
| calendar_reminders | channel、recipients、status | TEXT、JSONB | 是 | toast、email、both；sent 或 failed | 通道、收件人与结果 |
| documents | id、company_id | TEXT | 是 | 主键；租户列 | 文档与所属工作区 |
| documents | title、conversation_id | TEXT | 是 | 标题可空则取首行；会话外键置空 | 标题与关联会话，删会话不删文档 |
| documents | creation_request_id、updated_at | TEXT、TIMESTAMPTZ | 否 | 幂等键按租户与创建者唯一；默认当前时间 | 幂等创建与最后写入时间 |
| document_updates | id、document_id | BIGSERIAL、TEXT | 是 | 自增；外键级联删除 | 增量序号与所属文档，追加顺序即唯一顺序 |
| document_updates | update_bytes、created_at | BYTEA、TIMESTAMPTZ | 是 | 单条上限按运行体限制；默认当前时间 | 增量二进制与写入时间 |
| document_snapshots | document_id、state_bytes、snapshot_at_update_id | TEXT、BYTEA、BIGINT | 是 | 主键，一文档一行；覆盖到的增量序号 | 最新快照，重连时从它与后续增量重建 |
| document_mentions | id、document_id、mentioned_id、created_at | TEXT、TIMESTAMPTZ | 是 | 主键；被提及者 60 秒内去重 | 提及记录，兼作审计 |
| email_messages | message_id | TEXT | 是 | 主键，外键指向消息 | 一封邮件对应一条消息 |
| email_messages | conversation_id、company_id | TEXT | 是 | 外键级联删除；租户列 | 所属会话与工作区 |
| email_messages | direction、transport_status | TEXT | 是 | in 或 out；queued、sending、sent、failed、received | 方向与传输状态，状态机见第 20 章 |
| email_messages | smtp_message_id、in_reply_to | TEXT | 否 | 按小写唯一；单值引用 | 线程归属与去重的键 |
| email_messages | next_retry_at、transport_error | TIMESTAMPTZ、TEXT | 否 | 空表示终态 | 重试时间与失败原因，认领即推后 5 分钟 |
| email_contacts | company_id、address、last_seen_at | TEXT、TIMESTAMPTZ | 是 | 前两者组成主键；地址小写 | 外部往来地址与最近往来时间 |
| email_attachments | id、message_id、company_id | TEXT | 是 | 主键；外键；租户列 | 附件元数据，字节共用而元数据每租户一行 |
| email_attachments | storage_key、truncated | TEXT、BOOLEAN | 是 | 对象键可空，空即只留元数据；默认 false | 对象键与截断标记，超限时字节不入库 |

### 21.6 Delivery and Cost

投递与成本是两条只追加的账：一条记"该送什么"，一条记"花了多少"。

| 表 | 字段 | 类型 | 必填 | 默认或范围 | 含义 |
| --- | --- | --- | --- | --- | --- |
| realtime_outbox | id、channel | TEXT | 是 | 主键；17 个固定通道之一 | 外发记录与投递通道 |
| realtime_outbox | attempts、available_at | INTEGER、TIMESTAMPTZ | 是 | 默认 0，超限标记丢弃；下次可投递时间 | 已尝试次数与可重投时间 |
| realtime_outbox | published_at、discarded_at | TIMESTAMPTZ | 否 | 空表示待投递或未丢弃 | 投递成功与丢弃时间，丢弃靠拉取对账补偿 |
| push_devices | id、user_id | TEXT | 是 | 主键；外键级联删除 | 设备注册行与归属用户 |
| push_devices | platform、token、disabled_at | TEXT、TIMESTAMPTZ | 是 | 平台与令牌全局唯一；停用时间可空 | 平台、令牌与停用，换账号登录会抢走该行重绑 |
| llm_calls | id、company_id、agent_id | TEXT | 是 | 主键；租户列；参与者标识 | 一次出网模型调用与计费归属 |
| llm_calls | run_id、purpose | TEXT | 否 | 所属运行可空；13 个用途常量 | 关联运行与调用用途，区分大模型与小模型 |
| llm_calls | model、source | TEXT | 是 | 模型 id；云端或自带执行 | 模型与来源，自带执行不计入本表 |
| llm_calls | input_tokens、output_tokens | INTEGER | 是 | 默认 0，缓存读与缓存写另列 | 用量，是成本核算的唯一输入 |
| llm_calls | cost_usd、status | DOUBLE PRECISION、TEXT | 是 | 默认 0，单位美元；ok、rate_limited、timeout、failed | 成本与结果，估算时另记标记 |
| llm_calls_rollup | bucket_hour、company_id、agent_id | TIMESTAMPTZ、TEXT | 是 | 整点；六列唯一且空值视为相同 | 汇总粒度，按小时预聚合以支撑看板 |
| llm_calls_rollup | purpose、model、source | TEXT | 是 | 与桶键同形 | 汇总维度，与明细保持同一枚举 |
| llm_calls_rollup | calls、cost_usd | INTEGER、DOUBLE PRECISION | 是 | 默认 0 | 次数与成本，重算而非累加，刷新两次金额不变 |
| audit_events | id、user_id、company_id | BIGSERIAL、TEXT | 是 | 自增；用户与租户可空 | 审计序号与主体，无租户上下文时为空 |
| audit_events | kind、created_at | TEXT、TIMESTAMPTZ | 是 | 登录、登出、建工作区等；默认当前时间 | 事件类型与时间，按租户做隔离查询 |
| app_settings | key、value、updated_at | TEXT、JSONB、TIMESTAMPTZ | 是 | 主键；预置候补与暂停注册两项 | 平台开关，改写需审计 |

### 21.7 Shipping

交付证据链的七张表，只追加与状态推进，不允许就地改历史。

| 表 | 字段 | 类型 | 必填 | 默认或范围 | 含义 |
| --- | --- | --- | --- | --- | --- |
| shipping_features | id、company_id | TEXT | 是 | 主键；租户列 | 功能标识与所属工作区 |
| shipping_features | title、problem、desired_outcome | TEXT | 是 | 契约三要素，进入契约状态前必须非空 | 标题、问题与期望结果 |
| shipping_features | status、priority、risk_level | TEXT | 是 | 十个状态；critical 到 low 四级 | 状态由服务端状态机写，优先级与风险决定排序 |
| shipping_features | builder_ids | JSONB | 是 | 参与者标识数组，改名单会同步到每个方块 | 建造者名单，是自证检查的比对来源 |
| shipping_features | archived_at、updated_at | TIMESTAMPTZ | 否 | 归档时间可空；默认当前时间 | 归档后整行不可变 |
| shipping_invariants | id、feature_id | TEXT | 是 | 主键；外键级联删除 | 不变量与所属功能 |
| shipping_invariants | kind、required、position | TEXT、BOOLEAN | 是 | 行为、架构、数据、安全、性能、体验、可运维；默认必需 | 类别、是否必需与排序，必需项未过即卡住就绪 |
| shipping_verifications | id、feature_id、invariant_id | TEXT | 是 | 主键；外键 | 证据方块与它证明的不变量 |
| shipping_verifications | method、status | TEXT | 是 | 用户路径、性质、轨迹、对账、设计评审、安全、性能、发布说明；pending 到 waived | 取证方式与判定结果 |
| shipping_verifications | owner_id、verified_by_id | TEXT | 否 | 后者不得属于建造者名单 | 负责人与验证者，检查约束保证不自证 |
| shipping_verifications | evidence、completed_at | JSONB、TIMESTAMPTZ | 否 | 通过或失败时必填；豁免需写说明 | 证据载荷与完成时间 |
| shipping_releases | id、feature_id | TEXT | 是 | 主键；外键 | 发布单与所属功能 |
| shipping_releases | environment、status | TEXT | 是 | development、staging、canary、production；planned 到 rolled_back | 环境决定批准门槛，状态见第 20 章 |
| shipping_releases | approved_by、started_at | TEXT、TIMESTAMPTZ | 否 | 空表示未批准或未执行 | 批准人与执行时间 |
| shipping_releases | readback_due_at、readback_status | TIMESTAMPTZ、TEXT | 否 | 生产成功后加 24 小时；pending、passed、failed、overdue | 回读到期与回读时钟，超期由维护任务翻转 |
| shipping_releases | rollback_reason、rolled_back_at | TEXT、TIMESTAMPTZ | 否 | 回滚时必填原因 | 回滚原因与时间，回滚后功能退回建造 |
| shipping_friction_reports | id、company_id、feature_id | TEXT | 是 | 主键；租户列；功能外键可空 | 摩擦报告与归属，功能删除时置空 |
| shipping_friction_reports | source、source_key、severity | TEXT | 否 | 手工、验证、生产回读、智能体观测；去重键按租户唯一 | 来源、去重键与严重级 |
| shipping_friction_reports | status、occurrence_count | TEXT、INTEGER | 是 | open 到 dismissed 五态；默认 1 | 处理状态与出现次数，重复上报只加计数 |
| shipping_regressions | id、feature_id、source_verification_id | TEXT | 是 | 主键；来源方块唯一 | 回归资产与它的来源，一个失败方块一条 |
| shipping_regressions | kind、status、last_run_at | TEXT、TIMESTAMPTZ | 是 | 自动、基准、人工重放、监控；active 到 disabled | 类别、状态与最近一次运行时间 |
| shipping_events | id、company_id、feature_id | TEXT | 是 | 主键；租户列；外键级联删除 | 交付动作的审计行，只追加不改不删 |

### 21.8 Identifiers and Conventions

标识带前缀，是为了让日志、URL 与截图里的人一眼看出这是哪类对象；约定一旦发布就不再更改。

| 前缀 | 归属 | 形态 | 说明 |
| --- | --- | --- | --- |
| run- | 运行记录 | run- 加 uuid | 一次唤醒一个 |
| evt- | 运行事件 | evt- 加 uuid | 回放按它排序 |
| cs- | 会议 | cs- 加 uuid | 一次多智能体会议 |
| ct- | 会议发言 | ct- 加 uuid | 会内顺序由写入事务决定 |
| board- | 看板 | board- 加 12 位十六进制 | 短、可读、便于粘贴 |
| col- | 看板列 | col- 加 12 位十六进制 | 与看板同形 |
| card- | 卡片 | card- 加 12 位十六进制 | 与看板同形 |
| cmt- | 卡片评论 | cmt- 加 12 位十六进制 | 与看板同形 |
| opt- | 投票选项 | opt- 加 8 位十六进制 | 只在一条投票内唯一 |
| cloud- | 托管宿主 | cloud- 加工作区 id | 由工作区推导，天然幂等 |
| external: | 外部发件人 | external: 加地址 | 合成身份，不进入成员表 |
| attachments/ | 聊天附件 | attachments/ 加 32 位十六进制加点扩展名 | 读取需签名与授权 |
| email-attachments/ | 邮件附件 | email-attachments/ 加 uuid 加点扩展名 | 字节共用，元数据每租户一行 |
| avatars/ | 头像 | avatars/avatar- 加标识加随机后缀 | 唯一免签前缀 |

其余约定：

- **时间一律带时区**。列类型只用带时区的类型，日历的展开与槽位计算全部按 UTC；`due_on` 是日历日，不带时间也不带提醒。
- **金额单位是美元**。成本以浮点列存，价格表按每百万 token 计；汇总只做重算不做累加，避免重复刷新放大金额。
- **令牌只存哈希**。会话、连接票据、邀请、设备凭据都存 sha256，原值只在创建响应里出现一次；任何列表与日志都不得回显原值。
- **软删与硬删的边界**。身份与成员软删以保留历史可读性；会话与消息随房间硬删级联；只追加的账本既不软删也不硬删，只按保留期清理。

| 删除方式 | 适用表 | 行为 | 读方看到什么 |
| --- | --- | --- | --- |
| 软删 | users、participants、shipping_features | 写时间列，行保留 | 默认查询过滤，历史引用仍能解析出名字 |
| 硬删级联 | conversations、messages、documents | 随父行级联删除 | 一律按不存在处理，不回显"已删除" |
| 只追加 | agent_events、shipping_events、audit_events | 不允许更新与删除 | 完整可回放，保留期由运维策略决定 |
| 到期清理 | 运行记录、事件、调用台账、连接票据 | 按保留期批量删除 | 观测面出现空洞，业务面不受影响 |

### 21.9 Invariants

唯一索引与检查约束不是性能附属品，它们各自承担一条业务语义。删掉任何一条，都会让某个"看起来只是重复"的事故重新出现。

| 约束 | 形态 | 承担的业务语义 |
| --- | --- | --- |
| uniq_messages_client_id | 会话、作者、客户端标识三列部分唯一 | 重复提交收敛为一条消息，重试不产生第二条 |
| conversation_counters 主键 | 一房一行 | 序号只有一个写者，跨副本不会给出同一个号 |
| conversation_members 复合主键 | 房间加参与者 | 成员是真值，重复加入幂等，投影可重建 |
| participants 复合主键 | 标识加租户 | 同一标识可在多租户各存一行，强制每条查询带租户 |
| uniq_participants_email | 按小写邮箱部分唯一 | 邮箱地址唯一，并发铸地址只成功一次 |
| 创建类请求唯一键（看板、文档、日程同形） | 租户加创建者加请求标识 | 弱网重试不会建出第二块同名看板或第二份文档 |
| uniq_calendar_dispatch_slot | 事件加槽位 | 一个槽位只派发一次，重跑调度不会重复唤醒 |
| uniq_calendar_reminders_slot | 事件加槽位 | 一个槽位只提醒一次，多副本不重复打扰 |
| uniq_email_messages_smtp_id | 按小写邮件标识唯一 | 同一封邮件只入库一次，线程归属稳定 |
| 令牌表主键 | 哈希即主键 | 凭据不可枚举，重放与碰撞在同一处被拒 |
| companies.slug 唯一 | 单列唯一 | 邀请地址与邮箱反解不歧义 |
| shipping_verifier_not_builder | 检查约束 | 证据不可自证，建造者不能给自己的方块判定通过 |
| shipping_regressions 的来源唯一 | 源方块唯一 | 一个失败方块只对应一条可重放回归 |
| 摩擦报告租户加来源键唯一 | 部分唯一 | 重复出现只累加次数，不刷屏 |
| llm 汇总键 | 六列唯一且空值视为相同 | 重算而非累加，刷新两次金额不变 |
| attachment_grants 复合主键 | 对象键加租户 | 附件归属明确，跨租户引用无法借道 |
| poll_votes 复合主键 | 消息加投票人加选项 | 一人一项一票，改票即替换而非追加 |

### 21.10 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| D-01 | 任意两个模块的读写实现 | 对照本章核对同一实体的字段名、类型与可空性 | 无别名、无类型漂移；时间列全部带时区，金额列全部为美元浮点 |
| D-02 | 一条已成功写入的消息 | 用同一客户端标识重复提交同一内容，再换内容提交一次 | 第一次返回既有行且不新增，第二次返回幂等冲突；看板、文档、日程的创建请求同理 |
| D-03 | 两个工作区各有同名资源 | 用工作区甲的会话令牌访问工作区乙的标识 | 返回不存在，日志里的内部码为跨租户；任何按标识查询的语句都带租户条件 |
| D-04 | 一条已软删的成员与一条已硬删的会话 | 分别读取历史消息与成员名册 | 软删成员的引用仍能解析出展示名但不可再被提及；硬删会话一律按不存在处理 |
