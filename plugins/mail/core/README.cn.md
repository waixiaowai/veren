# @veren/mail

作为 DSH 插件的通知领域：把一次业务事件变成真正送达的消息，并留下每次触发的可审计轨迹。

`@veren/mail-bundle` 技术栈的一部分。先读[组合包 README](../bundle/README.cn.md) 了解一行安装；
本文是核心包自身的契约。

## 它拥有什么

- **持久化领域**——工作流、收件人、分组、偏好层、渠道集成、执行链、步骤实例、已投递消息
  与会话，全部存放在宿主存储域（`mail`，`per-record` 布局）下的 `$DSH_HOME/storages`。
- **投递链路**——trigger → dispatch → deliver。触发被同步校验并受理；其步骤经内部队列推进，
  采用原子领取（`queued → running` 的比较并交换）、30 秒租约，以及每步至多三次、指数退避的重试。
- **两个渠道提供方**——站内收件箱（`in_app`，常驻，无外呼）与 SMTP（`email`，配置启用）。
  消息记录在调用提供方之前写入，提供方回执必须回写。
- **`mail` 远端命名空间**——Web 面板读取的入口。

## 刻意的边界

- 已受理的触发不等于已投递的消息：受理状态与链路事实是两个不同的事实，工具刻意把它们分开。
- 被跳过的步骤是决策，不是失败：每次跳过都指明拦下它的那次判定（`step_condition`、
  `preference`、`missing_email`、`missing_phone`、`missing_push_token`、`missing_webhook_url`）。
- 偏好按五个固定层合并——工作流、运营者、收件人全局、收件人工作流、订阅——被标记只读的层
  是截断合并而非被忽略。
- 每个失败都带稳定的 `MAIL_*` 错误码，可重试性内建于码本身。
- 服务：`mailService`（注入 `MailServiceToken`）。网关：`mailGateway`，位于 `mail` 命名空间。

## 安装

安装 `@veren/mail-bundle`；它按正确顺序组合核心、工具与面板。手动组合时插入一行 loader 行：

```yaml
- insert:
    - id: mail
      name: '@veren/mail'
      config:
        enabled: true
        # smtp:                      # 可选；打开邮件渠道
        #   host: smtp.example.com
        #   port: 587
        #   secure: false
        #   from: no-reply@example.com
```

## 配置

| 字段 | 含义 |
| --- | --- |
| `enabled` | 挂载开关；`false` 时不注册任何东西 |
| `smtp` | 可选邮件服务器（host、port、secure、from、user、password）；缺省时站内收件箱是唯一渠道 |

## 开发

```bash
pnpm --dir plugins/mail/core typecheck   # 对 src 与 tests 跑 tsc
pnpm --dir plugins/mail/core test        # vitest，内存存储，无需宿主
pnpm --dir plugins/mail/core build       # tsc -> dist/
```
