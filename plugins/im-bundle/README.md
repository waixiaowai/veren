# @veren/im-bundle

Instant messaging for a DSH host as one installable layer: the provider-neutral
IM core, the model-facing `im_*` tools, and the WeChat channel, wired in
dependency order by a single bundle patch.

面向 DSH 宿主的即时消息能力，一个安装层搞定：渠道无关的 IM 核心、面向模型的
`im_*` 工具与微信渠道，由一个组合包 patch 按依赖序接线。

## When to use / 什么时候使用

Use when a profile should be able to authorize an IM account, receive inbound
messages into DSH Sessions, and let an agent send on the user's behalf. It is a
configuration-only bundle: zero runtime code, three loader rows.

当 profile 需要授权 IM 账号、把入站消息接进 DSH 会话、并允许 agent 代用户发消息时使用。
这是纯配置组合包：零运行时代码，三行 loader 行。

## Members / 成员

| Row | Package | Provides |
|---|---|---|
| `im` | `@veren/im` | the `im` / `imRouter` / `imPeople` services: durable accounts, conversations, bindings, the people directory, stranger intake, active-binding routing |
| `im-wechat` | `@veren/im-wechat` | the WeChat iLink channel: QR authorization, long-poll inbound, segmented text send |
| `im-tool` | `@veren/im-tool` | the `im_*` model tools over accounts, people, and bindings |

`@veren/im-testkit` is deliberately not a member: it is a vitest library for
provider conformance tests, not a plugin, and must never enter the install
closure.
`@veren/im-testkit` 刻意不是成员：它是供渠道一致性测试用的 vitest 库而非插件，
绝不能进入安装闭包。

## Install / 安装

```bash
dsh plugin --profile web add @veren/im-bundle
```

After installing, restart the host and scan the QR code that `im_bind` produces
with the WeChat account to authorize. Authorization secrets live in the host
credential store; conversations, people, and bindings persist in the `im`
storage domain.
安装后重启宿主，用 `im_bind` 生成的二维码以微信扫码完成授权。授权凭据存宿主凭据库；
会话、人员与绑定持久化在 `im` 存储域。

## Data written on a real deployment / 真机部署会写什么

- `storages/im.json` — accounts, conversations, bindings, people, intake audit
- `storages/im_wechat.json` — WeChat channel state (cursor, contexts)
- the credential store — one record per authorized account (`im/k<hash>`)
- `%TEMP%\dsh-im-wechat-qr\` — transient QR PNGs, deleted at bind end
