# @veren/im-wechat

基于腾讯 iLink 机器人协议的 `@veren/im` 微信 provider。

## 什么时候使用

当 DSH 宿主需要通过已授权的 `ilink_bot_id` 收发个人微信文字时使用。V1 刻意收窄：

- 仅二维码授权；
- 仅私聊（`conversationId = p2p:<userId>`）；
- 仅文字（不支持图片、文件、卡片、输入状态与群聊）；
- 不逆向微信客户端私有协议。

## 配置

```ts
export const Config = {
  botType: '3',
  baseUrl: 'https://ilinkai.weixin.qq.com/',
}
```

没有数据目录配置项。持久化状态走宿主的 `storageDomain` 服务；插件声明了该依赖，缺少时不会激活。

## 授权流程

1. `im_bind` 调用 `get_bot_qrcode`，把二维码图片写成本地临时 PNG
   （`<系统临时目录>/dsh-im-wechat-qr/<bindId>.png`）。图片是展示产物，不是持久化状态。
2. 工具返回 `bindId`、`status`、`challenge`、`qrPath`、`expiresAt`；远程二维码 URL 永不返回或记录。
3. provider 轮询 `get_qrcode_status` 直到 `confirmed`。
4. 确认后把账号状态写入 `im_wechat` 存储域，把 `bot_token` 存进 `ctx.credentials`；账号随即可被
   `im_link` 使用。

支持的状态：`wait`、`scaned`、`need_verifycode`、`confirmed`、`expired`、
`scaned_but_redirect`、`verify_code_blocked`、`binded_redirect`。

## 连接

- 首轮轮询前 `notifystart`，停止时 `notifystop`。
- `getupdates` 长轮询 35 秒；超时当作空批。
- 每批之后持久化游标（`get_updates_buf`）。
- 连续失败 3 次停止 runtime，退避 2s / 4s / 8s。
- `ret=-14` 表示登录失效：`IM_AUTH_REQUIRED`，runtime 停止。

## 消息

- 按 `message_id` 去重。
- `message_type === 2` 是机器人自身回显，直接忽略。
- 入站文字来自 `item_list[].text_item.text`。
- `context_token` 按账号+用户缓存在 `im_wechat` 存储域；单账号超过 200 条时裁掉最旧的。
  它不记录日志，也不由工具返回。
- 出站文字按 1,800 UTF-16 码元分段，且不切断代理对。

## 发送错误

| 条件 | 结果 |
|---|---|
| `sendmessage` 返回 `ret=-2` | `IM_SEND_REJECTED`，不重试 |
| 请求超时 | `IM_DELIVERY_UNCERTAIN` |
| 图片或文件内容 | `IM_UNSUPPORTED` |
| 前段成功、后段失败 | `IM_DELIVERY_UNCERTAIN` |

## 状态与 Secret

存储域 `im_wechat`（版本 1），走 profile 的默认后端：

```text
im_wechat.accounts(account_id, display_name, owner_id, base_url, cursor, seen)
im_wechat.contexts(account_id, user_id, token, updated_at)
```

- `accounts` 每个已授权账号一行：游标、去重环、显示名、owner 与 API base URL。
- `contexts` 是按用户的有上限 `context_token` 缓存。
- bot token 只保存在 `ctx.credentials`；不写入存储域、不记录日志、不由工具返回。
- 本地二维码 PNG 放在系统临时目录，不属于持久化状态。

没有迁移路径：旧的按账号 JSON 文件不再读取，现存微信账号需要用 `im_bind` 重新授权。

## 测试

`tests/wechat.spec.ts` 用 mock fetch 覆盖扫码绑定、长轮询、发送、分段、`context_token` 复用、
`-14`、`ret=-2`、去重、自身回显过滤，以及基于内存 store 的存储失败诊断。
`tests/storage.spec.ts` 挂载真实 JSON 存储栈，覆盖重开后持久化、接管遗留域与 context_token
裁剪。真实账号用例默认跳过，只有 `IM_WECHAT_REAL=1` 才执行。

## 命令

```bash
pnpm --filter @veren/im-wechat typecheck
pnpm --filter @veren/im-wechat test
pnpm --filter @veren/im-wechat build
```
