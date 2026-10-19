# @veren/im-tool

Model-facing `im_*` tools over `@veren/im`.

## When to use it

Use this package when an agent must authorize IM accounts, bind conversations to
DSH Sessions, send messages, or inspect IM state. It contains no channel code and
no storage; it only reads `ctx.im` (provider metadata) and `ctx.imRouter` (the
active-binding router).

## Tools

| Tool | Purpose |
|---|---|
| `im_bind` | Start an account authorization, or poll an existing attempt by `bindId` |
| `im_link` | Bind or switch one conversation to a Session |
| `im_unbind` | Remove one binding, or remove an account and its credential |
| `im_send` | Send one content block to an explicit target |
| `im_settings` | Change a binding's preset/provider/model/reasoning |
| `im_list` | Read accounts, bindings, or conversations |

## Result contract

Every tool returns one JSON object. Success starts with `ok: true`; failure is a
value, not a thrown string:

```json
{ "ok": false, "error": { "code": "IM_INVALID_REQUEST", "message": "..." } }
```

Stable codes: `IM_INVALID_REQUEST`, `IM_UNSUPPORTED`, `IM_AUTH_REQUIRED`,
`IM_BIND_PENDING`, `IM_BIND_EXPIRED`, `IM_NOT_FOUND`, `IM_SEND_REJECTED`,
`IM_RATE_LIMITED`, `IM_DELIVERY_UNCERTAIN`, `IM_INTERNAL`.

## Authorization is not conversation binding

- `im_bind` starts or polls an authorization attempt. It never creates a
  binding, and it never guesses a Session.
- `im_link` creates or switches a binding. It never starts a QR flow.
- `im_bind` requires exactly one of `method` or `bindId`.

A QR result carries `bindId`, `status`, `challenge`, `qrPath`, and `expiresAt`.
The remote QR URL is never returned; only the local PNG path is.

## Sending needs an explicit target

`im_send` accepts either `bindingId` or `accountId` + `conversationId`, never
both and never neither. It never falls back to the current active binding.

```json
{ "ok": true, "messageId": "im-wechat-...", "sentAt": 1760000000000 }
```

## Configuration

```ts
export const Config = {
  enabled: true,
}
```

Set `enabled: false` to mount the plugin without registering tools.

## Commands

```bash
pnpm --filter @veren/im-tool typecheck
pnpm --filter @veren/im-tool build
```
