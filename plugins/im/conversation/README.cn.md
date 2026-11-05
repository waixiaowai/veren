# @veren/im-conversation

重设计后的 im 家族的会话域：持久的房间、成员、消息、房间独占序号与只进不退的已读游标
——团队「发生过什么」的唯一事实来源。

## 何时使用

当 im 家族需要一个所有后续阶段都要读的事实存储时使用本包：渠道观察在这里变成持久的
房间消息，协调闸门在这里（房间写链内）判定，面板经 `imConv` 远端命名空间读取房间与
时间线。不要在这里加唤醒策略、仲裁或会话逻辑——它们在 `@veren/im-coordination` 与
`@veren/im-turn`。

## 它拥有什么

- `im_conversation` 存储域：rooms、room members、messages、按房间计数器、已读游标与
  clientId 幂等索引。
- `ConversationService`（`imConversation` 令牌）：post（按 client id 幂等、可带闸门）、
  list、lastPeerMessage、markRead、unread、房间与成员读取，以及 addMembers（群聊追加
  成员；私聊拒绝，因为它的两个座位就是房间本身）。
- 渠道吸收：确定性的 `chan:<provider>:<account>:<conversation>` 房间号、发送者入座、
  provider 重投即幂等回放。
- `imConv` 远端命名空间：rooms、roomMembers、messages、post、createRoom、addMembers、
  markRead。

## 事件

- 每次新提交后发 `im/message-new`（回放保持沉默）。
- 房间投影变化时发 `im/room-updated`。
- 消费来自 `@veren/im` 的 `im/message-observed`。

## 配置

- `channelAgentPreset` —— 其智能体应答渠道房间的 preset；缺省时由合成的
  `agent:default` 以部署人格应答。
