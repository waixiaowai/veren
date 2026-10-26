# IM 账号生命周期：微信 bot、拥有者与不变式

> 读者：`@veren/im` / `@veren/im-wechat` 的开发者。
> 英文版：[im-account-lifecycle.md](./im-account-lifecycle.md)。

本文记录 iLink 协议被实际观测到的行为、持久化表实现的状态机、所有代码路径必须
保住的不变式，以及判定一次改动是否正确的验收协议。证据优先于假设：下面每条结论
都指明在哪里可以复核。

## 1. 协议事实（观测所得，非假设）

针对 `https://ilinkai.weixin.qq.com/` 观测（客户端：`@veren/im-wechat`，2026-10）：

| 端点 | 鉴权 | 观测行为 |
| --- | --- | --- |
| `POST ilink/bot/get_bot_qrcode?bot_type=3` | 无 | 铸造新的二维码挑战。请求体带 `local_token_list: []`——这个槽位暗示可以携带已有 token（可能是复用/重绑路径，**尚未实验过**）。 |
| `GET ilink/bot/get_qrcode_status?qrcode=…` | 无（长轮询） | 返回 `wait` / `scaned` / `need_verifycode` / `confirmed` / `expired` / `verify_code_blocked` / `binded_redirect`。`confirmed` 载荷带 `bot_token`、`ilink_bot_id`、`ilink_user_id`、可选 `baseurl`。 |
| `POST ilink/bot/getupdates` | `Authorization: Bearer <bot_token>` | 游标长轮询。`ret=-14` 表示登录已失效——**这就是服务器对「token 已死」的裁决**。 |
| `POST ilink/bot/sendmessage` | Bearer | `ret=-2` 同时覆盖 context token 失效与频率控制。 |
| `POST ilink/bot/msg/notifystart` / `notifystop` | Bearer | 通知流控制；stop 时的 `-14` 视为已完成。 |

插件产出的实证：

- 迄今每次扫码授权都铸造**新的** `ilink_bot_id`；同一个人（`ilink_user_id`）在一个测试
  节点上历经四次授权，先后持有 `9258e9164dce`、`2ac100dc11c4`、`b2a669926961`、
  `32beb5e8c47d` 四个 bot id。
- 「服务器是否真的作废旧 token」**不做假设**：每次退役都会用旧 token 探测 `getupdates`，
  并把裁决写进宿主日志 `ACCOUNT_RETIRED_VERDICT account=… verdict=dead|ALIVE|unreachable`。
  出现 `verdict=ALIVE` 即推翻「单活 bot」假设，必须立即排查。
- 未决问题（证据出现前刻意不做）：`local_token_list` 能否重绑既有 bot，从而让重配对
  根本不发生？

## 2. 持久化表实现的状态机

```
            QR 确认（get_qrcode_status=confirmed）
            ┌──────────────────────────────────────────┐
            │                 ▼                         │
 (无行) ────┼──► LIVE ──► retired（行迁移后删除）
            │        ▲                │
            └── 重配对（同 owner）────┘
```

- **LIVE**：账号行 + 凭据 + wechat 状态并存。provider 的 `accounts()` 名单就是服务器侧
  的活名单，是唯一事实源。
- **retired**：同 owner 确认了更新的 bot。会话行改键到新账号，active 绑定原地改挂
  （每会话至多一条），人员地址行换键（person 档案不动），账号行、wechat 状态与凭据
  删除——删除前先做退役裁决探针。

## 3. 不变式（所有代码路径、任何时刻）

1. **每 (provider, owner) 至多一只活 bot。** 每条持久化账号行都出现在 provider 的
   活 `accounts()` 名单里。
2. **每条绑定可路由。** 绑定的账号永远是活账号；一个会话至多一条 active 绑定。
3. **person 不丢地址。** 重配对把地址行换键到新账号；person 档案、自述与采集记录原地不动。
4. **零孤儿。** wechat 状态、凭据、core 账号行、会话、绑定、地址行同生共死。
5. **自愈。** 崩溃或清理失手污染的存储，在下一次 provider 注册（启动对账）或下一次授权时
   自动收敛，不需要人介入。

## 4. 强制执行（不变式在代码里的落点）

| 时刻 | 模块 | 工作 |
| --- | --- | --- |
| 新授权确认 | `@veren/im-wechat` `runtime.ts` `storeConfirmedAccount` | 探测退役 token（`ACCOUNT_RETIRED_VERDICT`），然后删 wechat 状态 + 凭据。 |
| 账号落库 | `@veren/im` `account-replace.ts` `retireOwnerAccounts`（经 `persistAccount`） | 会话/绑定/地址迁移到新账号；删除死行。 |
| provider 注册（每次启动） | `@veren/im` `reconcileProviderAccounts`（经 `ImRegistry` `onRegistered`） | provider 活名单即裁决；遗留行自愈到同主活账号。 |

## 5. 验收协议

该领域的改动同时满足以下各条才算正确：

1. **属性测试**（`tests/account-lifecycle.spec.ts`）：200 组种子化随机交错
   （配对/重启/入站）保住全部不变式。
2. **污染自愈测试**（`tests/account-replace.spec.ts`）：带死行遗留的存储在对账后收敛；
   provider 不可达时原样跳过；同 owner 两只活账号都保留。
3. **存储断言**（脚本判定，不靠人眼）：每 (provider, owner) 恰一条持久化账号；
   零行引用死账号。
4. **原始流量捕获**：设 `DSH_IM_WECHAT_CAPTURE=<file>` 后，一次新鲜扫码记录完整的
   login → confirm → 退役 → 恢复轮询序列且零错误；捕获文件绝不包含 token
   （Authorization 约简为布尔）。
5. **日志中的服务器裁决**：`ACCOUNT_RETIRED_VERDICT … verdict=dead`（出现 `ALIVE`
   即停下来排查）。
6. **复发观察**：连续多次重授权，账号数恒为 1；UI 列表长度由自动化断言，不靠截图。
