---
title: 错误码与状态模型
description: 全局错误码表：基础码 49 个按八类归档，扩展码按贡献命名空间隔离。
sidebar:
  order: 21
  label: 错误码
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 5. Error Codes

错误码分两层：**基础码**由诊断域统一定义（取证：`packages/core/src/error/codes.ts:17-71`，共 **49 个**），全部接口只引用不重定义；**扩展码**由各扩展以 `$ERROR_CODES` 贡献自己的命名空间（如 `ORGANIZATION_NOT_FOUND`、`INVALID_OTP`），不得与基础集合重名。错误以 `APIError.from(status, { code, message })` 形态抛出，响应体携带 `code` / `message` / `status`（取证：`packages/core/src/error/index.ts:36-53`）。状态枚举与转移约束见 [状态模型](./states/)。

### 5.1 Error Code Table

下表列基础码全部 49 项。列：码、含义、触发条件、是否可重试、用户可见文案、归属模块。

| 码 | 含义 | 触发条件 | 可重试 | 归属 |
|---|---|---|---|---|
| `USER_NOT_FOUND` | 主体不存在 | 按标识查主体未命中 | 否 | identity |
| `FAILED_TO_CREATE_USER` | 建档失败 | 注册事务失败 | 是 | identity |
| `FAILED_TO_UPDATE_USER` | 更新主体失败 | 资料更新写入失败 | 是 | identity |
| `INVALID_USER` | 主体非法 | 主体校验钩子拒绝 | 否 | identity |
| `USER_ALREADY_EXISTS` | 主体已存在 | 注册邮箱查重命中 | 否 | identity |
| `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` | 换邮箱注册 | 同上（变体文案） | 否 | identity |
| `USER_EMAIL_NOT_FOUND` | 邮箱未登记 | 按邮箱查主体未命中 | 否 | identity |
| `USER_ALREADY_HAS_PASSWORD` | 已设口令 | 无旧口令确认删除账号 | 否 | identity |
| `FIELD_NOT_ALLOWED` | 字段不可设 | 写入不受支持的附加字段 | 否 | identity |
| `FAILED_TO_UNLINK_LAST_ACCOUNT` | 不能解绑最后账号 | 解绑后账号数为零 | 否 | identity |
| `ACCOUNT_NOT_FOUND` | 绑定不存在 | 按提供方与标识查绑定未命中 | 否 | identity |
| `LINKED_ACCOUNT_ALREADY_EXISTS` | 绑定已存在 | 同 `(providerId, accountId)` 重复绑定 | 否 | identity |
| `SOCIAL_ACCOUNT_ALREADY_LINKED` | 社交绑定已存在 | 第三方账号已归属他主体 | 否 | identity |
| `INVALID_EMAIL` | 邮箱非法 | 邮箱格式校验失败 | 否 | credential |
| `INVALID_EMAIL_OR_PASSWORD` | 邮箱或口令错误 | 凭据校验失败（等时失败统一码） | 否 | credential |
| `INVALID_PASSWORD` | 口令错误 | 服务端口令核对失败 | 否 | credential |
| `PASSWORD_TOO_SHORT` | 口令过短 | 低于最小长度（默认 8） | 否 | credential |
| `PASSWORD_TOO_LONG` | 口令过长 | 超过最大长度（默认 128） | 否 | credential |
| `CREDENTIAL_ACCOUNT_NOT_FOUND` | 凭证账号不存在 | 口令登录但无凭证行 | 否 | credential |
| `PASSWORD_ALREADY_SET` | 口令已设置 | 已有口令再调补设口令 | 否 | credential |
| `FAILED_TO_CREATE_SESSION` | 建会话失败 | 会话写入失败 | 是 | session |
| `FAILED_TO_GET_SESSION` | 读会话失败 | 会话解析失败或续期写回失败 | 是 | session |
| `SESSION_NOT_FRESH` | 会话不新鲜 | 会话创建时间超出 `freshAge` | 否（重认证后可） | session |
| `SESSION_EXPIRED` | 会话已过期 | 凭据对应的会话已过期（敏感端点语境） | 否（重登后可） | session |
| `INVALID_TOKEN` | 令牌无效 | 校验令牌核销失败 | 否 | identity |
| `TOKEN_EXPIRED` | 令牌过期 | 校验令牌超过有效期 | 否（重发后可） | identity |
| `FAILED_TO_CREATE_VERIFICATION` | 建校验凭据失败 | 校验凭据写入失败 | 是 | identity |
| `VERIFICATION_EMAIL_NOT_ENABLED` | 校验邮件未开启 | 未配置发信回调却触发发信 | 否 | identity |
| `EMAIL_NOT_VERIFIED` | 邮箱未验证 | 强校验开启时未验证主体登录/操作 | 否（验证后可） | identity |
| `EMAIL_ALREADY_VERIFIED` | 邮箱已验证 | 重复校验 | 否 | identity |
| `EMAIL_MISMATCH` | 邮箱不匹配 | 变更邮箱新旧不一致且未放开 | 否 | identity |
| `EMAIL_CAN_NOT_BE_UPDATED` | 邮箱不可变更 | 变更被禁用或前置不满足 | 否 | identity |
| `CHANGE_EMAIL_DISABLED` | 变更邮箱被禁用 | `changeEmail.enabled: false` | 否 | identity |
| `ID_TOKEN_NOT_SUPPORTED` | 不支持断言登录 | 提供方未启用断言直登 | 否 | oauth |
| `PROVIDER_NOT_FOUND` | 提供方未配置 | 请求的提供方不在装配中 | 否 | oauth |
| `FAILED_TO_GET_USER_INFO` | 获取资料失败 | 提供方资料接口失败或无邮箱 | 是 | oauth |
| `INVALID_ORIGIN` | 来源非法 | 来源头不在受信表 | 否 | guard |
| `MISSING_OR_NULL_ORIGIN` | 来源缺失 | 来源头缺失或为 null | 否 | guard |
| `INVALID_CALLBACK_URL` | 回调地址非法 | 回调地址不在受信表 | 否 | guard |
| `INVALID_REDIRECT_URL` | 跳转地址非法 | 跳转地址不在受信表 | 否 | guard |
| `INVALID_ERROR_CALLBACK_URL` | 错误回调非法 | 错误回调地址不在受信表 | 否 | guard |
| `INVALID_NEW_USER_CALLBACK_URL` | 新用户回调非法 | 同上（新用户变体） | 否 | guard |
| `CALLBACK_URL_REQUIRED` | 缺少回调地址 | 流程要求回调地址但未提供 | 否 | guard |
| `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED` | 跨站导航登录被拦 | Fetch Metadata 判定为跨站导航 | 否 | guard |
| `VALIDATION_ERROR` | 校验错误 | 请求体/查询未通过模式校验 | 否 | endpoint |
| `MISSING_FIELD` | 缺少必填字段 | 必填字段缺失 | 否 | endpoint |
| `BODY_MUST_BE_AN_OBJECT` | 体必须为对象 | 请求体不是对象 | 否 | endpoint |
| `ASYNC_VALIDATION_NOT_SUPPORTED` | 不支持异步校验 | 模式校验回调为异步 | 否 | endpoint |
| `METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED` | 方法不允许 | POST 刷新未开启延迟刷新配置 | 否 | session |

### 5.2 Extension Error Code Namespaces

扩展码按贡献扩展的命名空间隔离，语义详见对应模块章：

| 命名空间 | 归属扩展 | 示例 |
|---|---|---|
| `ORGANIZATION_*` / `YOU_*` / `MEMBER_*` / `ROLE_*` / `INVITATION_*` | organization | `ORGANIZATION_NOT_FOUND`、`USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION`、`ROLE_NOT_FOUND` |
| `ADMIN_*` 语境 / `YOU_ARE_NOT_ALLOWED_*` | admin | `YOU_CANNOT_BAN_YOURSELF`、`YOU_ARE_NOT_ALLOWED_TO_CREATE_USERS` |
| `TWO_FACTOR` 语境 | two-factor | `TOTP_NOT_ENABLED`、`INVALID_BACKUP_CODE`、`ACCOUNT_TEMPORARILY_LOCKED` |
| `OTP_*` / `INVALID_OTP` | email-otp、phone-number | `OTP_EXPIRED`、`TOO_MANY_ATTEMPTS` |
| `DEVICE_*` 语境 | device-authorization | `AUTHORIZATION_PENDING`、`POLLING_TOO_FREQUENTLY`、`ACCESS_DENIED` |
| `POPUP_*` | oauth-popup | `POPUP_BLOCKED`、`POPUP_TIMEOUT` |
| 用户名/手机号 | username、phone-number | `USERNAME_IS_ALREADY_TAKEN`、`PHONE_NUMBER_EXIST` |

### 5.3 Error Response Shape

| 项 | 值 |
|---|---|
| HTTP 状态 | `APIError` 状态名映射（`UNAUTHORIZED` 401、`FORBIDDEN` 403、`BAD_REQUEST` 400、`NOT_FOUND` 404、`TOO_MANY_REQUESTS` 429、`INTERNAL_SERVER_ERROR` 500） |
| 响应体 | `{ "code": "错误码", "message": "文案", "status": HTTP 状态数字 }` |
| 限流特例 | 429 响应体为 `{ "message": "Too many requests. Please try again later." }`，附 `X-Retry-After` 头 |
| 内嵌调用 | 抛出 `APIError` 实例，`isAPIError` 可判定；`$ERROR_CODES` 聚合全部码供客户端做错误文案映射 |

### 5.4 Retry Semantics

可重试失败（存储抖动类，5.1 表中"可重试 = 是"）的客户端策略：指数退避后原样重发；不可重试失败（凭据、来源、状态类）重发无意义，须修正输入或走恢复流程（重发校验邮件、重置口令、重新登录）。429 的重试时间以 `X-Retry-After` 头为准。
