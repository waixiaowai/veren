# IM 控制面上云：数据归属边界（2.3.0）

Status: adopted (2026-10-27) · Supersedes: 无 · 依赖: [im-multi-device-hub.cn.md](./im-multi-device-hub.cn.md)（2.2.0 云枢纽 ADR）

## 决策

微信通道移植 CMS 云端（2.2.0）后，IM 的"控制面事实"归云，本地插件降级为设备面适配器。归属裁定原则：

> **凡是"换一台设备必须还成立"的事实归 CMS；只服务本设备 agent 的状态归设备。**

### 数据归属表

| # | 事实 | 归属 | 主要读者 | 主要写者 |
|---|------|------|----------|----------|
| 1 | 授权会话（bot token / QR 流程 / -14 存活态） | **CMS**（2.2.0 已裁） | 设备面（间接）、用户面 | CMS 轮询器 |
| 2 | 消息日志（每条入站文本 + seq + 路由结局） | **CMS** | 用户面、设备（长轮询） | CMS 轮询器 |
| 3 | 会话映射（p2p conversation ↔ 发送者 ↔ context token） | **CMS** | 设备（回复寻址） | CMS |
| 4 | 人员身份（person、显示名/自称名/备注、地址绑定） | **CMS**（本次新增） | 设备（prompt 构建读缓存）、用户面 | 设备上报 + 一次性导入 + 用户面改名 |
| 5 | 设备注册（device 名、游标） | **CMS**（2.2.0 已有 device 列） | CMS、用户面 | 设备长轮询 |
| 6 | 采集记录（陌生人询问的发出/过期/答复历史） | **设备** | 本设备采集 tab | 本设备采集流 |
| 7 | 私有会话（DSH session id 映射） | **设备** | 本设备队列 | 本设备网关 |
| 8 | 队列状态机（queued/consuming/replied/dead + attempts） | **设备** | 本设备会话 tab 的 pending 列 | 本设备队列 |
| 9 | 会话本地投递缓存（messages 行） | **设备**（降级：仅供本设备审计视图） | 本设备 | 本设备 |

### 决策点 D1：视图宿主

IM 全景视图（账号/会话/人员/采集四 tab）的宿主 = **DSH 面板**，经 CMS 用户面 API 取数；CMS web 侧不新增 IM 视图（保持运营管理面定位）。理由：用户已常驻 DSH 面板；CMS web 现有 IM 面仅管理面（QR 授权/会话审计）。

### 鉴权分轨

| 凭据 | 面 | 载体 |
|------|----|------|
| 设备 API Key（`cmsk_…`，勾 `imhub:read`） | 设备面 `/v1/im/hub/*` | DSH 插件 config（现状不变） |
| 管理员/运营（`imhub:manage`） | 管理面 + 批量导入 | CMS 会话/JWT |
| **用户面（新 `imhub:view`）** | `/v1/im/user/*` | 面板登录：`POST /v1/auth/jwt` 账密换 Bearer JWT（跨源可用，T22 既有设施） |

三轨互不越界：设备 Key 打用户面 → 拒；JWT 打设备面 → 拒；无 `imhub:view` 的用户 → 403/空。

## CMS 用户面端点（读为主，写面仅两项）

| 端点 | 守卫 | 语义 |
|------|------|------|
| `GET /v1/im/user/overview` | auth 三态 + `imhub:view` | 会话状态（bot 存活/owner）+ 消息/人员计数 |
| `GET /v1/im/user/messages` | 同上 | 消息日志（新→旧，limit） |
| `GET /v1/im/user/people` | 同上 | 人员目录（含地址绑定） |
| `PATCH /v1/im/user/people/{id}` | 同上 | 改显示名/备注（对齐设备 renamePerson 语义） |
| `POST /v1/im/user/authorize` | auth 三态 + `imhub:manage` | 重授权触发（转管理面权限） |

设备面追加（守卫不变，`imhub:read`）：

| 端点 | 语义 |
|------|------|
| `POST /v1/im/hub/people/upsert` | 设备把观察/自报的人员身份增量上报（幂等按 address 定位） |
| `GET /v1/im/hub/people` | 设备拉目录（prompt 构建读缓存） |
| `POST /v1/im/hub/people/import` | **管理面**（`imhub:manage`）：本地目录一次性导入（bulk） |

## 设备侧改造

- `@veren/im` 核心新增可选远端目录缝 `ImDirectoryRemote`：注册了它（hub 插件提供实现）则人员观察走"上报 + 读缓存"，未注册则维持纯本地（直连微信单机形态不回归）。
- im-ui 四 tab 按归属表取数：账号 tab 读用户面会话状态（本地 bind 向导退役——授权已归云）；会话 tab 消息日志读云 + pending 列读本地；人员 tab 读云（改名走用户面）；采集 tab 维持本地。
- 本地存量目录经导入端点进云（`scripts/import-im-directory.mjs`，默认 dry-run）。

## 验收（ADR 验收段）

1. **双设备一致**：第二台设备登录同一 CMS 用户——人员/会话视图一致、同一发送者不被二次采集、收发正常。
2. **云端即事实源**：杀 CMS 重启，用户面视图从库复原；期间设备消息排队不丢。
3. **权限探针**：无 `imhub:view` 用户 403；设备 Key 打 `/v1/im/user/*` 被拒；JWT 打 `/v1/im/hub/messages` 被拒。
4. **终态审计双写**：`im_hub_messages` 每条既能在用户面可见，又有设备侧结局（messages 表或队列状态）。

## 明确不做（本期）

消息云端执行（agent 仍在设备侧）、多 CMS 租户、内容路由、设备管理 UI、`/device` 切换指令（正式版另立）。

## 版本

`@veren` 全线 **2.3.0**（MINOR：CMS 用户面 + 远端目录缝为新能力）；CMS 独立版本线照旧。
