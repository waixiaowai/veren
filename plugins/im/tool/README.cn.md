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
| `im_send` | 向人、binding 或显式 account + conversation 发送一个内容块 |
| `im_people` | 列出或搜索人员目录（档案加可达地址） |
| `im_person_save` | 创建或补充人员，可选挂接一个地址，或清除错误的自述 |
| `im_intake` | 读取自动陌生人询问的开关、计数与最近审计记录 |
| `im_settings` | 修改 binding 的 preset/provider/model/reasoning |
| `im_list` | 读取 accounts、bindings 或 conversations |

## 返回契约

每个工具都返回一个 JSON 对象。成功以 `ok: true` 开头；失败是值，不是抛出的字符串：

```json
{ "ok": false, "error": { "code": "IM_INVALID_REQUEST", "message": "..." } }
```

稳定错误码：`IM_INVALID_REQUEST`、`IM_UNSUPPORTED`、`IM_AUTH_REQUIRED`、
`IM_BIND_PENDING`、`IM_BIND_EXPIRED`、`IM_NOT_FOUND`、`IM_AMBIGUOUS`、
`IM_NO_ADDRESS`、`IM_SEND_REJECTED`、`IM_RATE_LIMITED`、`IM_DELIVERY_UNCERTAIN`、
`IM_INTERNAL`。

失败可以携带机器可读的 `error.details`：重名时是 `candidates`，查无此人时是
`suggestions`，`IM_NO_ADDRESS` 时是人员与地址。

## 授权不是会话绑定

- `im_bind` 只发起或轮询授权尝试，绝不创建 binding，也绝不猜 Session。
- `im_link` 只创建/切换 binding，绝不发起扫码流程。
- `im_bind` 的 `method` 与 `bindId` 必须二选一。

二维码结果包含 `bindId`、`status`、`challenge`、`qrPath`、`expiresAt`。
远程二维码 URL 永不返回，只返回本地 PNG 路径。

## 发送必须显式指定 target

`im_send` 只接受一种 target 形式：`person`、`bindingId`，或 `accountId` + `conversationId`。
它绝不回退到当前 active binding。带 `person` 时，`provider` 与 `accountId` 只用于收窄地址。

```json
{ "ok": true, "messageId": "im-wechat-...", "sentAt": 1760000000000 }
```

按人发送成功时还会带上模型必须展示给用户的依据：

```json
{
  "ok": true,
  "delivered": true,
  "messageId": "im-wechat-...",
  "sentAt": 1760000000000,
  "recipient": {
    "personId": "person_...",
    "displayName": "明明",
    "matchedBy": "realName",
    "matchedValue": "杨明明",
    "identityStatus": "verified",
    "provider": "wechat",
    "accountId": "acc-1",
    "conversationId": "p2p:wxid-yang"
  }
}
```

`matchedBy` 取值：`id`、`realName`、`displayName`、`alias`、`contact`、`address`、
`claimedName`、`claimedContact`。`identityStatus` 取值：`verified`、`self-reported`、
`unverified`。

## 自报身份不是已核实身份

自动陌生人询问收到回答后，`im_people` 会显示 `claimedName` / `claimedContacts` /
`claimedAt`，并带 `identityStatus: "self-reported"`。这只是对方自己的说法，绝不能当成已核实
`realName` 展示；人要提升或纠正它，走 `im_person_save`。自述名可以作为发送键
（`matchedBy: "claimedName"`），但与其他人重名时仍然是 `IM_AMBIGUOUS`，一条都不发。
`im_intake` 返回开关状态、实际发出的确切文案，以及发给了谁、什么时候发的。

## 按名字发送是失败关闭的

模型不确定名字时应先调用 `im_people`。

- 唯一精确匹配：发出。
- `IM_AMBIGUOUS`：不发送；`error.details.candidates` 列出匹配（最多 20 个）。模型必须问用户选谁，绝不自己挑。
- `IM_NOT_FOUND`：不发送；`error.details.suggestions` 列出相近名字。模型必须明说找不到，并给出候选。
- `IM_NO_ADDRESS`：人存在，但在所选 provider/account 上没有可达地址；不发送。

`im_person_save` 用来记录渠道给不出的身份信息。创建人员必须给地址（`accountId` +
`conversationId`）；更新用 `personId`。地址已属于另一个人时会被拒绝，而不是被静默改挂。

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
