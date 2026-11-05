# @veren/im-turn

重设计后的 im 家族的回复引擎：一次唤醒变成一次可回放的运行——收件箱装载、按智能体的
preset 会话、在写入时刻判定的协调闸门、带再提示的被拒循环，以及永远带着原因的终态。

## 何时使用

当 im 家族需要「思考与回复」这一阶段时使用本包：消费 `im/wake-request`，装载智能体还没
看到的内容，经它自己的会话思考，穿闸门写入，并记录一切（`im_turn` 域里的运行行与事件
时间线）。不要在这里决定谁被唤醒——那是 `@veren/im-coordination` 的事；不要在这里注册
模型工具——那是 `@veren/im-tool` 的事。

## 它拥有什么

- 持久运行记录（`im_turn` 域）：设计四态（running/completed/failed/skipped）的 `run-*`
  行、只追加的事件时间线，以及吸收重复唤醒的输入指纹。
- 会话筹备：每个智能体 × 房间一个 DSH 会话，重启后恢复；参与者指名 preset 时携带
  `meta.agentPreset`。默认智能体的会话以部署人格运行；模型/provider 缺省来自
  `agentDefaultModel`。
- Prompt 信封：房间、名册（人类在前）、未读消息与回复契约（模型的回合文本就是房间消息；
  保持安静是正当选择）。
- 被拒循环：HELD_FRESHNESS/HELD_VERBATIM 拒绝变成携带未看到事实的再提示，最多三轮，之后
  运行落为 `skipped(held-out)`。
- 失败分类：模型限流与额度耗尽落为 `skipped` 并带每房间每原因一条的去重系统提示（六小时
  窗口）；其余落为 `failed` 并带原因。
- `TurnService`（`imTurn` 令牌）：运行清单、事件时间线、`sessionPlaceOf(sessionId)`
  ——模型工具把调用者归属到某个智能体参与者与房间所用的反查——以及运行中回合的实时活动。
- 实时活动（`ActivityBoard` + `imTurn` 远端命名空间）：运行期间，本板报告它的阶段（思考 /
  调用工具 / 撰写回复）、正在运行的工具名，以及流式推理的末尾。它由 `session/event` 与
  `agent/assistant-stream` 喂养，绝不持久化，并在运行落定或停止更新时丢弃条目（崩溃的运行
  绝不能留下一条永久工作行）。聊天面板轮询 `imTurn.activity`；回复本身仍是末尾写入的一条
  消息。

## 事件

- 消费来自 `@veren/im-coordination` 的 `im/wake-request`。
- 每次运行转变时发 `im/run-updated`。
- 为实时活动读取 `session/event` 与（全局的）`agent/assistant-stream`；两者都不改运行记录。

## 配置

- `replyTimeoutMs` —— 单次会话回合的硬边界（默认 120 秒）。
