# @veren/im-bundle

面向 DSH 宿主的多智能体协作工作区，一个安装层搞定：渠道中立核心、会话 / 协调 / 回合三个
域、带协作技能的面向模型 `im_*` 工具、微信渠道与 Web 面板，由一个组合包 patch 按
事实管线顺序接线。

## 什么时候使用

当 profile 需要承载一个人与智能体共享同一条消息流的工作区时使用：渠道观察沉淀为持久
房间、确定性分流决定谁被唤醒、写入闸门保证两个智能体不会说同一句话、运行是可回放的
记录，面板呈现会话。

这是纯配置组合包：零运行时代码，七行 loader 行。

## 成员

| 行 | 包 | 提供 |
|---|---|---|
| `im` | `@veren/im` | `im` / `imPeople` / `imParticipants` / `imMemory` / `imBindings` / `imDirectory` / `imIntake` 服务；发出 `im/message-observed` |
| `im-conversation` | `@veren/im-conversation` | `imConversation` 服务：房间、序号、已读游标、渠道吸收；发出 `im/message-new`；拥有 `imConv` 远端命名空间 |
| `im-coordination` | `@veren/im-coordination` | `imCoordination` 服务：分流、预算、水位、写入闸门；发出 `im/wake-request`（唯一唤醒源） |
| `im-turn` | `@veren/im-turn` | `imTurn` 服务：运行记录、按智能体的 preset 会话、被拒循环 |
| `im-wechat` | `@veren/im-wechat` | 微信 iLink 渠道：扫码授权、长轮询入站、智能体房间消息的出站投递 |
| `im-tool` | `@veren/im-tool` | 面向模型的 `im_*` 工具 + `im-collaboration` 技能 |
| `im-ui` | `@veren/im-ui` | Web 面板：会话 / 云端 / 采集 |

`@veren/im-hub`（CMS 云网关渠道）与 `@veren/im-testkit` 刻意不是成员：hub 是面向 CMS
部署的可选替代渠道；testkit 是 vitest 库，绝不能进入安装闭包。

## 安装

```bash
dsh plugin --profile web add @veren/im-bundle
```

安装后重启宿主，打开面板，用微信扫码完成授权。授权凭据存宿主凭据库；房间、消息、水位与
运行记录持久化在 `im` / `im_conversation` / `im_coordination` / `im_turn` 存储域。
完整 Cumora→DSH 映射见 `plugins/im/docs/redesign-mapping.{cn,}.md`。

## 真机部署会写什么

- `storages/im.json` —— 账号、渠道会话、人员、采集审计、记忆
- `storages/im_conversation.json` —— 房间、成员、消息、计数器、已读游标
- `storages/im_coordination.json` —— 已见水位
- `storages/im_turn.json` —— 运行记录、运行事件、智能体会话映射
- `storages/im_wechat.json` —— 微信渠道状态（游标、上下文）
- 凭据库 —— 每只授权账号一条记录（`im/k<hash>`）
- `%TEMP%\dsh-im-wechat-qr\` —— 临时二维码 PNG，绑定结束即删
