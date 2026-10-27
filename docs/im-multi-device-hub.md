# ADR: One WeChat, Many DSH Devices — the Cloud Message Hub (im-hub)

> Status: adopted (2026-10-27). Spike-verification phase; until every gate in §6
> passes, this decision does not take over the production channel.
> Chinese version: [im-multi-device-hub.cn.md](./im-multi-device-hub.cn.md).
> Prerequisites: [iLink account lifecycle](./im-account-lifecycle.md), [message-queue semantics](./im-message-queue.md).

## 1. Problem

A user owns several devices running DSH, but one WeChat account can hold only
one iLink session (bot) at a time — whichever device the bot lives on becomes
the WeChat entry point. Today (2.1.8) the de-facto answer is "the last scanned
device wins; every other device's channel is invalidated server-side". The
multi-device scenario needs an explicit architecture.

## 2. Constraints and evidence

| Fact | Evidence |
| --- | --- |
| One WeChat holds exactly one live iLink session | Confirmed by the user (protocol precondition); every re-scan so far severed the previous bot (account lifecycle doc §1) |
| A re-scan mints a new bot; the token is bound to the bot | `get_qrcode_status=confirmed` payload (traffic capture); this is why "session failover" is impossible |
| The protocol is plain HTTP/JSON (no public docs) | The official ClawBot write-ups and community gateways (weixin-ilink-gateway et al.) — a cloud-side gateway is the mature shape of this ecosystem |

## 3. Alternatives and verdicts

| Option | Verdict | Reason |
| --- | --- | --- |
| One bot per device (multi-bot coexistence) | **Rejected** | Conflicts with the one-session rule; since 2.1.6 the same-owner retirement actively cleans sibling bots |
| Always-on home device as hub | **Rejected (this phase)** | Hub offline = WeChat dead; no failover exists (session drift is impossible); external devices need extra tunnels |
| Session-drift failover (cloud takes over when the hub drops) | **Rejected (permanent)** | The token is bound to the bot: taking over means re-scanning means a new bot — that is migration, not failover |
| Agent federation (route capabilities, not messages) | **Deferred** | Cross-device agent collaboration is its own large capability; first solve message arrival |
| **CMS cloud hub (im-hub)** | **Adopted** | The single session lives in the cloud, online 24/7; devices connect outbound (zero exposed ports); offline devices are covered by the cloud queue; the CMS already has a mature deploy pipeline (systemd + CI/CD to 138) |

## 4. Decision

```
WeChat ⇄ iLink servers ⇄ 【im-hub (cloud, the only iLink session holder)】
                             │  ① device registration (deviceToken check)
                             │  ② outbound long-poll delivery (cloud queues while offline)
                             │  ③ reply intake → sendmessage back to WeChat
                             ▼
                 multiple DSH devices (one hub-provider plugin each)
                 zero new mechanisms on the device: the hub is just
                 another provider — the 2.1.8 queue/private
                 sessions/people/intake all keep working
```

- **The only iLink session** lives in im-hub: one QR authorization, credentials
  and cursor persisted in the cloud data directory (0600).
- **Device access**: outbound HTTP long polling (isomorphic to the WeChat
  monitor), no inbound port anywhere; the spike authenticates with a shared
  deviceToken, the production version adopts the device-id plugin (a durable
  identity per device).
- **Routing**: a default device (env `HUB_DEFAULT_DEVICE`) to start; the switch
  command (/device) and content routing are follow-ups, not this phase.
- **Offline semantics**: while a device is unreachable its messages stay in the
  cloud device queue (at-least-once) and are delivered by cursor when it returns.

## 5. Consequences

- Messages transit the cloud (privacy note): bodies relay through the CMS host;
  in a self-hosted deployment that host is the user's own.
- The CMS host becomes the single dependency of the WeChat channel: if the
  im-hub process dies the channel pauses (messages buffer on the iLink side;
  the long poll resumes on recovery — iLink offline replay is not guaranteed,
  so the queue does best-effort catch-up by cursor).
- Single-source protocol client: `@veren/im-wechat` gains a `./api` subpath
  export so the cloud and the plugin share the same 5-endpoint client; a
  protocol change lands in one place.

## 6. Spike gates (until all pass, the production channel is untouched)

1. One real WeChat message round-trips end to end: phone → hub → device
   long-poll → DSH queue consumption → answer back through the hub's sendmessage.
2. Three rapid messages answered strictly in order (the busy ack works).
3. Killing the device-side DSH process queues the message in the hub; after
   restart it is delivered.
4. Terminal-state audit: the hub device-queue file plus the device `messages`
   table give every message_id an outcome.

## 7. Migration sequence (executed after the spike passes)

1. Deploy im-hub to the CMS host (a systemd unit modeled on cms.service).
2. QR-authorize in the cloud (new bot, same owner) → the old bot is invalidated
   server-side.
3. The 3080 WeChat monitor takes `-14` and stops after its three strikes
   (existing mechanism); the hub provider has already taken over. The wechat
   plugin is not uninstalled (dormant is harmless); production cleanup follows
   the config-surface work.
