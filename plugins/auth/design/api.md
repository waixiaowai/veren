---
title: 服务端接口
description: 全部服务端接口的统一清单：接口标识、路径、方法、参数契约、响应与限流规则。
sidebar:
  order: 19
  label: 服务端接口
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 3. External Interfaces

服务端接口是端点路由域对外交付的全部可调用面：每一个业务能力都注册为一个端点，携带路径、方法、参数模式与鉴权要求，挂在认证基路径 `/api/auth` 之下（默认值，经 `basePath` 配置可改）。本章是接口标识的唯一权威清单：接口标识格式 `API-<模块编号>-<两位序号>`（命名来源见 [统一命名清单](./index/#73-interface-identifiers)），按归属模块连续编号；模块的职责边界见各模块章，请求进入端点后的分派时序见 [端点路由域](./modules/02-endpoint/)，错误码语义统一见 [错误码](./errors/)，本章只引用码名不重复语义。

### 3.1 Identifier Scheme

| 模块编号 | 归属域 | 本章接口范围 |
|---|---|---|
| 02 | endpoint 端点路由域 | 框架内建的基础路由（探活、错误页） |
| 03 | session 会话域 | 会话的读取、续期、吊销与附加字段更新 |
| 04 | credential 凭证域 | 口令的注册、校验、变更与重置 |
| 05 | identity 身份域 | 主体档案、邮箱校验与账号绑定 |
| 06 | oauth 联合授权域 | 第三方登录、回调交换与令牌管理 |
| 07 | guard 守卫域 | 无自有接口；其行为（来源校验、限流）作用于全部路由，见 3.8 |
| 09 | plugin 插件域 | 由扩展贡献、未单列域章的代表接口 |
| 13 | organization 组织域 | 组织、成员、邀请与活跃组织切换 |
| 14 | strongauth 强认证域 | 二次验证、设备授权、钱包签名与 JWT 密钥 |
| 15 | enterprise 企业域 | 企业 SSO 供给（本章列代表接口） |
| 16 | reference 参考域 | 运行时契约的机器可读导出 |

### 3.2 Interface Inventory

| 接口标识 | 路径 | 方法 | 归属 | 用途 |
|---|---|---|---|---|
| API-02-01 | `/ok` | GET | endpoint | 探活检查 |
| API-02-02 | `/error` | GET | endpoint | 端点错误页兜底 |
| API-03-01 | `/get-session` | GET、POST | session | 读取当前会话与主体档案 |
| API-03-02 | `/sign-out` | POST | session | 登出并清除会话凭据 |
| API-03-03 | `/list-sessions` | GET | session | 列出自身活跃会话 |
| API-03-04 | `/revoke-session` | POST | session | 吊销一个自身会话 |
| API-03-05 | `/revoke-sessions` | POST | session | 吊销自身全部会话 |
| API-03-06 | `/revoke-other-sessions` | POST | session | 吊销除当前外全部会话 |
| API-03-07 | `/update-session` | POST | session | 更新会话附加字段 |
| API-04-01 | `/sign-up/email` | POST | credential | 邮箱口令注册 |
| API-04-02 | `/sign-in/email` | POST | credential | 邮箱口令登录 |
| API-04-03 | `/change-password` | POST | credential | 变更口令 |
| API-04-04 | `/request-password-reset` | POST | credential | 请求口令重置邮件 |
| API-04-05 | `/reset-password/:token` | GET | credential | 重置链接回调跳转 |
| API-04-06 | `/reset-password` | POST | credential | 凭令牌设置新口令 |
| API-04-07 | `/verify-password` | POST | credential | 核对当前口令 |
| API-05-01 | `/update-user` | POST | identity | 更新自身档案 |
| API-05-02 | `/change-email` | POST | identity | 变更邮箱 |
| API-05-03 | `/delete-user` | POST | identity | 删除自身账号 |
| API-05-04 | `/send-verification-email` | POST | identity | 发送校验邮件 |
| API-05-05 | `/verify-email` | GET | identity | 校验邮箱令牌 |
| API-05-06 | `/list-accounts` | GET | identity | 列出自身账号绑定 |
| API-05-07 | `/link-social` | POST | identity | 绑定社交账号 |
| API-05-08 | `/unlink-account` | POST | identity | 解绑账号 |
| API-06-01 | `/sign-in/social` | POST | oauth | 发起第三方登录 |
| API-06-02 | `/callback/:id` | GET、POST | oauth | 提供方回调交换 |
| API-06-03 | `/get-access-token` | POST | oauth | 取可用的提供方访问令牌 |
| API-06-04 | `/refresh-token` | POST | oauth | 刷新提供方令牌 |
| API-06-05 | `/account-info` | GET | oauth | 读取提供方档案 |
| API-09-01 | `/admin/list-users` | GET | plugin | 管理端分页列用户 |
| API-09-02 | `/admin/ban-user` | POST | plugin | 封禁用户 |
| API-09-03 | `/admin/impersonate-user` | POST | plugin | 冒充用户登录 |
| API-09-04 | `/sign-in/username` | POST | plugin | 用户名口令登录 |
| API-09-05 | `/sign-in/phone-number` | POST | plugin | 手机号口令登录 |
| API-09-06 | `/phone-number/verify` | POST | plugin | 校验手机号 OTP |
| API-09-07 | `/sign-in/magic-link` | POST | plugin | 发送魔法链接 |
| API-09-08 | `/magic-link/verify` | GET | plugin | 魔法链接核销登录 |
| API-09-09 | `/email-otp/send-verification-otp` | POST | plugin | 发送邮箱 OTP |
| API-09-10 | `/email-otp/verify-email` | POST | plugin | 凭 OTP 校验邮箱并登录 |
| API-09-11 | `/one-time-token/generate` | GET | plugin | 签发一次性令牌 |
| API-09-12 | `/one-time-token/verify` | POST | plugin | 核销一次性令牌换取会话 |
| API-09-13 | `/sign-in/anonymous` | POST | plugin | 创建匿名会话 |
| API-09-14 | `/multi-session/set-active` | POST | plugin | 切换活跃设备会话 |
| API-09-15 | `/multi-session/list-device-sessions` | GET | plugin | 列出本设备保存的会话 |
| API-09-16 | `/multi-session/revoke` | POST | plugin | 吊销一个设备会话 |
| API-13-01 | `/organization/create` | POST | organization | 创建组织 |
| API-13-02 | `/organization/invite-member` | POST | organization | 邀请成员 |
| API-13-03 | `/organization/accept-invitation` | POST | organization | 接受邀请 |
| API-13-04 | `/organization/set-active` | POST | organization | 设置活跃组织 |
| API-14-01 | `/two-factor/enable` | POST | strongauth | 启用二次验证 |
| API-14-02 | `/two-factor/verify-totp` | POST | strongauth | 校验 TOTP 码 |
| API-14-03 | `/two-factor/verify-backup-code` | POST | strongauth | 校验备份码 |
| API-14-04 | `/device/code` | POST | strongauth | 设备授权申请 |
| API-14-05 | `/device/token` | POST | strongauth | 设备码换令牌轮询 |
| API-14-06 | `/device/approve` | POST | strongauth | 批准设备授权 |
| API-14-07 | `/device/deny` | POST | strongauth | 拒绝设备授权 |
| API-14-08 | `/siwe/nonce` | POST | strongauth | 签发钱包登录随机数 |
| API-14-09 | `/siwe/verify` | POST | strongauth | 校验钱包签名并登录 |
| API-14-10 | `/jwks` | GET | strongauth | 发布 JWT 公钥集 |
| API-14-11 | `/token` | GET | strongauth | 为当前会话签发 JWT |
| API-15-01 | `/sso/register` | POST | enterprise | 注册 SSO 提供方 |
| API-15-02 | `/sso/providers` | GET | enterprise | 列出可用 SSO 提供方 |
| API-16-01 | `/open-api/generate-schema` | GET | reference | 生成 OpenAPI 模式 |
| API-16-02 | `/reference` | GET | reference | 接口参考页 |

接口总数 64 个。错误码语义一律见 [错误码](./errors/)；主体与权限判定依据见 [权限与多主体](./permissions/)；字段可见性以 [数据字典](./data/) 为准。

### 3.3 Endpoint Domain Interfaces

基础路由由框架内建、永远最后追加且不可覆盖（取证：`packages/better-auth/src/api/routes/ok.ts:4`、`packages/better-auth/src/api/routes/error.ts:374`）。

#### API-02-01 Ok

| 项 | 值 |
|---|---|
| 路径 | `/ok` |
| 方法 | GET |
| 身份认证 | 无 |

无请求参数。响应 `{ "ok": true }`。无错误码分支。用途是部署探活：宿主应用据此确认认证基路径可达。

#### API-02-02 Error

| 项 | 值 |
|---|---|
| 路径 | `/error` |
| 方法 | GET |
| 身份认证 | 无 |

查询参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `error` | string | 否 | `UNKNOWN` | 错误码；含非法字符时归一为 `UNKNOWN` |
| `error_description` | string | 否 | null | 错误描述 |

响应：默认渲染 HTML 错误页；配置 `onAPIError.errorURL` 时 302 跳转到宿主错误页并透传 `error` 与 `error_description`；生产环境未自定义页面时 302 跳回首页。

### 3.4 Session Domain Interfaces

会话端点的签发、续期与吊销语义见 [会话域](./modules/03-session/)；敏感端点强制读权威源（`sensitiveSessionMiddleware`），新鲜端点要求会话创建时间在 `freshAge` 内（`freshSessionMiddleware`），不满足分别报 `UNAUTHORIZED` 与 `SESSION_NOT_FRESH`。本组错误码：`UNAUTHORIZED`、`SESSION_NOT_FRESH`、`FAILED_TO_GET_SESSION`、`METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED`、`BODY_MUST_BE_AN_OBJECT`（语义见 [错误码](./errors/)）。

#### API-03-01 Get Session

| 项 | 值 |
|---|---|
| 路径 | `/get-session` |
| 方法 | GET、POST |
| 身份认证 | 无强制要求；无会话返回 `null`（取证：`packages/better-auth/src/api/routes/session.ts:29`） |

查询参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `disableCookieCache` | boolean | 否 | false | 绕过缓存副本，读权威源 |
| `disableRefresh` | boolean | 否 | false | 抑制续期回写 |

响应：`{ session, user } | null`；开启 `session.deferSessionRefresh` 时 GET 额外返回 `needsRefresh` 标志，POST 才执行刷新，POST 在未开启该配置时报 `METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED`。会话过期时删除记录并清除凭据。

#### API-03-02 Sign Out

| 项 | 值 |
|---|---|
| 路径 | `/sign-out` |
| 方法 | POST |
| 身份认证 | 无强制要求；按凭据尽力吊销 |

请求体参数（整体可选）：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `callbackURL` | string | 否 | null | 提供方登出后的回跳地址 |
| `disableRedirect` | boolean | 否 | false | 只返回登出 URL 不跳转 |
| `state` | string | 否 | null | 透传给提供方登出端点 |

响应：`{ "success": true, "url": <提供方登出地址或 null>, "redirect": <是否应跳转> }`；无论是否携带有效凭据都清除 Cookie。

```json
{ "callbackURL": "/goodbye" }
```

#### API-03-03 List Sessions

| 项 | 值 |
|---|---|
| 路径 | `/list-sessions` |
| 方法 | GET |
| 身份认证 | 有效会话且新鲜（`freshSessionMiddleware`） |

无请求参数。响应：会话记录数组（不含过期行）。错误码：`SESSION_NOT_FRESH`。

#### API-03-04 Revoke Session

| 项 | 值 |
|---|---|
| 路径 | `/revoke-session` |
| 方法 | POST |
| 身份认证 | 有效会话，权威源读取（`sensitiveSessionMiddleware`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `token` | string | 是 | — | 要吊销的会话令牌 |

响应：`{ "status": true }`。归属判定见 [权限与多主体](./permissions/#42-permission-matrix)：非本人令牌静默返回成功，不泄露存在性。

```json
{ "token": "<会话令牌>" }
```

#### API-03-05 Revoke Sessions

| 项 | 值 |
|---|---|
| 路径 | `/revoke-sessions` |
| 方法 | POST |
| 身份认证 | 有效会话，权威源读取 |

无请求参数。响应：`{ "status": true }`。吊销本人全部会话，含当前会话。

#### API-03-06 Revoke Other Sessions

| 项 | 值 |
|---|---|
| 路径 | `/revoke-other-sessions` |
| 方法 | POST |
| 身份认证 | 有效会话，权威源读取 |

无请求参数。响应：`{ "status": true }`。保留当前会话，吊销其余活跃会话。

#### API-03-07 Update Session

| 项 | 值 |
|---|---|
| 路径 | `/update-session` |
| 方法 | POST |
| 身份认证 | 有效会话（`sessionMiddleware`；取证：`packages/better-auth/src/api/routes/update-session.ts:17`） |

请求体参数：会话扩展附加字段记录（字段名 → 值；可写字段由插件声明，核心字段不可写，见 [数据字典](./data/#72-session-会话)）。空对象报"无可更新字段"。

响应：`{ "session": <更新后的会话> }`。有状态部署下更新未命中权威源行时判定会话已被吊销，清除凭据并报 `FAILED_TO_GET_SESSION`。

```json
{ "<扩展字段名>": "<值>" }
```

### 3.5 Credential Domain Interfaces

口令的散列、强度策略与等时失败设计见 [凭证域](./modules/04-credential/)。强度上下界默认 8 与 128（`PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG`）。本组错误码：`INVALID_EMAIL`、`INVALID_PASSWORD`、`INVALID_EMAIL_OR_PASSWORD`、`PASSWORD_TOO_SHORT`、`PASSWORD_TOO_LONG`、`CREDENTIAL_ACCOUNT_NOT_FOUND`、`INVALID_TOKEN`、`TOKEN_EXPIRED`、`USER_NOT_FOUND`、`FAILED_TO_CREATE_USER`、`FAILED_TO_CREATE_SESSION`、`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`（语义见 [错误码](./errors/)）。

#### API-04-01 Sign Up Email

| 项 | 值 |
|---|---|
| 路径 | `/sign-up/email` |
| 方法 | POST |
| 身份认证 | 无；需配置 `emailAndPassword.enabled` 且未 `disableSignUp` |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | 是 | — | 主体名 |
| `email` | string（email 格式） | 是 | — | 入库前小写归一，全局唯一 |
| `password` | string（非空） | 是 | — | 强度校验后散列存储 |
| `image` | string | 否 | null | 头像 URL |
| `callbackURL` | string | 否 | `"/"` | 校验邮件回跳地址 |
| `rememberMe` | boolean | 否 | true | false 时会话凭据为会话级 Cookie |
| 其余键 | 任意 | 否 | — | 插件贡献的可写附加字段，未声明的键被忽略 |

响应：`{ "token": <会话令牌或 null>, "user": <主体档案> }`。开启 `requireEmailVerification` 或关闭 `autoSignIn` 时 `token` 为 `null` 且不签发会话。注册查重命中时按配置返回与成功不可区分的透明响应以阻断账号枚举，否则报 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`。

```json
{ "name": "Ada", "email": "ada@example.com", "password": "<口令>", "rememberMe": true }
```

#### API-04-02 Sign In Email

| 项 | 值 |
|---|---|
| 路径 | `/sign-in/email` |
| 方法 | POST |
| 身份认证 | 无 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `email` | string | 是 | — | 登录邮箱 |
| `password` | string | 是 | — | 登录口令 |
| `callbackURL` | string | 否 | null | 响应回带的跳转地址 |
| `rememberMe` | boolean | 否 | true | false 时有效期缩至 1 天 |

响应：`{ "redirect": false, "token": <会话令牌>, "url": <callbackURL 或省略>, "user": <主体档案> }`。凭据校验失败统一报 `INVALID_EMAIL_OR_PASSWORD`（等时失败，见 [错误码](./errors/)）；要求邮箱已校验而未校验时报 `EMAIL_NOT_VERIFIED`，配置 `sendOnSignIn` 时顺带重发校验邮件。

```json
{ "email": "ada@example.com", "password": "<口令>" }
```

#### API-04-03 Change Password

| 项 | 值 |
|---|---|
| 路径 | `/change-password` |
| 方法 | POST |
| 身份认证 | 有效会话，权威源读取 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `newPassword` | string | 是 | — | 新口令，强度校验 |
| `currentPassword` | string | 是 | — | 当前口令，核对失败报 `INVALID_PASSWORD` |
| `revokeOtherSessions` | boolean | 否 | false | true 时同事务吊销其余会话并签发新会话 |

响应：`{ "token": <新会话令牌或 null>, "user": <主体档案> }`。无凭证绑定行时报 `CREDENTIAL_ACCOUNT_NOT_FOUND`。

```json
{ "currentPassword": "<旧口令>", "newPassword": "<新口令>", "revokeOtherSessions": true }
```

#### API-04-04 Request Password Reset

| 项 | 值 |
|---|---|
| 路径 | `/request-password-reset` |
| 方法 | POST |
| 身份认证 | 无；需配置 `emailAndPassword.sendResetPassword` |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `email` | string（email 格式） | 是 | — | 目标邮箱 |
| `redirectTo` | string | 否 | null | 重置链接回跳地址，须命中受信来源表 |

响应：`{ "status": true, "message": "If this email exists in our system, check your email for the reset link" }`——无论邮箱是否存在都返回同一形态（防枚举，耗时也做等时垫底）。重置令牌有效期默认 3600 秒（`resetPasswordTokenExpiresIn` 可调）。

```json
{ "email": "ada@example.com", "redirectTo": "/reset" }
```

#### API-04-05 Reset Password Callback

| 项 | 值 |
|---|---|
| 路径 | `/reset-password/:token` |
| 方法 | GET |
| 身份认证 | 无（凭路径令牌） |

参数：路径参数 `token`；查询参数 `callbackURL`（string，必填，受信来源校验）。

响应：校验通过 302 跳转 `callbackURL?token=<令牌>`；令牌缺失或过期 302 跳转 `callbackURL?error=INVALID_TOKEN`。本端点只做跳转，真正的改口令由 API-04-06 完成。

#### API-04-06 Reset Password

| 项 | 值 |
|---|---|
| 路径 | `/reset-password` |
| 方法 | POST |
| 身份认证 | 无（凭一次性令牌） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `newPassword` | string | 是 | — | 新口令，强度校验 |
| `token` | string | 否 | — | 重置令牌；未提供时回落读查询参数 `token` |

响应：`{ "status": true }`。令牌核销为原子消费——同一令牌并发重置只有一方成功；口令被拒绝（含泄露库校验拒绝）时令牌保留可用。错误码：`INVALID_TOKEN`、`USER_NOT_FOUND`。

```json
{ "token": "<重置令牌>", "newPassword": "<新口令>" }
```

#### API-04-07 Verify Password

| 项 | 值 |
|---|---|
| 路径 | `/verify-password` |
| 方法 | POST |
| 身份认证 | 有效会话，权威源读取 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `password` | string | 是 | — | 待核对的当前口令 |

响应：`{ "status": true }`；核对失败报 `INVALID_PASSWORD`（取证：`packages/better-auth/src/api/routes/password.ts:330`）。

### 3.6 Identity Domain Interfaces

主体档案、邮箱校验流程与账号绑定归属身份域（边界见 [身份域](./modules/05-identity/)）；账号绑定字段见 [数据字典](./data/#73-account-账号绑定)。本组错误码：`UNAUTHORIZED`、`SESSION_NOT_FRESH`、`SESSION_EXPIRED`、`BODY_MUST_BE_AN_OBJECT`、`FIELD_NOT_ALLOWED`、`EMAIL_CAN_NOT_BE_UPDATED`、`CHANGE_EMAIL_DISABLED`、`EMAIL_MISMATCH`、`EMAIL_ALREADY_VERIFIED`、`VERIFICATION_EMAIL_NOT_ENABLED`、`INVALID_TOKEN`、`TOKEN_EXPIRED`、`USER_NOT_FOUND`、`INVALID_USER`、`ACCOUNT_NOT_FOUND`、`FAILED_TO_UNLINK_LAST_ACCOUNT`、`SOCIAL_ACCOUNT_ALREADY_LINKED`、`FAILED_TO_CREATE_SESSION`（语义见 [错误码](./errors/)）；绑定链路的 `LINKING_NOT_ALLOWED`、`LINKING_DIFFERENT_EMAILS_NOT_ALLOWED`、`LINKING_FAILED` 为上下文码。

#### API-05-01 Update User

| 项 | 值 |
|---|---|
| 路径 | `/update-user` |
| 方法 | POST |
| 身份认证 | 有效会话（取证：`packages/better-auth/src/api/routes/update-user.ts:30`） |

请求体参数：字段名 → 值的记录。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 | 主体名 |
| `image` | string、null | 否 | 头像 URL，可置空 |
| `email` | 任意 | — | 一律拒绝：报 `EMAIL_CAN_NOT_BE_UPDATED`，改邮箱走 API-05-02 |
| 其余键 | 任意 | 否 | 插件声明的可写附加字段 |

响应：`{ "status": true }`；更新成功后重发会话 Cookie 使缓存副本同步。空更新报"无可更新字段"。

```json
{ "name": "Ada Lovelace", "image": null }
```

#### API-05-02 Change Email

| 项 | 值 |
|---|---|
| 路径 | `/change-email` |
| 方法 | POST |
| 身份认证 | 有效会话，权威源读取 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `newEmail` | string（email 格式） | 是 | — | 新邮箱 |
| `callbackURL` | string | 否 | null | 校验邮件回跳地址 |

响应：`{ "user": <主体档案>, "status": true, "message": "Email updated" 或 "Verification email sent" }`。未开启变更时报 `CHANGE_EMAIL_DISABLED`；两步确认流程经 API-05-05 以 `requestType` 区分确认与落地两个阶段。

```json
{ "newEmail": "new@example.com", "callbackURL": "/settings" }
```

#### API-05-03 Delete User

| 项 | 值 |
|---|---|
| 路径 | `/delete-user` |
| 方法 | POST |
| 身份认证 | 有效会话，权威源读取；需配置 `user.deleteUser.enabled`，未开启时 404 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `password` | string | 否 | null | 提供时核对口令；未提供且会话不新鲜报 `SESSION_EXPIRED` |
| `token` | string | 否 | null | 删除确认令牌；提供时直接执行删除 |
| `callbackURL` | string | 否 | null | 删除确认邮件的回跳地址 |

响应：`{ "success": true, "message": "User deleted" 或 "Verification email sent" }`——配置了确认邮件回调时先发确认（令牌有效期默认 86400 秒），确认端点 `/delete-user/callback` 以原子消费保证同一令牌只删一次。

```json
{ "password": "<口令>" }
```

#### API-05-04 Send Verification Email

| 项 | 值 |
|---|---|
| 路径 | `/send-verification-email` |
| 方法 | POST |
| 身份认证 | 无强制要求；携带会话时按会话主体校验（取证：`packages/better-auth/src/api/routes/email-verification.ts:81`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `email` | string（email 格式） | 是 | — | 目标邮箱 |
| `callbackURL` | string | 否 | `"/"` | 校验回跳地址 |

响应：`{ "status": true }`。未配置发信回调报 `VERIFICATION_EMAIL_NOT_ENABLED`；携带会话且邮箱与主体不一致报 `EMAIL_MISMATCH`，已校验报 `EMAIL_ALREADY_VERIFIED`。匿名调用时对"不存在或已校验"的邮箱做等时垫底（至少 500 毫秒），不泄露账号状态。

```json
{ "email": "ada@example.com" }
```

#### API-05-05 Verify Email

| 项 | 值 |
|---|---|
| 路径 | `/verify-email` |
| 方法 | GET |
| 身份认证 | 无（凭签名令牌） |

查询参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `token` | string | 是 | — | 校验令牌（HS256 签名的 JWT） |
| `callbackURL` | string | 否 | null | 提供时以 302 回跳代替 JSON 响应，错误也经查询参数 `error` 回带 |

响应：`{ "status": true, "user": <主体档案或 null> }`。令牌过期报 `TOKEN_EXPIRED`、无效报 `INVALID_TOKEN`、邮箱未登记报 `USER_NOT_FOUND`；令牌含 `updateTo` 时进入改邮箱两步流程，链接与其签发主体绑定，不得迁移到该地址的新主人。

#### API-05-06 List Accounts

| 项 | 值 |
|---|---|
| 路径 | `/list-accounts` |
| 方法 | GET |
| 身份认证 | 有效会话 |

无请求参数。响应：账号绑定数组，每项含 `id`、`providerId`、`accountId`、`userId`、`scopes`（逗号串拆分）、`createdAt`、`updatedAt`；令牌类字段永不外泄（`returned: false`，见 [数据字典](./data/#73-account-账号绑定)）。

#### API-05-07 Link Social

| 项 | 值 |
|---|---|
| 路径 | `/link-social` |
| 方法 | POST |
| 身份认证 | 有效会话，权威源读取（取证：`packages/better-auth/src/api/routes/account.ts:130`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `provider` | string（提供方枚举） | 是 | — | 目标提供方标识 |
| `callbackURL` | string | 否 | null | 绑定完成回跳地址 |
| `errorCallbackURL` | string | 否 | null | 绑定失败回跳地址 |
| `scopes` | string 数组 | 否 | — | 追加请求的授权范围 |
| `requestSignUp` | boolean | 否 | false | 允许为未注册第三方账号走注册 |
| `idToken` | object | 否 | — | 断言直连绑定：`token`（必填）、`nonce`、`accessToken`、`refreshToken` |
| `disableRedirect` | boolean | 否 | false | 只返回授权地址不跳转 |
| `loginHint` | string | 否 | null | 透传给提供方 |
| `additionalParams` | object | 否 | — | 附加授权参数，保留键被拒绝 |
| `additionalData` | object | 否 | — | 随流程透传的数据 |

响应：重定向分支 `{ "url": <授权地址>, "redirect": true }`；断言分支 `{ "url": "", "status": true, "redirect": false }`。目标绑定已归属他主体报 `SOCIAL_ACCOUNT_ALREADY_LINKED`；邮箱不一致且未放开时报 `LINKING_DIFFERENT_EMAILS_NOT_ALLOWED`。

```json
{ "provider": "github", "callbackURL": "/settings/accounts" }
```

#### API-05-08 Unlink Account

| 项 | 值 |
|---|---|
| 路径 | `/unlink-account` |
| 方法 | POST |
| 身份认证 | 有效会话且新鲜（`freshSessionMiddleware`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `accountId` | string | 是 | — | 账号绑定记录 ID |

响应：`{ "status": true }`。解绑最后一条绑定且未开 `account.allowUnlinkingAll` 报 `FAILED_TO_UNLINK_LAST_ACCOUNT`；ID 不在本人绑定集合内报 `ACCOUNT_NOT_FOUND`——归属过滤先行，越权与不存在同码。

```json
{ "accountId": "<绑定 ID>" }
```

### 3.7 OAuth Domain Interfaces

第三方登录与回调交换的时序见 [联合授权域](./modules/06-oauth/)。本组错误码：`PROVIDER_NOT_FOUND`、`ID_TOKEN_NOT_SUPPORTED`、`INVALID_TOKEN`、`FAILED_TO_GET_USER_INFO`、`USER_EMAIL_NOT_FOUND`、`EMAIL_NOT_VERIFIED`（语义见 [错误码](./errors/)）；令牌管理上下文码：`USER_ID_OR_SESSION_REQUIRED`、`ACCOUNT_NOT_FOUND`、`PROVIDER_NOT_SUPPORTED`、`REFRESH_TOKEN_NOT_FOUND`、`TOKEN_REFRESH_NOT_SUPPORTED`、`FAILED_TO_GET_ACCESS_TOKEN`、`FAILED_TO_REFRESH_ACCESS_TOKEN`、`ACCESS_TOKEN_NOT_FOUND`、`PROVIDER_NOT_CONFIGURED`。

#### API-06-01 Sign In Social

| 项 | 值 |
|---|---|
| 路径 | `/sign-in/social` |
| 方法 | POST |
| 身份认证 | 无 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `provider` | string（提供方枚举） | 是 | — | 提供方标识 |
| `callbackURL` | string | 否 | null | 登录完成回跳 |
| `newUserCallbackURL` | string | 否 | null | 新注册主体回跳 |
| `errorCallbackURL` | string | 否 | null | 失败回跳 |
| `scopes` | string 数组 | 否 | — | 覆盖默认授权范围 |
| `requestSignUp` | boolean | 否 | false | 提供方禁用隐式注册时显式请求注册 |
| `disableRedirect` | boolean | 否 | false | 只返回授权地址（弹窗场景） |
| `idToken` | object | 否 | — | 断言直登：`token` 必填，`nonce`、`accessToken`、`refreshToken`、`expiresAt`、`user` 可选 |
| `loginHint` | string | 否 | null | 登录提示 |
| `additionalParams` | object | 否 | — | 附加授权参数 |
| `additionalData` | object | 否 | — | 随状态值透传 |

响应：重定向分支 `{ "url": <授权地址>, "redirect": true }`（不跳转时 `redirect: false`）；断言分支 `{ "redirect": false, "token": <会话令牌>, "user": <主体档案> }`。

```json
{ "provider": "google", "callbackURL": "/dashboard" }
```

#### API-06-02 OAuth Callback

| 项 | 值 |
|---|---|
| 路径 | `/callback/:id` |
| 方法 | GET、POST |
| 身份认证 | 无（凭状态值 Cookie 与授权码） |

路径参数：`id`（提供方标识）。查询或体参数（POST 时由体与查询合并后 302 回落 GET）：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `code` | string | 条件 | — | 授权码；错误分支时可为空 |
| `state` | string | 条件 | — | 状态值；缺失报 `state_not_found` 回跳错误页 |
| `error` | string | 否 | null | 提供方错误码 |
| `error_description` | string | 否 | null | 提供方错误描述 |
| `device_id` | string | 否 | null | 设备流关联 |
| `user` | string | 否 | null | 提供方透传数据 |
| `iss` | string | 否 | null | 签发方标识 |

响应：成功 302 跳转 `callbackURL`（新主体用 `newUserCallbackURL`）并设置会话 Cookie；失败按错误种类回跳错误页。允许 `allowIdpInitiated` 的提供方在无状态值但有授权码时重新发起授权。授权绑定流程由状态值内嵌的 `link` 载荷驱动。

#### API-06-03 Get Access Token

| 项 | 值 |
|---|---|
| 路径 | `/get-access-token` |
| 方法 | POST |
| 身份认证 | HTTP 调用必须携带有效会话；服务端内嵌调用可改传 `userId`（取证：`packages/better-auth/src/api/routes/account.ts:771`） |

请求体参数（二选一形态）：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `accountId` | string | 二选一必填 | — | 账号绑定记录 ID |
| `useAccountCookie` | boolean 字面量 true | 二选一必填 | — | 从签名账号 Cookie 取当前账号（无存储部署） |
| `userId` | string | 否 | null | 仅服务端内嵌调用可指定 |

响应：`{ "accessToken": <令牌>, "accessTokenExpiresAt": <到期时间>, "scopes": [...], "idToken": <断言> }`；距到期不足 5 秒时自动刷新并回写。账号不存在或不归属当前主体报 `ACCOUNT_NOT_FOUND`。

```json
{ "accountId": "<绑定 ID>" }
```

#### API-06-04 Refresh Token

| 项 | 值 |
|---|---|
| 路径 | `/refresh-token` |
| 方法 | POST |
| 身份认证 | 同 API-06-03 |

请求体参数：同 API-06-03 的账号选择形态。

响应：`{ "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "idToken", "providerId", "accountId" }`。提供方不支持刷新报 `TOKEN_REFRESH_NOT_SUPPORTED`，无刷新令牌报 `REFRESH_TOKEN_NOT_FOUND`；`scope` 刻意不回写——刷新响应可能收窄授权范围。

```json
{ "accountId": "<绑定 ID>" }
```

#### API-06-05 Account Info

| 项 | 值 |
|---|---|
| 路径 | `/account-info` |
| 方法 | GET（取证：`packages/better-auth/src/api/routes/account.ts:969`，参数走查询而非请求体） |
| 身份认证 | 同 API-06-03 |

查询参数：同 API-06-03 的账号选择形态（`accountId` 或 `useAccountCookie`，`userId` 可选）。

响应：`{ "user": { name, email, image, emailVerified }, "data": <提供方原始资料>, "account": { id, providerId, accountId } }`。提供方未装配报 `PROVIDER_NOT_CONFIGURED`，无访问令牌报 `ACCESS_TOKEN_NOT_FOUND`。

### 3.8 Guard Behavior Coverage

守卫域没有自有接口：它的全部行为以路由级与端点级中间件形态作用于 3.3 至 3.13 的每一条路由（设计见 [守卫域](./modules/07-guard/)）。对接口清单的三点全局影响：

1. **非幂等方法先过来源校验**：POST 类接口的来源头缺失或为 null 报 `MISSING_OR_NULL_ORIGIN`，不在受信表报 `INVALID_ORIGIN`；GET、OPTIONS、HEAD 跳过。`callbackURL`、`redirectTo`、`errorCallbackURL`、`newUserCallbackURL` 类参数一律受信来源表校验，不命中报对应 `INVALID_*` 码。
2. **表单媒体类型的端点级 CSRF**：`/sign-up/email`、`/sign-in/email`、`/sign-in/magic-link`、`/email-otp/send-verification-otp` 接受 `application/x-www-form-urlencoded`，挂 `formCsrfMiddleware`（取证：`packages/better-auth/src/api/routes/sign-up.ts:38`）。
3. **限流最后执行**：命中即返回 429 与 `X-Retry-After` 头，响应体为 `{ "message": "Too many requests. Please try again later." }`，规则见 3.16。

### 3.9 Plugin Contributed Interfaces

本组接口由扩展按插件域契约注册（扩展点与隔离保证见 [插件域](./modules/09-plugin/)），路径同样挂在基路径之下，与核心端点共用同一分派与守卫管线。错误码归属各自扩展的命名空间（见 [错误码](./errors/#52-extension-error-code-namespaces)）。

#### API-09-01 Admin List Users

| 项 | 值 |
|---|---|
| 路径 | `/admin/list-users` |
| 方法 | GET |
| 身份认证 | 有效会话，权威源读取 + `hasPermission` 判定 `user.list`，不足报 `YOU_ARE_NOT_ALLOWED_TO_LIST_USERS`（取证：`packages/better-auth/src/plugins/admin/routes.ts:789`） |

查询参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `limit` | number | 否 | — | 分页大小 |
| `offset` | number | 否 | 0 | 分页起点 |
| `sortBy` | string | 否 | null | 排序字段 |
| `sortDirection` | string | 否 | — | 排序方向 |
| `searchField` | string | 否 | null | 检索字段 |
| `searchValue` | string、number | 否 | null | 检索值 |
| `searchOperator` | string | 否 | — | 检索操作符 |
| `filterField` | string | 否 | null | 过滤字段 |
| `filterValue` | string、number、boolean 或数组 | 否 | null | 过滤值 |
| `filterOperator` | string | 否 | — | 过滤操作符 |

响应：`{ "users": [<主体档案，含 role、banned 等扩展字段>], "total": <总数>, "limit": <limit>, "offset": <offset> }`。

#### API-09-02 Admin Ban User

| 项 | 值 |
|---|---|
| 路径 | `/admin/ban-user` |
| 方法 | POST |
| 身份认证 | 同 API-09-01，`hasPermission` 判定 `user.ban` |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `userId` | string | 是 | — | 目标主体 ID |
| `banReason` | string | 否 | `defaultBanReason` 配置 | 封禁原因 |
| `banExpiresIn` | number（秒） | 否 | 永久 | 到期自动解封 |

响应：`{ "user": <更新后的主体档案> }`。禁止自封（`YOU_CANNOT_BAN_YOURSELF`）；目标不存在报 `USER_NOT_FOUND`。

```json
{ "userId": "<主体 ID>", "banReason": "abuse", "banExpiresIn": 86400 }
```

#### API-09-03 Admin Impersonate User

| 项 | 值 |
|---|---|
| 路径 | `/admin/impersonate-user` |
| 方法 | POST |
| 身份认证 | 同 API-09-01，`hasPermission` 判定 `user.impersonate`（取证：`packages/better-auth/src/plugins/admin/routes.ts:1222`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `userId` | string | 是 | — | 被冒充主体 ID |
| `expiresIn` | number（秒） | 否 | 冒充会话专用有效期 | 冒充会话时长 |

响应：`{ "session": <冒充会话>, "user": <被冒充主体> }`。冒充会话写入 `impersonatedBy`（服务端专属字段），原管理员会话保留于 Cookie 集以便 `/admin/stop-impersonating` 返回；目标为管理员角色时默认拒绝，`allowImpersonatingAdmins` 或 `user.impersonate-admins` 权限可放开。

```json
{ "userId": "<主体 ID>" }
```

#### API-09-04 Sign In Username

| 项 | 值 |
|---|---|
| 路径 | `/sign-in/username` |
| 方法 | POST |
| 身份认证 | 无（username 扩展贡献；取证：`packages/better-auth/src/plugins/username/index.ts:355`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `username` | string | 是 | — | 用户名 |
| `password` | string | 是 | — | 口令 |
| `rememberMe` | boolean | 否 | true | 同邮箱口令登录语义 |
| `callbackURL` | string | 否 | null | 登录后跳转地址 |

响应：`{ "redirect", "token", "user"（含 username、displayUsername）, "callbackURL" }`；凭据错误语义与 API-04-02 一致（`INVALID_USERNAME_OR_PASSWORD` 命名空间）。

```json
{ "username": "ada", "password": "<口令>" }
```

#### API-09-05 Sign In Phone Number

| 项 | 值 |
|---|---|
| 路径 | `/sign-in/phone-number` |
| 方法 | POST |
| 身份认证 | 无（phone-number 扩展贡献；取证：`packages/better-auth/src/plugins/phone-number/routes.ts:62`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `phoneNumber` | string | 是 | — | 手机号（如 `+1234567890`） |
| `password` | string | 是 | — | 口令 |
| `rememberMe` | boolean | 否 | true | 同邮箱口令登录语义 |

响应：`{ "redirect", "token", "user"（含 phoneNumber、phoneNumberVerified） }`。

```json
{ "phoneNumber": "+1234567890", "password": "<口令>" }
```

#### API-09-06 Verify Phone Number

| 项 | 值 |
|---|---|
| 路径 | `/phone-number/verify` |
| 方法 | POST |
| 身份认证 | 无强制要求；携带会话且 `updatePhoneNumber` 为 true 时改为换绑流程 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `phoneNumber` | string | 是 | — | 待校验手机号 |
| `code` | string | 是 | — | OTP 码 |
| `disableSession` | boolean | 否 | false | true 时不签发会话 |
| `updatePhoneNumber` | boolean | 否 | false | true 时对当前会话主体换绑手机号 |

响应：`{ "status": true, "token": <会话令牌或 null>, "user": <主体档案> }`；OTP 错误归属 `OTP_*` / `INVALID_OTP` 命名空间。

```json
{ "phoneNumber": "+1234567890", "code": "123456" }
```

#### API-09-07 Sign In Magic Link

| 项 | 值 |
|---|---|
| 路径 | `/sign-in/magic-link` |
| 方法 | POST |
| 身份认证 | 无（magic-link 扩展贡献；取证：`packages/better-auth/src/plugins/magic-link/index.ts:228`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `email` | string（email 格式） | 是 | — | 目标邮箱 |
| `name` | string | 否 | null | 邮箱未注册时作为注册主体名 |
| `callbackURL` | string | 否 | null | 链接回跳地址 |

响应：`{ "status": true }`；真实发送由扩展的 `sendMagicLink` 回调承担。

```json
{ "email": "ada@example.com", "callbackURL": "/magic-done" }
```

#### API-09-08 Verify Magic Link

| 项 | 值 |
|---|---|
| 路径 | `/magic-link/verify` |
| 方法 | GET |
| 身份认证 | 无（凭一次性令牌；回跳参数全过受信来源校验） |

查询参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `token` | string | 是 | — | 魔法链接令牌 |
| `callbackURL` | string | 否 | `"/"` | 成功回跳 |
| `newUserCallbackURL` | string | 否 | null | 新主体回跳 |
| `errorCallbackURL` | string | 否 | null | 失败回跳 |

响应：`{ "session": <会话>, "user": <主体档案> }` 并设置会话 Cookie；核销为原子消费，重复核销只有一方成功。

#### API-09-09 Send Verification OTP

| 项 | 值 |
|---|---|
| 路径 | `/email-otp/send-verification-otp` |
| 方法 | POST |
| 身份认证 | 无（email-otp 扩展贡献；取证：`packages/better-auth/src/plugins/email-otp/routes.ts:103`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `email` | string | 是 | — | 目标邮箱 |
| `type` | `email-verification`、`sign-in`、`forget-password`、`change-email` 之一 | 是 | — | OTP 用途，决定后续核销端点 |

响应：`{ "success": true }`；发送回调未配置时报上下文错误。

```json
{ "email": "ada@example.com", "type": "sign-in" }
```

#### API-09-10 Verify Email OTP

| 项 | 值 |
|---|---|
| 路径 | `/email-otp/verify-email` |
| 方法 | POST |
| 身份认证 | 无（凭 OTP） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `email` | string | 是 | — | 目标邮箱 |
| `otp` | string | 是 | — | 六位左右的一次性码 |

响应：`{ "status": true, "token": <会话令牌或 null>, "user": <主体档案> }`；开启 `autoSignInAfterVerification` 时签发会话。错误码：`INVALID_OTP`、`OTP_EXPIRED`、`TOO_MANY_ATTEMPTS`。

```json
{ "email": "ada@example.com", "otp": "123456" }
```

#### API-09-11 Generate One Time Token

| 项 | 值 |
|---|---|
| 路径 | `/one-time-token/generate` |
| 方法 | GET |
| 身份认证 | 有效会话（取证：`packages/better-auth/src/plugins/one-time-token/index.ts:138`） |

无请求参数。响应：`{ "token": <一次性令牌> }`；`disableClientRequest` 开启时拒绝浏览器请求。令牌供无密码的跨端登录接力。

#### API-09-12 Verify One Time Token

| 项 | 值 |
|---|---|
| 路径 | `/one-time-token/verify` |
| 方法 | POST |
| 身份认证 | 无（凭一次性令牌） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `token` | string | 是 | — | 待核销令牌 |

响应：`{ "session": <会话>, "user": <主体档案> }`；核销原子，重复核销报令牌无效。

```json
{ "token": "<一次性令牌>" }
```

#### API-09-13 Sign In Anonymous

| 项 | 值 |
|---|---|
| 路径 | `/sign-in/anonymous` |
| 方法 | POST |
| 身份认证 | 无（anonymous 扩展贡献；取证：`packages/better-auth/src/plugins/anonymous/index.ts:122`） |

无请求参数。响应：`{ "user": <主体档案，isAnonymous 为 true>, "session": <会话> }`；匿名主体经任意一条正式登录（邮箱、OTP、魔法链接、手机号等）升级为普通主体，绑定并入同一行。

#### API-09-14 Multi Session Set Active

| 项 | 值 |
|---|---|
| 路径 | `/multi-session/set-active` |
| 方法 | POST |
| 身份认证 | 有效会话；目标会话凭据须存在于本设备的 `_multi-` 前缀 Cookie 集（取证：`packages/better-auth/src/plugins/multi-session/index.ts:142`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `sessionToken` | string | 是 | — | 目标会话令牌 |

响应：`{ "user": <目标主体>, "session": <目标会话> }`；以签名 Cookie 中的令牌为权威值行动，请求体只负责点名。

```json
{ "sessionToken": "<目标会话令牌>" }
```

#### API-09-15 List Device Sessions

| 项 | 值 |
|---|---|
| 路径 | `/multi-session/list-device-sessions` |
| 方法 | GET |
| 身份认证 | 无强制要求；按本设备 Cookie 集解析 |

无请求参数。响应：`[ { "session": <会话>, "user": <主体> }, ... ]`——同一主体去重，只含未过期行；无 Cookie 时返回空数组。

#### API-09-16 Multi Session Revoke

| 项 | 值 |
|---|---|
| 路径 | `/multi-session/revoke` |
| 方法 | POST |
| 身份认证 | 有效会话 |

请求体参数：同 API-09-14（`sessionToken` 必填）。

响应：`{ "status": true }`；吊销的是当前活跃会话时，从设备 Cookie 集切换到下一个有效会话。

### 3.10 Organization Domain Interfaces

组织、成员、邀请与角色判定的完整设计见 [组织域](./modules/13-organization/)；活跃组织落在会话的 `activeOrganizationId` 字段（服务端专属）。错误码归属 `ORGANIZATION_*`、`YOU_*`、`MEMBER_*`、`ROLE_*`、`INVITATION_*` 命名空间（见 [错误码](./errors/#52-extension-error-code-namespaces)），本章不重复语义。

#### API-13-01 Create Organization

| 项 | 值 |
|---|---|
| 路径 | `/organization/create` |
| 方法 | POST |
| 身份认证 | 有效会话（取证：`packages/better-auth/src/plugins/organization/routes/crud-org.ts:73`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | 是 | — | 组织名 |
| `slug` | string | 是 | — | 全局唯一标识，重复报组织已存在 |
| `logo` | string | 否 | null | 组织图标 URL |
| `metadata` | string、object | 否 | null | 透传元数据 |
| `userId` | string | 否 | 当前会话主体 | 仅服务端内嵌调用可代建 |

响应：`{ "organization": <组织记录>, "member": <创建者的成员记录，role 为 creatorRole 默认 owner> }`。

```json
{ "name": "Acme", "slug": "acme" }
```

#### API-13-02 Invite Member

| 项 | 值 |
|---|---|
| 路径 | `/organization/invite-member` |
| 方法 | POST |
| 身份认证 | 有效会话 + 邀请管理角色判定（owner/admin，角色依据见 [权限与多主体](./permissions/#42-permission-matrix)） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `email` | string | 是 | — | 被邀方邮箱 |
| `role` | string | 否 | `member` | 授予角色（逗号分隔可多角色） |
| `organizationId` | string | 否 | 活跃组织 | 目标组织 |
| `teamId` | string | 否 | null | 团队作用域邀请 |
| `resend` | boolean | 否 | false | 对既有 pending 邀请重发 |

响应：`{ "invitation": <邀请记录，status 为 pending> }`；邀请记录字段见 [数据字典](./data/#78-invitation-组织邀请)。

```json
{ "email": "bob@example.com", "role": "admin", "organizationId": "<组织 ID>" }
```

#### API-13-03 Accept Invitation

| 项 | 值 |
|---|---|
| 路径 | `/organization/accept-invitation` |
| 方法 | POST |
| 身份认证 | 有效会话；邀请邮箱须与会话主体邮箱一致 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `invitationId` | string | 是 | — | 邀请记录 ID |

响应：`{ "member": <新建成员记录> }`。仅 `pending` 状态可接受；过期、已取消报对应 `INVITATION_*` 码；状态机见 [状态模型](./states/)。

```json
{ "invitationId": "<邀请 ID>" }
```

#### API-13-04 Set Active Organization

| 项 | 值 |
|---|---|
| 路径 | `/organization/set-active` |
| 方法 | POST |
| 身份认证 | 有效会话（取证：`packages/better-auth/src/plugins/organization/routes/crud-org.ts:865`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `organizationId` | string、null | 二选一 | null | 目标组织 ID；null 显式清除活跃组织 |
| `organizationSlug` | string | 二选一 | null | 目标组织 slug |
| `metadata` | object | 否 | null | 透传数据 |

响应：`{ "organization": <组织>, "member": <当前主体在该组织下的成员记录> }`；清除或未指定时返回 `null`。非成员访问报 `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`；成功后写入会话的 `activeOrganizationId`，后续组织端点默认以此为作用域。

```json
{ "organizationId": "<组织 ID>" }
```

### 3.11 Strong Auth Domain Interfaces

二次验证、设备授权与密钥面的完整设计见 [强认证域](./modules/14-strongauth/)。TOTP 校验端点接受两种主体态：有效会话，或登录中间态（`two-factor` 待验证 Cookie 关联的校验凭据）；两者皆无报 `INVALID_TWO_FACTOR_COOKIE`（取证：`packages/better-auth/src/plugins/two-factor/verify-two-factor.ts:23`）。二次验证错误码 `TOTP_NOT_ENABLED`、`INVALID_BACKUP_CODE`、`ACCOUNT_TEMPORARILY_LOCKED`、设备授权错误枚举见 [错误码](./errors/#52-extension-error-code-namespaces)。

#### API-14-01 Enable Two Factor

| 项 | 值 |
|---|---|
| 路径 | `/two-factor/enable` |
| 方法 | POST |
| 身份认证 | 有效会话（取证：`packages/better-auth/src/plugins/two-factor/index.ts:217`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `password` | string | 条件 | — | 口令确认；无密码模式（`allowPasswordless`）下可省 |
| `method` | `totp`、`otp` | 否 | `totp` | 启用的二次验证方式 |
| `issuer` | string | 否 | — | TOTP 签发方显示名 |

响应：`{ "method": <方式>, "totpURI": <otpauth URI，totp 方式>, "backupCodes": [<备份码数组>] }`；备份码只在本响应完整返回一次。

#### API-14-02 Verify TOTP

| 项 | 值 |
|---|---|
| 路径 | `/two-factor/verify-totp` |
| 方法 | POST |
| 身份认证 | 有效会话或登录中间态 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `code` | string | 是 | — | 六位 TOTP 码 |
| `trustDevice` | boolean | 否 | false | true 时信任设备 30 天，期内免二次验证 |

响应：`{ "status": true }`；登录中间态下完成校验即签发正式会话。连续失败达上限触发账户临时锁定（`ACCOUNT_TEMPORARILY_LOCKED`）；未启用 TOTP 报 `TOTP_NOT_ENABLED`。

```json
{ "code": "012345", "trustDevice": true }
```

#### API-14-03 Verify Backup Code

| 项 | 值 |
|---|---|
| 路径 | `/two-factor/verify-backup-code` |
| 方法 | POST |
| 身份认证 | 有效会话或登录中间态 |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `code` | string | 是 | — | 单枚备份码，消费一次即失效 |
| `disableSession` | boolean | 否 | false | true 时不设置会话 Cookie |
| `trustDevice` | boolean | 否 | false | 同 API-14-02 |

响应：`{ "status": true, "user": <主体档案> }`；备份码校验按哈希逐枚比对，失败报 `INVALID_BACKUP_CODE`。

```json
{ "code": "<备份码>" }
```

#### API-14-04 Device Code Request

| 项 | 值 |
|---|---|
| 路径 | `/device/code` |
| 方法 | POST |
| 身份认证 | 无（RFC 8628 设备侧，取证：`packages/better-auth/src/plugins/device-authorization/routes.ts:244`） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `client_id` | string | 是 | — | 接入方标识 |
| `user_id` | string | 否 | null | 预绑定的主体 ID（服务端场景） |
| `scope` | string | 否 | null | 请求的授权范围 |

响应：`{ "device_code", "user_code", "verification_uri", "verification_uri_complete", "expires_in", "interval" }`（RFC 8628 §3.2 形态）；错误以 `error` / `error_description` 对返回。

```json
{ "client_id": "tv-app", "scope": "profile" }
```

#### API-14-05 Device Token Poll

| 项 | 值 |
|---|---|
| 路径 | `/device/token` |
| 方法 | POST |
| 身份认证 | 无（凭 device_code 轮询） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `grant_type` | 字面量 `urn:ietf:params:oauth:grant-type:device_code` | 是 | — | 固定授予类型 |
| `device_code` | string | 是 | — | 设备验证码 |
| `client_id` | string | 是 | — | 接入方标识 |

响应：批准后 `{ "session": <会话>, "user": <主体> }` 形态的令牌响应；未决/被拒/过期分别返回 `authorization_pending`、`slow_down`、`access_denied`、`expired_token` 错误枚举（取证：`packages/better-auth/src/plugins/device-authorization/routes.ts:653`）。

```json
{ "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": "<设备码>", "client_id": "tv-app" }
```

#### API-14-06 Device Approve

| 项 | 值 |
|---|---|
| 路径 | `/device/approve` |
| 方法 | POST |
| 身份认证 | 有效会话（批准动作必须来自已登录主体） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `userCode` | string | 是 | — | 用户可见码 |

响应：`{ "success": true }`；错误以 `error` 枚举返回：`invalid_request`、`expired_token`、`device_code_already_processed`、`unauthorized`、`access_denied`。

```json
{ "userCode": "ABCD-EFGH" }
```

#### API-14-07 Device Deny

| 项 | 值 |
|---|---|
| 路径 | `/device/deny` |
| 方法 | POST |
| 身份认证 | 有效会话 |

请求体参数：同 API-14-06（`userCode` 必填）。

响应：`{ "success": true }`；对应设备码置 `denied`，轮询方收到 `access_denied`。

#### API-14-08 Siwe Nonce

| 项 | 值 |
|---|---|
| 路径 | `/siwe/nonce` |
| 方法 | POST（取证：`packages/better-auth/src/plugins/siwe/index.ts:94`） |
| 身份认证 | 无 |

请求体参数：空对象（strict，可省略）。响应：`{ "nonce": <随机数> }`——随机数须满足 ERC-4361 格式（8 到 20 位字母数字），落库为校验凭据，有效期 15 分钟，核销一次性。

#### API-14-09 Siwe Verify

| 项 | 值 |
|---|---|
| 路径 | `/siwe/verify` |
| 方法 | POST |
| 身份认证 | 无（签名即凭据；匿名扩展开启时可先建匿名主体再升级） |

请求体参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `message` | string | 是 | — | ERC-4361 签名原文 |
| `signature` | string | 是 | — | 钱包签名 |
| `email` | string（email 格式） | 条件 | null | 匿名扩展关闭时必填，用于建档 |

响应：`{ "redirect": false, "token": <会话令牌>, "user": <主体档案> }`；钱包地址绑定到 `WalletAddress` 表（`(userId, address)` 唯一，见 [数据字典](./data/#79-supporting-entities)）。

```json
{ "message": "<ERC-4361 原文>", "signature": "<签名>" }
```

#### API-14-10 Json Web Key Set

| 项 | 值 |
|---|---|
| 路径 | `/jwks`（`jwks.jwksPath` 可改，默认 `/jwks`） |
| 方法 | GET |
| 身份认证 | 无（公钥发布面） |

无请求参数。响应：`{ "keys": [ 包含 alg、crv、kid 等 JWK 公钥字段的数组 ] }`——过期密钥在宽限期（默认 2592000 秒）内仍发布，保证已签发 JWT 可验。私钥永不出现于此（见 [数据字典](./data/#79-supporting-entities)）。

#### API-14-11 Sign In Token

| 项 | 值 |
|---|---|
| 路径 | `/token` |
| 方法 | GET |
| 身份认证 | 有效会话（取证：`packages/better-auth/src/plugins/jwt/index.ts:250`） |

无请求参数。响应：`{ "token": <当前主体的 JWT> }`。服务端签发与校验走 server-only 的 `signJWT`、`verifyJWT`（见 3.15）。

### 3.12 Enterprise Domain Interfaces

企业域的联邦与供给设计见 [企业域](./modules/15-enterprise/)；SSO 提供方由独立包 `packages/sso` 贡献，此处列两个代表接口，其余（提供方增删改查、SAML ACS/SLO、域名验证）遵循同一注册契约。错误码归属 SSO 扩展命名空间。

#### API-15-01 Register SSO Provider

| 项 | 值 |
|---|---|
| 路径 | `/sso/register` |
| 方法 | POST |
| 身份认证 | 有效会话 + 组织 owner/admin 判定（取证：`packages/sso/src/routes/sso.ts:219`） |

请求体参数（按提供方类型二选一）：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `issuer` | string（URI） | 是 | — | 提供方签发方地址 |
| `domain` | string | 是 | — | 邮箱匹配域 |
| `oidcConfig` | object | 条件 | — | OIDC 提供方配置（clientId、clientSecret、scopes 等） |
| `samlConfig` | object | 条件 | — | SAML 提供方配置（idpMetadata、spMetadata 等） |
| `orgId` | string | 否 | — | 挂载的组织 |

响应：`{ "provider": <提供方记录> }`；非组织 owner/admin 报"组织角色不足"类拒绝。

#### API-15-02 List SSO Providers

| 项 | 值 |
|---|---|
| 路径 | `/sso/providers` |
| 方法 | GET |
| 身份认证 | 有效会话（取证：`packages/sso/src/routes/providers.ts:554`） |

查询参数：

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `providerId` | string | 否 | null | 精确过滤单个提供方 |

响应：当前主体可访问的提供方数组（含解析后的证书信息）；服务端内嵌调用可按 `domain` 做登录前发现。

### 3.13 Reference Domain Interfaces

参考域把运行时契约导出为机器可读文档（边界见 [参考域](./modules/16-reference/)）。

#### API-16-01 Generate OpenAPI Schema

| 项 | 值 |
|---|---|
| 路径 | `/open-api/generate-schema` |
| 方法 | GET |
| 身份认证 | 无（取证：`packages/better-auth/src/plugins/open-api/index.ts:109`） |

无请求参数。响应：覆盖全部已装配端点（含插件贡献）的 OpenAPI 文档 JSON；`SERVER_ONLY` 端点不出现在其中。

#### API-16-02 OpenAPI Reference

| 项 | 值 |
|---|---|
| 路径 | `/reference`（`open-api.path` 可改） |
| 方法 | GET |
| 身份认证 | 无 |

无请求参数。响应：渲染参考页的 HTML；`disableDefaultReference` 开启时报 404。

### 3.14 Server Embedded Invocation

服务端代码不经 HTTP 也能调用全部端点：装配产物 `auth.api.<端点键>` 把每个端点包装为同名方法，签名统一为：

```ts
// 服务端内嵌调用契约（取证：packages/better-auth/src/api/to-auth-endpoints.ts:74-118）
interface EmbeddedCall {
  body?: unknown;              // 端点 body 模式校验后的入参
  headers?: Headers;           // 以请求头身份参与校验与会话解析
  query?: unknown;             // 端点 query 模式入参
  returnHeaders?: boolean;     // true 时返回 { headers, response }
  asResponse?: boolean;        // true 时返回原始 Response
}

// 形态：auth.api.signInEmail({ body: { email, password } })
```

两条入口共用同一条钩子管线：HTTP 路由与 `auth.api.*` 都经 `toAuthEndpoints` 包装、落入 `dispatchAuthEndpoint`，before 与 after 钩子时序完全一致（管线时序见 [端点路由域](./modules/02-endpoint/#24-flow)）。这意味着扩展的拦截与加工在两条入口上行为相同——服务端调用同样会被限流钩子、封禁检查命中。

关键边界：**直接以裸函数调用端点处理器会刻意跳过钩子**。源码注释明确"把端点当普通函数调用会故意绕过钩子；`dispatchAuthEndpoint` 是重新进入管线的受支持方式"（取证：`packages/better-auth/src/api/dispatch.ts:309-322`）。插件确需在流程中途重入管线（如登录后续跑 `/oauth2/authorize`）时必须走该分派器，而不是手调处理器。

动态 `baseURL` 部署下，服务端内嵌调用须传 `headers: request.headers`（或配置 `baseURL.fallback`），否则装配无法解析出本次调用的来源，直接抛内部错误。

### 3.15 Server Only Endpoint Inventory

`createAuthEndpoint.serverOnly` 声明的端点带 `SERVER_ONLY` 元数据：不进 HTTP 路由（HTTP 访问其路径返回 404）、不出现在 OpenAPI 导出，只能经 `auth.api.<键>` 服务端调用（机制见 [端点路由域](./modules/02-endpoint/#22-capability-inventory)）。框架内置的 server-only 端点清单：

| 名称 | 来源 | 用途 |
|---|---|---|
| `setPassword` | `packages/better-auth/src/api/routes/update-user.ts:325` | 为无口令主体补设口令；已有口令报 `PASSWORD_ALREADY_SET` |
| `addMember` | `packages/better-auth/src/plugins/organization/routes/crud-members.ts:45` | 绕过邀请直加组织成员；自身不做权限检查，调用方负责授权 |
| `viewBackupCodes` | `packages/better-auth/src/plugins/two-factor/backup-codes/index.ts:552` | 按 userId 读备份码 |
| `generateTOTP` | `packages/better-auth/src/plugins/two-factor/totp/index.ts:117` | 生成 TOTP 密钥与 otpauth URI |
| `createVerificationOTP` | `packages/better-auth/src/plugins/email-otp/routes.ts:192` | 为邮箱签发 OTP |
| `getVerificationOTP` | `packages/better-auth/src/plugins/email-otp/routes.ts:253` | 读取邮箱当前 OTP |
| `signJWT` | `packages/better-auth/src/plugins/jwt/index.ts:286` | 以可覆盖选项签发 JWT |
| `verifyJWT` | `packages/better-auth/src/plugins/jwt/index.ts:310` | 校验 JWT 并返回载荷 |

这八个端点是"系统主体"与"服务端内嵌调用"两类非浏览器调用方的合法通道：它们跳过会话中间件语义或自带专属中间件（如 `setPassword` 用敏感会话、`addMember` 无会话要求），因此只能暴露给可信服务端代码。

### 3.16 Rate Limiting

限流在业务逻辑之前最后执行（先来源校验后限流，顺序见 [守卫域](./modules/07-guard/#70-key-decisions)）。默认规则两级：**专属规则**按路径前缀匹配，命中即整条生效；未命中落**兜底规则**（取证：`packages/better-auth/src/api/rate-limiter/index.ts:440-468`；兜底默认值 `window: 10`、`max: 100`、生产环境默认开启，取证：`packages/better-auth/src/context/create-context.ts:357-363`）。

| 规则 | 匹配路径 | 窗口（秒） | 上限（次） |
|---|---|---|---|
| 登录注册改密类 | `/sign-in*`、`/sign-up*`、`/change-password`、`/change-email` | 10 | 3 |
| 重置与验证邮件类 | `/request-password-reset`、`/send-verification-email`、`/forget-password*`、`/email-otp/send-verification-otp`、`/email-otp/request-password-reset` | 60 | 3 |
| 兜底 | 其余全部路径 | 10 | 100 |

补充约定：

- 计数键为 `IP|路径`；解析不出客户端 IP 时失败关闭，落共享桶 `no-trusted-ip|<路径>` 继续限流，绝不放行（取证：`packages/better-auth/src/api/rate-limiter/index.ts:336-360`）。
- 优先级：插件专属规则 > 框架专属规则 > 兜底规则；`rateLimit.customRules` 命中的路径可覆盖或以 `false` 豁免。
- 超限响应固定为 429，响应体 `{ "message": "Too many requests. Please try again later." }`，附 `X-Retry-After` 头（秒数，窗口剩余时间向上取整）；重试语义见 [错误码](./errors/#54-retry-semantics)。
- 存储策略：默认内存计数（进程内 Map，容量上限 100000 条），可选数据库存储（建 `RateLimit` 表，见 [数据字典](./data/#75-ratelimit-限流计数)）或二级存储；计数消费为单步原子判定，避免并发请求全部越过旧读数。
