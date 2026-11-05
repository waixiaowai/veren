# @veren/im

重设计后的 im 家族的渠道中立核心：渠道契约与注册表、参与者名册、智能体记忆、人员目录、
陌生人采集与账号授权——事实管线的入口。

## 何时使用

当一个 DSH 宿主需要把同一个 IM 抽象暴露给多个渠道时使用本包：每个 provider 注册一个
`ImProvider`，每条入站观察都以一次 `im/message-observed` 事件离开，下游各域
（`@veren/im-conversation`、`@veren/im-coordination`、`@veren/im-turn`）把这些观察变成
持久事实、唤醒决策与回复。

不要在这里加渠道特判——渠道属于它自己的 provider 包（本仓库的 `@veren/im-wechat`）。
也不要在这里加唤醒策略——自 3.0 重设计起，核心不带路由、不带队列、不带会话代码。

## 家族组成

完整 Cumora→DSH 映射见家族根目录的 `docs/redesign-mapping.cn.md`。家族：

| 包 | 职责 |
|---|---|
| `@veren/im` | 契约、`ImRegistry`、`ImError`、名册、记忆、人员、采集、账号 |
| `@veren/im-conversation` | 房间、序号、已读游标、渠道吸收 |
| `@veren/im-coordination` | 分流、预算、水位、写入闸门 |
| `@veren/im-turn` | 运行记录、按智能体的 preset 会话、被拒循环 |
| `@veren/im-tool` | 面向模型的 `im_*` 工具 + 协作技能 |
| `@veren/im-wechat` | 微信 iLink provider |
| `@veren/im-hub` | CMS 云网关 provider |
| `@veren/im-ui` | Web 面板（会话 / 云端 / 采集） |
| `@veren/im-testkit` | 假 provider 与可复用测试接缝 |

## 契约

契约是唯一事实来源：

- `ImProvider` / `ImService`：每个渠道实现的六个操作（`start`、`stop`、`accounts`、
  `listen`、`bind`、`send`、可选 `removeAccount`）。
- `ImRegistry`（`im` 令牌）：带对账触发点的注册、`observeInbound`（人员记账 + 云端上报）、
  云端目录挂接。
- `ImError`：两段式稳定码——渠道范围的 `IM_*` 与设计的核心循环码
  （`CONVERSATION_NOT_FOUND`、`HELD_*`、`TURN_*`…），外加按码的 `retryable` 判定。
- `ImParticipants`（`imParticipants` 令牌）：名册。智能体就是 DSH preset
  （`agent:<presetId>`）、所有者是 `human:owner`、外部人来自人员目录。
- `ImMemory`（`imMemory` 令牌）：持久智能体记忆，召回置顶优先、其余按近期，按项目
  （DSH 工作区）作用域。
- `ImPeople` / `ImDirectory`：严格名字解析、未核实自述的人员目录，可手工新建暂无地址的联系人，
  删除联系人时连带地址与采集记录；以及面向模型的目录面。
- `ImStrangerIntake`（`imIntake` 令牌）：每人一次的陌生人询问，带限频与审计。
- `ImBindings`（`imBindings` 令牌）：账号授权尝试与持久账号表。
- 渠道房间号：`chan:<provider>:<account>:<conversation>`（确定性、跨重启稳定），内部房间
  用 `conv:*`。

## 事件

- 发出 `im/message-observed` —— 每条渠道观察恰好一次。
- 不消费任何事件。

## 配置

- `ownerName` —— prompt 与名册中所有者人类的展示名。
- `roster` —— 本工作区的 preset 智能体。
- `strangerIntake` —— 自动陌生人询问（开关、回复窗口、每小时上限、最小间隔）。
