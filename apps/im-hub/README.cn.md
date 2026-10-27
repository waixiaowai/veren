# @veren/im-hub

当一个微信账号需要触达多台 DSH 设备时使用：这个独立云端网关持有唯一 iLink 会话
（QR 授权、`getupdates` 长轮询、`sendmessage`），把入站消息路由到默认设备，并为已注册
设备提供出站长轮询 API（register / poll / reply）与按设备的持久队列——离线设备按游标
补投。`authorize` 铸会话，`start` 服务；设备侧与 `@veren/im-hub` DSH 插件配对。

## 运行

```bash
HUB_DEVICE_TOKEN=<共享密钥> pnpm run authorize   # 二维码落在 data/ —— 扫一次
HUB_DEVICE_TOKEN=<共享密钥> pnpm start            # 服务设备 API + 轮询循环
```

环境变量：`HUB_ADDR`（:8787）、`HUB_DATA_DIR`（./data）、`HUB_DEVICE_TOKEN`（必填）、
`HUB_DEFAULT_DEVICE`（main）、`HUB_BASE_URL`（iLink 覆盖）。

持久化在 `HUB_DATA_DIR`：`hub-credentials.json`（0600）、按设备 `hub-queue-<device>.jsonl`
（至少一次日志；设备按游标补投）、`hub-contexts.json`（按会话 context token——重启后
回复需要它）。

English: [README.md](./README.md).
