# @veren/im-hub

Use when one WeChat account must reach several DSH devices: this standalone cloud gateway holds the only iLink session (QR authorization, `getupdates` long polling, `sendmessage`), routes inbound messages to a default device, and serves registered devices an outbound long-poll API (register / poll / reply) with a durable per-device queue so offline devices catch up by cursor. Run it with `authorize` to mint the session and `start` to serve; pair devices with the `@veren/im-hub` DSH plugin.

## Run

```bash
HUB_DEVICE_TOKEN=<shared-secret> pnpm run authorize   # QR PNG lands in data/ — scan once
HUB_DEVICE_TOKEN=<shared-secret> pnpm start           # serve the device API + poll loop
```

Environment: `HUB_ADDR` (:8787), `HUB_DATA_DIR` (./data), `HUB_DEVICE_TOKEN` (required), `HUB_DEFAULT_DEVICE` (main), `HUB_BASE_URL` (iLink override).

Durable state lives in `HUB_DATA_DIR`: `hub-credentials.json` (0600), per-device `hub-queue-<device>.jsonl` (at-least-once log; devices catch up by cursor), `hub-contexts.json` (per-conversation context tokens — replies need them after a restart).

中文说明见 [README.cn.md](./README.cn.md)。
