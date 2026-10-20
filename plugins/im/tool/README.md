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
| `im_send` | Send one content block to a person, a binding, or an explicit account + conversation |
| `im_people` | List or search the people directory (profile plus reachable addresses) |
| `im_person_save` | Create or enrich a person, optionally attach an address, clear a bad self-report |
| `im_intake` | Read the automatic stranger-intake switch, counts, and recent audit records |
| `im_settings` | Change a binding's preset/provider/model/reasoning |
| `im_list` | Read accounts, bindings, or conversations |

## Result contract

Every tool returns one JSON object. Success starts with `ok: true`; failure is a
value, not a thrown string:

```json
{ "ok": false, "error": { "code": "IM_INVALID_REQUEST", "message": "..." } }
```

Stable codes: `IM_INVALID_REQUEST`, `IM_UNSUPPORTED`, `IM_AUTH_REQUIRED`,
`IM_BIND_PENDING`, `IM_BIND_EXPIRED`, `IM_NOT_FOUND`, `IM_AMBIGUOUS`,
`IM_NO_ADDRESS`, `IM_SEND_REJECTED`, `IM_RATE_LIMITED`,
`IM_DELIVERY_UNCERTAIN`, `IM_INTERNAL`.

Failures may carry `error.details` with machine-readable evidence: `candidates`
for an ambiguous name, `suggestions` for a not-found name, or the person and
addresses for `IM_NO_ADDRESS`.

## Authorization is not conversation binding

- `im_bind` starts or polls an authorization attempt. It never creates a
  binding, and it never guesses a Session.
- `im_link` creates or switches a binding. It never starts a QR flow.
- `im_bind` requires exactly one of `method` or `bindId`.

A QR result carries `bindId`, `status`, `challenge`, `qrPath`, and `expiresAt`.
The remote QR URL is never returned; only the local PNG path is.

## Sending needs an explicit target

`im_send` accepts exactly one target form: `person`, `bindingId`, or `accountId`
+ `conversationId`. It never falls back to the current active binding. With
`person`, `provider` and `accountId` only narrow the reachable address.

```json
{ "ok": true, "messageId": "im-wechat-...", "sentAt": 1760000000000 }
```

A person-targeted success also carries the evidence the model must show the
user:

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

`matchedBy` is one of `id`, `realName`, `displayName`, `alias`, `contact`,
`address`, `claimedName`, or `claimedContact`. `identityStatus` is `verified`,
`self-reported`, or `unverified`.

## Self-reported identity is not verified identity

`im_people` shows `claimedName` / `claimedContacts` / `claimedAt` with
`identityStatus: "self-reported"` when the automatic stranger question collected
an answer. That is the person's own statement. It must never be presented as a
verified `realName`, and `im_person_save` is how a human promotes or corrects it.
A claimed name works as a send key (`matchedBy: "claimedName"`), but a collision
with another person is still `IM_AMBIGUOUS` and sends nothing. `im_intake`
returns the switch state and the exact question that was sent, plus who received
it and when.

## Sending by name is fail-closed

The model should call `im_people` first when it does not know the exact name.

- Unique exact match: the message is sent.
- `IM_AMBIGUOUS`: nothing is sent; `error.details.candidates` lists the matches
  (at most 20). The model must ask the user which one, never pick one.
- `IM_NOT_FOUND`: nothing is sent; `error.details.suggestions` lists close
  names. The model must say it could not find the person and offer the
  suggestions.
- `IM_NO_ADDRESS`: the person exists but has no reachable address for the chosen
  provider/account; nothing is sent.

`im_person_save` records the identity data a channel cannot supply. Creating a
person requires an address (`accountId` + `conversationId`); updating uses
`personId`. An address already owned by another person is rejected instead of
being reassigned.

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
