# @veren/im-wechat

WeChat provider for `@veren/im`, built on the Tencent iLink bot protocol.

## When to use it

Use it when a DSH host must read and send personal WeChat text through an
authorized `ilink_bot_id`. V1 is intentionally narrow:

- QR authorization only;
- private conversations only (`conversationId = p2p:<userId>`);
- text only (no images, files, cards, typing, or group messages);
- no reverse engineering of the WeChat client protocol.

## Configuration

```ts
export const Config = {
  dataDir: '',                                  // default `<DSH_HOME>/im/wechat`
  botType: '3',
  baseUrl: 'https://ilinkai.weixin.qq.com/',
}
```

`dataDir` is the plugin's own state root. A missing value resolves through
`DSH_HOME`, so no code writes `~/.dsh` directly.

## Authorization flow

1. `im_bind` calls `get_bot_qrcode` and writes the QR image to
   `<dataDir>/qr/<bindId>.png`.
2. The tool returns `bindId`, `status`, `challenge`, `qrPath`, and `expiresAt`.
   The remote QR URL is never returned or logged.
3. The provider polls `get_qrcode_status` until `confirmed`.
4. On confirmation it writes the account state and stores `bot_token` in
   `ctx.credentials`; the account becomes available to `im_link`.

Supported statuses: `wait`, `scaned`, `need_verifycode`, `confirmed`, `expired`,
`scaned_but_redirect`, `verify_code_blocked`, `binded_redirect`.

## Connection

- `notifystart` before the first poll, `notifystop` on stop.
- `getupdates` long-polls for 35 seconds; a timeout is treated as an empty batch.
- The cursor (`get_updates_buf`) is persisted after every batch.
- Three consecutive failures stop the runtime, with 2s / 4s / 8s backoff.
- `ret=-14` means the login is stale: `IM_AUTH_REQUIRED`, runtime stops.

## Messages

- Deduplication is by `message_id`.
- `message_type === 2` is the bot's own echo and is ignored.
- Inbound text comes from `item_list[].text_item.text`.
- `context_token` is cached per account and user inside the credential record; it
  is never written to `state.json`, logged, or returned by a tool.
- Outbound text is split at 1,800 UTF-16 code units without cutting a surrogate
  pair.

## Sending errors

| Condition | Result |
|---|---|
| `sendmessage` returns `ret=-2` | `IM_SEND_REJECTED`, no retry |
| request timeout | `IM_DELIVERY_UNCERTAIN` |
| image or file content | `IM_UNSUPPORTED` |
| later segment fails after an earlier one succeeded | `IM_DELIVERY_UNCERTAIN` |

## State and secrets

```text
<dataDir>/<accountId>/state.json   account id, display name, owner, base URL,
                                   cursor, deduplication ring
<dataDir>/qr/<bindId>.png          local QR image
ctx.credentials                    bot token and context_token cache
```

`state.json` is written with a temp file plus rename, mode `0600`. It contains
no token and no `context_token`.

## Tests

`tests/wechat.spec.ts` mocks fetch and covers QR binding, long polling, sending,
segmentation, `context_token` reuse, `-14`, `ret=-2`, deduplication, and own-echo
filtering. The real-account case is skipped unless `IM_WECHAT_REAL=1`.

## Commands

```bash
pnpm --filter @veren/im-wechat typecheck
pnpm --filter @veren/im-wechat test
pnpm --filter @veren/im-wechat build
```
