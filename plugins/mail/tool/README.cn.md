# @veren/mail-tool

通知技术栈面向模型的那一面：`mail_*` 工具加内置的 `mail-notifications` 技能。

挂载在 `@veren/mail` 之上，不拥有任何域逻辑——每个工具都是一次服务调用的薄投影。

## 工具清单

- tool: `mail_send` — 按触发标识发起一次工作流；答案是「已受理」而非「已投递」
- tool: `mail_workflows` — 列出可发送的工作流，含各工作流的状态与步骤
- tool: `mail_activity` — 读取执行链，含每步的状态与跳过原因
- tool: `mail_subscribers` — 列出收件人及其可达渠道
- tool: `mail_set_subscriber` — 创建或更新一个收件人；只写指名的字段
- tool: `mail_groups` — 列出分组及其成员
- tool: `mail_set_group` — 按不可变键创建或重命名分组
- tool: `mail_subscribe` — 增删一个分组成员
- tool: `mail_inbox` — 读取站内收件箱，最新在前
- tool: `mail_mark_message` — 标记一条收件箱消息已读/未读/已归档
- tool: `mail_conversations` — 列出通知会话
- tool: `mail_conversation_messages` — 按顺序读取一条会话

## 技能

- skill: `mail-notifications` — 通知何时是正确手段、一类通知一条工作流、「已受理」与「已投递」
  之别、跳过原因的含义，以及幂等规则

## 安装

作为 `@veren/mail-bundle` 的一部分挂载。配置：

| 字段 | 含义 |
| --- | --- |
| `enabled` | 是否注册 `mail_*` 工具（默认 `true`） |
| `skill` | 是否注册内置技能（默认 `true`） |

## 开发

```bash
pnpm --dir plugins/mail/tool typecheck
pnpm --dir plugins/mail/tool test
pnpm --dir plugins/mail/tool build
```
