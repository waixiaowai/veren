# @veren/im-hub

当本设备需要经云端 im-hub 网关接收微信消息（而不是自己持有 iLink 会话）时使用本插件：
插件出站长轮询 hub 的设备 API（无入站端口、共享设备令牌），把入站消息喂进 provider
中立的注册表——持久队列、私有会话、人员目录、陌生人采集原样生效——并把回复交回 hub
投递。与运行在 CMS 主机上的 `@veren/im-hub` 应用配对：一个授权微信服务所有已注册设备。

## 使用

- 在 im-hub 网关运行并完成授权后安装。
- 配置：`hubBaseUrl`（网关地址）、`deviceToken`（共享密钥——留空会让激活失败、通道整体禁用）、`deviceId`（本设备在 hub 的注册名）。
- 本设备不持有 iLink 会话；授权住在 hub 上。本通道拒绝 `im_bind`。
- 轮询游标持久化在 `im_hub` 存储域：重启后从最后投递的批次继续（至少一次）。

English: [README.md](./README.md).
