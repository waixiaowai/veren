# @veren/im-bundle

面向 DSH 宿主的即时消息能力，一个安装层搞定：渠道无关的 IM 核心、面向模型的
`im_*` 工具与微信渠道，由一个组合包 patch 按依赖序接线。

## 什么时候使用

当 profile 需要授权 IM 账号、把入站消息接进 DSH 会话、并允许 agent 代用户发消息时使用。
这是纯配置组合包：零运行时代码，三行 loader 行。

## 成员

| 行 | 包 | 提供 |
|---|---|---|
| `im` | `@veren/im` | `im` / `imRouter` / `imPeople` 三个服务：持久化的账号、会话、绑定，人员目录，陌生人采集，active-binding 路由 |
| `im-wechat` | `@veren/im-wechat` | 微信 iLink 渠道：扫码授权、长轮询入站、分段文本发送 |
| `im-tool` | `@veren/im-tool` | 面向模型的 `im_*` 工具（账号、人员、绑定） |

`@veren/im-testkit` 刻意不是成员：它是供渠道一致性测试用的 vitest 库而非插件，
绝不能进入安装闭包。

## 安装

```bash
dsh plugin --profile web add @veren/im-bundle
```

安装后重启宿主，用 `im_bind` 生成的二维码以微信扫码完成授权。授权凭据存宿主凭据库；
会话、人员与绑定持久化在 `im` 存储域。

## 真机部署会写什么

- `storages/im.json` — 账号、会话、绑定、人员、采集审计
- `storages/im_wechat.json` — 微信渠道状态（游标、上下文）
- 凭据库 — 每个已授权账号一条记录（`im/k<hash>`）
- `%TEMP%\dsh-im-wechat-qr\` — 临时二维码 PNG，绑定时结束后即删
