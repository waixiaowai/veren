---
title: 数据字典
description: 关键实体的字段级定义：类型、必填性、取值、默认值、归属与可见性。
sidebar:
  order: 23
  label: 数据字典
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 7. Data Dictionary

本字典集中列出关键实体的字段：字段标识、类型、必填性、取值或格式、默认值、归属与可见性。模块契约引用本字典，不重复定义；同一字段在不同模块中的类型与必填性以此为准。字段三项开关的含义：`required`（写入时必填）、`input`（外部可写入，`false` 为服务端专属）、`returned`（可出现在响应，`false` 为永不外泄）。

### 7.1 User 主体

| 字段 | 类型 | 必填 | 默认值 | 约束 | 可见性 |
|---|---|---|---|---|---|
| `id` | string（或 serial） | 条件 | 生成器 | 主键；外部指定被忽略 | 全可读 |
| `name` | string | 是 | — | 可排序 | 全可读 |
| `email` | string | 是 | — | 唯一索引；入库前小写归一；可排序 | 全可读 |
| `emailVerified` | boolean | 是 | `false` | — | `input: false`（仅经校验流程置位） |
| `image` | string | 否 | null | URL | 全可读 |
| `createdAt` / `updatedAt` | date | 是 | now | `updatedAt` 自动更新 | 全可读 |

扩展贡献字段（`input`/`returned` 随扩展声明）：`role`（admin）、`banned`/`banReason`/`banExpires`（admin）、`isAnonymous`（anonymous）、`username`/`displayUsername`（username）、`phoneNumber`/`phoneNumberVerified`（phone-number）、`lastLoginMethod`（last-login-method）。

### 7.2 Session 会话

| 字段 | 类型 | 必填 | 默认值 | 约束 | 可见性 |
|---|---|---|---|---|---|
| `id` | string | 条件 | 生成器 | 主键；服务端生成，外部指定被忽略 | 全可读 |
| `token` | string | 是 | 32 位随机 | 唯一索引 | 全可读 |
| `userId` | string | 是 | — | 引用主体，级联删除，建索引 | 全可读 |
| `expiresAt` | date | 是 | 按策略（7 天 / 不记住我 1 天） | — | 全可读 |
| `ipAddress` | string | 否 | 请求解析结果或空 | — | 全可读 |
| `userAgent` | string | 否 | 请求头或空 | — | 全可读 |
| `createdAt` / `updatedAt` | date | 是 | now | — | 全可读 |
| `impersonatedBy` | string | 否 | — | admin 冒充时写入 | `input: false`；list 端点对被冒充者过滤 |
| `activeOrganizationId` | string | 否 | — | organization 激活组织 | `input: false` |
| `activeTeamId` | string | 否 | — | organization 激活团队（可选） | `input: false` |

### 7.3 Account 账号绑定

| 字段 | 类型 | 必填 | 默认值 | 约束 | 可见性 |
|---|---|---|---|---|---|
| `id` | string | 条件 | 生成器 | 主键 | 全可读 |
| `userId` | string | 是 | — | 引用主体，级联删除，建索引 | 全可读 |
| `providerId` | string | 是 | — | 如 `credential`、`github` | 全可读 |
| `accountId` | string | 是 | — | `(providerId, accountId)` 唯一 | 全可读 |
| `accessToken` | string | 否 | — | OAuth 访问令牌；可加密存储 | `returned: false` |
| `refreshToken` | string | 否 | — | 刷新令牌；可加密存储 | `returned: false` |
| `idToken` | string | 否 | — | 身份断言 | `returned: false` |
| `accessTokenExpiresAt` | date | 否 | — | — | `returned: false` |
| `refreshTokenExpiresAt` | date | 否 | — | — | `returned: false` |
| `scope` | string | 否 | — | 逗号分隔授权范围 | 全可读 |
| `password` | string | 否 | — | 仅凭证提供方；散列值 | `returned: false` |
| `createdAt` / `updatedAt` | date | 是 | now | — | 全可读 |

### 7.4 Verification 校验凭据

| 字段 | 类型 | 必填 | 默认值 | 约束 | 可见性 |
|---|---|---|---|---|---|
| `id` | string | 条件 | 生成器 | 主键 | 服务端 |
| `identifier` | string | 是 | — | 唯一索引；可哈希存储（`storeIdentifier`） | 服务端 |
| `value` | string | 是 | — | 载荷（JSON 或令牌）；可哈希/加密存储 | 服务端 |
| `expiresAt` | date | 是 | 按流程（默认 3600 秒） | 过期即无效 | 服务端 |
| `createdAt` / `updatedAt` | date | 是 | now | — | 服务端 |

### 7.5 RateLimit 限流计数

| 字段 | 类型 | 必填 | 默认值 | 约束 | 可见性 |
|---|---|---|---|---|---|
| `key` | string | 是 | — | 唯一索引；`${ip}|${path}` | 服务端 |
| `count` | number | 是 | 0 | 原子自增 | 服务端 |
| `lastRequest` | number | 是 | `Date.now()` | 窗口起点判定（bigint） | 服务端 |

仅当限流存储选 `database` 时建表；内存与二级存储策略下无此表。

### 7.6 Organization 组织

| 字段 | 类型 | 必填 | 默认值 | 约束 | 可见性 |
|---|---|---|---|---|---|
| `id` | string | 条件 | 生成器 | 主键 | 成员可读 |
| `name` | string | 是 | — | — | 成员可读 |
| `slug` | string | 是 | — | 全局唯一 | 成员可读 |
| `logo` | string | 否 | null | URL | 成员可读 |
| `createdAt` / `updatedAt`（`metadata`） | date | 是 | now | — | 成员可读 |

### 7.7 Member 组织成员

| 字段 | 类型 | 必填 | 默认值 | 约束 | 可见性 |
|---|---|---|---|---|---|
| `id` | string | 条件 | 生成器 | 主键 | 组织内可读 |
| `organizationId` | string | 是 | — | 引用组织，级联删除 | 组织内可读 |
| `userId` | string | 是 | — | `(organizationId, userId)` 唯一 | 组织内可读 |
| `role` | string | 是 | `creatorRole`（默认 `owner`） | 逗号分隔多角色列表 | 组织内可读 |
| `teamId` | string | 否 | — | 团队作用域（teams 开启时） | 团队内可读 |
| `createdAt` | date | 是 | now | — | 组织内可读 |

### 7.8 Invitation 组织邀请

| 字段 | 类型 | 必填 | 默认值 | 约束 | 可见性 |
|---|---|---|---|---|---|
| `id` | string | 条件 | 生成器 | 主键 | 被邀方与组织内可读 |
| `organizationId` | string | 是 | — | 引用组织，级联删除 | 同上 |
| `email` | string | 是 | — | 被邀方邮箱 | 同上 |
| `role` | string | 是 | `member` | 逗号分隔 | 同上 |
| `status` | string | 是 | `pending` | 枚举 `pending`/`accepted`/`rejected`/`canceled` | 同上 |
| `inviterId` | string | 是 | — | 邀请人 | 同上 |
| `expiresAt` | date | 是 | 按策略 | 过期由清理移除 | 同上 |
| `teamId` | string | 否 | — | 团队邀请 | 同上 |

### 7.9 Supporting Entities

| 实体 | 关键字段 | 约束 |
|---|---|---|
| `Team` | `id`、`name`、`organizationId`、`createdAt` | `(organizationId, slug)` 唯一 |
| `TeamMember` | `teamId`、`userId` | `(teamId, userId)` 唯一 |
| `OrganizationRole` | `id`、`role`、`organizationId`、`permission` | 动态角色开关开启时建表 |
| `TwoFactor` | `id`、`userId`（唯一）、`secret`、`backupCodes`、`verified`、`failedVerificationCount`、`lockedUntil` | `userId` 唯一；`verified` 默认 true 以兼容存量行 |
| `DeviceCode` | `deviceCode`（唯一）、`userCode`（唯一）、`userId?`、`expiresAt`、`status`、`lastPolledAt`、`pollingInterval`、`clientId`、`scope` | 落库状态仅 `pending`/`approved`/`denied` |
| `WalletAddress` | `userId`、`address`、`chainId`、`isPrimary`、`createdAt` | `(userId, address)` 唯一 |
| `Jwks` | `publicKey`、`privateKey`、`createdAt`、`expiresAt`、`alg`、`crv` | 私钥加密存储 |

### 7.10 Ownership and Visibility Summary

| 实体 | 归属主体 | 默认查询范围 | 越权失败码 |
|---|---|---|---|
| `User` | 主体自身 | 自身行 | `UNAUTHORIZED` |
| `Session` | 主体自身 | 自身会话 | `UNAUTHORIZED` |
| `Account` | 主体自身 | 自身绑定 | `ACCOUNT_NOT_FOUND` |
| `Organization` / `Member` / `Invitation` | 组织 | 活跃组织 | `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` |
| `Verification` / `RateLimit` / `Jwks` | 服务端 | 不外泄 | — |
