# @veren/im-tool

基于 `@veren/im` 的面向模型 `im_*` 工具。

## 什么时候使用

当 agent 需要授权 IM 账号、把会话绑定到 DSH Session、发送消息或查看 IM 状态时使用。本包不含渠道代码，
也不直接持有存储；它只读取 `ctx.im`（provider 元数据）与 `ctx.imRouter`（active-binding 路由）。

## 工具

| 工具 | 作用 |
|---|---|
| `im_bind` | 发起账号授权，或按 `bindId` 轮询已有尝试 |
| `im_link` | 绑定/切换会话到 Session |
| `im_unbind` | 删除一条绑定，或移除账号及其凭据 |
| `im_send` | 向显式 target 发送一个内容块 |
| `im_settings` | 修改 binding 的 preset/provider/model/reasoning |
| `im_list` | 读取 accounts、bindings 或 conversations |

## 返回契约

每个工具都返回一个 JSON 对象。成功以 `ok: true` 开头；失败是值，不是抛出的字符串：

```json
{ "ok": false, "error": { "code": "IM_INVALID_REQUEST", "message": "..." } }
```

稳定错误码：`IM_INVALID_REQUEST`、`IM_UNSUPPORTED`、`IM_AUTH_REQUIRED`、
`IM_BIND_PENDING`、`IM_BIND_EXPIRED`、`IM_NOT_FOUND`、`IM_SEND_REJECTED`、
`IM_RATE_LIMITED`、`IM_DELIVERY_UNCERTAIN`、`IM_INTERNAL`。

## 授权不是会话绑定

- `im_bind` 只发起或轮询授权尝试，绝不创建 binding，也绝不猜 Session。
- `im_link` 只创建/切换 binding，绝不发起扫码流程。
- `im_bind` 的 `method` 与 `bindId` 必须二选一。

二维码结果包含 `bindId`、`status`、`challenge`、`qrPath`、`expiresAt`。
远程二维码 URL 永不返回，只返回本地 PNG 路径。

## 发送必须显式指定 target

`im_send` 只接受 `bindingId` 或 `accountId` + `conversationId`，不能同时给，也不能都不给。
它绝不回退到当前 active binding。

```json
{ "ok": true, "messageId": "im-wechat-...", "sentAt": 1760000000000 }
```

## 配置

```ts
export const Config = {
  enabled: true,
}
```

`enabled: false` 表示挂载插件但不注册工具。

## 命令

```bash
pnpm --filter @veren/im-tool typecheck
pnpm --filter @veren/im-tool build
```
