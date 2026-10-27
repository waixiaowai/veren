# 多设备架构：ADR + 云中枢尖刺（v2.2.0）

## 背景（已定事实）
- 铁律：一个微信同时只能有一个 iLink 会话（bot）。现会话在 3080（bot 32beb5e8c47d）。
- 已确认决策：尖刺先本地后上 138；通道移交云端（3080 现通道退役）；协议客户端单源复用（@veren/im-wechat 加 "./api" 子路径导出）。
- CMS（D:\cms）为 Go 单二进制 + systemd + 自动部署 138 的成熟平台；尖刺期 im-hub 先本地跑，不碰 138。

## Phase A — ADR 文档
`docs/im-multi-device-hub.cn.md` + `docs/im-multi-device-hub.md`（双语对）：
- **决策**：唯一 iLink 会话挂云端 im-hub；多台 DSH 设备以 hub provider（出站长轮询）接入；路由 = 默认设备 + 指令切换（后期）。
- **被否决项（带证据）**：多 bot/每设备（一号一会话铁律，用户确认+服务端行为）；家中常开中枢（离线即断，无备份可能——会话漂移=换 bot，token 绑定）；agent 联邦（远期，非消息路由范畴）。
- **后果**：消息过云（隐私注记）、CMS 主机成为微信通道依赖、设备离线由云端排队兜底。
- **迁移序列**：云端扫码（新 bot、owner=同一微信人）→ 旧 bot 服务端作废 → 3080 wechat 监视器三败自动停止（现有机制）→ hub provider 接管。

## Phase B — 协议客户端单源
`plugins/im/wechat/package.json` exports 增加 `"./api": { "types": "./src/api.ts", "default": "./dist/api.js" }`（check:entries 门禁会校验 dist/api.js 存在，tsc 构建自然产出）。

## Phase C — 云端网关 apps/im-hub（独立 Node 服务，本地先行）
- `node:http` 最小实现 + 依赖 `@veren/im-wechat`（api 子路径）。
- 职责四件：①持有唯一 iLink 会话（QR 授权 CLI：qrcode 出 PNG → 扫码 → token 落 `data/hub-credentials.json` 0600；getupdates 长轮询 + 游标持久化）②入站路由：默认设备（`HUB_DEFAULT_DEVICE` env）③设备队列持久化（`data/hub-queue.json` 原子写；设备离线时消息排队）④设备 API 三端点：`POST /hub/register`（deviceToken 校验）、`GET /hub/poll`（长轮询，30s 空回）、`POST /hub/reply`（回复 → sendText）。
- 文件按职责拆（server/session/queue/route），每文件 ≤300 行。

## Phase D — 设备侧插件 plugins/im/hub（@veren/im-hub，插件名 imHub）
- 实现 `ImService`（providerId `'hub'`）：`listen()` 长轮询 hub → 归一化 ImMessage（accountId='hub'）→ registry；`send()` = POST /hub/reply；`accounts()` = 单设备账号（ownerId 取 `HUB_OWNER_ID` env）；`bind()` = IM_UNSUPPORTED。
- inject `['im','storageDomain','agents']`；config：hubBaseUrl / deviceToken / hubOwnerId / enabled。
- **零新机制**：挂进 registry 后，2.1.8 的队列/私有会话/人员/采集全部原样生效。
- 真机装载：`@veren/im-hub` 单独手动发布（release.mjs 闭包外，同 task-workbench 流程），3080 以 registry 版本安装（不走本地路径，避开 workspace 解析坑）；不入 im-bundle、不进市场索引。

## Phase E — 验收四闸门（真机，3080 当设备）
1. 一条真实微信消息全程闭环：手机 → hub 捕获 → 设备长轮询 → DSH 队列消费 → 回答经 hub sendmessage 回手机。
2. 3 连消息按序三回（忙碌 ack 生效）。
3. 杀设备侧 DSH 进程 → 消息在 hub 队列排队 → 重启后补投送达。
4. 终态审计：hub 队列文件 + 设备 messages 表，每条 message_id 有结局。
通过后：补 systemd 单元（仿 cms.service）部署 138（独立后续，不在本计划内）。

## Phase F — 版本与发布
- 版本线 **2.2.0**（MINOR：多设备接入为新能力）；全线 bump + 门禁 + `node market/release.mjs` + `@veren/im-hub`/task-workbench 手动补发 + 市场索引（im-hub 不上索引）。
- ADR 验收段回填尖刺证据后随提交入库；提交 `feat(im): cloud hub spike for multi-device - 2.2.0` + tag `v2.2.0` + push；记忆归档。

## 明确不做（本期）
内容路由、多设备管理 UI、/device 切换指令（正式版）、device-id 插件接入（尖刺用 env token）、能力联邦。

## 风险
- 云端扫码后旧 bot 作废不可逆（3080 微信通道即移交）——已获确认。
- @veren/im 的 schemastery 传递依赖进云端服务（npm.veren.top 可装，接受）。
- 真机演练需要你扫码一次 + 发消息若干。