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
  botType: '3',
  baseUrl: 'https://ilinkai.weixin.qq.com/',
}
```

There is no data-directory setting. Durable state goes through the host's
`storageDomain` service; the plugin declares that dependency and does not
activate without it.

## Authorization flow

1. `im_bind` calls `get_bot_qrcode` and writes the QR image to a local temporary
   PNG (`<os-temp>/dsh-im-wechat-qr/<bindId>.png`). The image is a presentation
   artifact, not durable state.
2. The tool returns `bindId`, `status`, `challenge`, `qrPath`, and `expiresAt`.
   The remote QR URL is never returned or logged.
3. The provider polls `get_qrcode_status` until `confirmed`.
4. On confirmation it writes the account state to the `im_wechat` storage
   domain and stores `bot_token` in `ctx.credentials`; the account becomes
   available to `im_link`.

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
- `context_token` is cached per account and user in the `im_wechat` storage
  domain, with the oldest entries pruned past 200 per account. It is never
  logged or returned by a tool.
- Outbound text is split at 1,800 UTF-16 code units without cutting a surrogate
  pair.

## People and contacts

iLink V1 exposes no address-book endpoint. This provider calls only
`get_bot_qrcode`, `get_qrcode_status`, `getupdates`, `sendmessage`,
`notifystart`, and `notifystop`; there is no friend-list or contact-detail API,
so it cannot pull the WeChat contacts list. Inbound messages carry only
`from_user_id` plus content, with no nickname.

Consequence: the `@veren/im` people directory fills from messages actually
received and from direct conversations already in storage. Such a person starts
with the raw WeChat id as their display name and as a `wechat` contact. Real
names, remarks, and other contact methods must be recorded with
`im_person_save`. Only then can a request such as "send a WeChat message to
杨明明" resolve to an address. The directory is therefore a growing list of
people we have seen or recorded, never a complete copy of the WeChat address
book.

## Sending errors

| Condition | Result |
|---|---|
| `sendmessage` returns `ret=-2` | `IM_SEND_REJECTED`, no retry |
| request timeout | `IM_DELIVERY_UNCERTAIN` |
| image or file content | `IM_UNSUPPORTED` |
| later segment fails after an earlier one succeeded | `IM_DELIVERY_UNCERTAIN` |

## State and secrets

Storage domain `im_wechat`, version 1, on the profile's default backend:

```text
im_wechat.accounts(account_id, display_name, owner_id, base_url, cursor, seen)
im_wechat.contexts(account_id, user_id, token, updated_at)
```

- `accounts` holds one row per authorized account: cursor, deduplication ring,
  display name, owner, and API base URL.
- `contexts` is the bounded per-user `context_token` cache.
- The bot token lives only in `ctx.credentials`; it is never persisted in the
  domain, logged, or returned by a tool.
- The local QR PNG lives in the OS temporary directory and is not state.

There is no migration path: the previous per-account JSON files are not read, so
existing WeChat accounts must be authorized again with `im_bind`.

## Tests

`tests/wechat.spec.ts` mocks fetch and covers QR binding, long polling, sending,
segmentation, `context_token` reuse, `-14`, `ret=-2`, deduplication, own-echo
filtering, and storage failure diagnostics over an in-memory store.
`tests/storage.spec.ts` mounts the real JSON storage stack and covers persistence
across reopen, takeover of a leftover domain, and context-token pruning. The
real-account case is skipped unless `IM_WECHAT_REAL=1`.

## Commands

```bash
pnpm --filter @veren/im-wechat typecheck
pnpm --filter @veren/im-wechat test
pnpm --filter @veren/im-wechat build
```
