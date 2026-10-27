# @veren/im-hub

Use when this DSH device should receive WeChat messages through the cloud im-hub gateway instead of holding an iLink session itself: the plugin long-polls the hub's device API outbound (no inbound port, shared device token), feeds inbound messages into the provider-neutral registry so the durable queue, private sessions, people directory, and stranger intake all keep working unchanged, and posts replies back to the hub for delivery. Pair it with the `@veren/im-hub` app running on the CMS host — one authorized WeChat per owner serves every registered device.

## Use

- Install after the im-hub gateway is running and authorized.
- Config: `hubBaseUrl` (gateway address), `deviceToken` (the shared secret — empty disables the channel by failing activation), `deviceId` (the registration name at the hub).
- The device holds no iLink session; authorization lives on the hub. `im_bind` is refused on this channel.
- The poll cursor persists in the `im_hub` storage domain: a restart resumes from the last delivered batch (at-least-once).

中文说明见 [README.cn.md](./README.cn.md)。
