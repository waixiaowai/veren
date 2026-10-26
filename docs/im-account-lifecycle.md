# IM Account Lifecycle: WeChat Bots, Owners, and Invariants

> Audience: developers working on `@veren/im` / `@veren/im-wechat`.
> 中文版：[im-account-lifecycle.cn.md](./im-account-lifecycle.cn.md)。

This document records what the iLink protocol has actually been observed to do,
the state machine the durable tables implement, the invariants every code path
must preserve, and the verification protocol that decides whether a change is
correct. Evidence beats assumption: every claim below points at where it can be
re-checked.

## 1. Protocol facts (observed, not assumed)

Observed against `https://ilinkai.weixin.qq.com/` (client: `@veren/im-wechat`, 2026-10):

| Endpoint | Auth | Observed behavior |
| --- | --- | --- |
| `POST ilink/bot/get_bot_qrcode?bot_type=3` | none | Mints a fresh QR challenge. The body carries `local_token_list: []` — a slot that suggests presenting existing tokens (a possible re-bind/reuse path, **not yet exercised**). |
| `GET ilink/bot/get_qrcode_status?qrcode=…` | none (long poll) | Returns `wait` / `scaned` / `need_verifycode` / `confirmed` / `expired` / `verify_code_blocked` / `binded_redirect`. On `confirmed` the payload carries `bot_token`, `ilink_bot_id`, `ilink_user_id`, optional `baseurl`. |
| `POST ilink/bot/getupdates` | `Authorization: Bearer <bot_token>` | Cursor long poll. `ret=-14` means the login is stale — **this is the server's verdict that a token is dead**. |
| `POST ilink/bot/sendmessage` | Bearer | `ret=-2` covers both a stale context token and frequency control. |
| `POST ilink/bot/msg/notifystart` / `notifystop` | Bearer | Notification stream control; `-14` on stop is treated as done. |

Live evidence produced by the plugin:

- Each QR authorization observed so far mints a **new** `ilink_bot_id`; the same
  human (`ilink_user_id`) has held bot ids `9258e9164dce`, `2ac100dc11c4`,
  `b2a669926961`, `32beb5e8c47d` across four authorizations on one test node.
- Whether the server actually invalidates the previous token is **not assumed**:
  every retirement probes `getupdates` with the retired token and records the
  verdict to the host log as `ACCOUNT_RETIRED_VERDICT account=… verdict=dead|ALIVE|unreachable`.
  A `verdict=ALIVE` line would falsify the one-live-bot assumption and must be
  investigated immediately.
- Open question (deliberately out of scope until evidence exists): can
  `local_token_list` re-bind an existing bot, making re-pairs unnecessary?

## 2. The state machine the tables implement

```
            QR confirmed (get_qrcode_status=confirmed)
            ┌──────────────────────────────────────────┐
            │                 ▼                         │
 (no row) ──┼──► LIVE ──► retired (rows migrated, row deleted)
            │        ▲                │
            └── re-pair (same owner) ─┘
```

- **LIVE**: an account row plus its credential and wechat state. The provider's
  `accounts()` list is the server-side live list and the single source of truth.
- **retired**: the same owner confirmed a newer bot. Conversation rows re-key to
  the new account, the active binding moves in place (one per conversation),
  person address rows re-key (persons are untouched), and the account row,
  wechat state, and credential are deleted — after the retirement verdict probe.

## 3. Invariants (every code path, always)

1. **One live bot per (provider, owner).** Every durable account row appears in
   the provider's live `accounts()` list.
2. **Every binding is routable.** A binding's account is always a live account;
   a conversation holds at most one active binding.
3. **Persons never lose their address.** Re-pairing re-keys address rows onto
   the new account; person profiles, claims, and intake records stay put.
4. **No orphans.** Wechat state, credential, core account row, conversation,
   binding, and address rows are created and retired together.
5. **Self-heal.** A store polluted by a crash or a missed cleanup converges at
   the next provider registration (startup reconciliation) or at the next
   authorization, without human intervention.

## 4. Enforcement (where the invariants live in code)

| Moment | Module | Work |
| --- | --- | --- |
| New authorization confirms | `@veren/im-wechat` `runtime.ts` `storeConfirmedAccount` | Probe the retired tokens (`ACCOUNT_RETIRED_VERDICT`), then drop wechat state + credential. |
| Account persisted | `@veren/im` `account-replace.ts` `retireOwnerAccounts` (via `persistAccount`) | Migrate conversations/bindings/addresses onto the new account; delete the dead rows. |
| Provider registers (every startup) | `@veren/im` `reconcileProviderAccounts` (via `ImRegistry` `onRegistered`) | The provider's live list is the verdict; leftovers heal onto their live sibling. |

## 5. Verification protocol

A change to this area is correct when all of the following hold:

1. **Property tests** (`tests/account-lifecycle.spec.ts`): 200 seeded random
   interleavings of pairing / restart / inbound keep every invariant.
2. **Pollution self-heal test** (`tests/account-replace.spec.ts`): a store with
   leftover dead rows converges on reconciliation; an unreachable provider is a
   no-op; two live accounts of one owner are both kept.
3. **Storage assertion** (scripted, not by eye): exactly one durable account per
   (provider, owner); zero rows referencing a dead account.
4. **Raw traffic capture**: with `DSH_IM_WECHAT_CAPTURE=<file>`, one fresh scan
   logs the whole login → confirm → retirement → resume-poll sequence with zero
   errors; the capture never contains a token (Authorization is reduced to a
   boolean).
5. **Server verdict in the log**: `ACCOUNT_RETIRED_VERDICT … verdict=dead` (an
   `ALIVE` is a stop-everything finding).
6. **Recurrence watch**: across repeated re-pairs, the account count stays at
   one; the UI list length is asserted automatically, not from screenshots.
