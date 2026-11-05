---
title: 会话域
description: 认证状态的唯一载体：签发、校验、续期、吊销与会话凭据的安全送达。
sidebar:
  order: 5
  label: 会话域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 3. Session

会话域负责把"已认证"这一状态物化为可校验、可续期、可吊销的记录，并把凭据安全送达客户端。与相邻模块的分界是：它不判定主体权限（权限矩阵见 [权限与多主体](../permissions/)），不创建主体档案（身份域职责）；它只回答"这次请求是否来自一个有效会话，会话还有多久过期，如何让它立即失效"。

### 3.0 Key Decisions

| 决策 | 理由 | 违反后果 |
|---|---|---|
| **先落库后分发**：会话先写入权威存储，成功后才下发凭据 | 分发后凭据即可独立使用，落库失败再分发会产生"幽灵会话" | 存储抖动时客户端持有一个服务端不认识的令牌，后续请求全部失败且无法解释 |
| **敏感操作读权威源**：吊销、改密等端点强制绕过客户端缓存的会话副本 | 缓存副本在吊销后仍可用，形成吊销逃逸窗口 | 被吊销的会话在缓存有效期内继续通过敏感操作 |
| **续期节流**：距上次写入不足 `updateAge`（默认 86400 秒）不回写 | 高频请求每次回写会把存储打满 | 每次请求一次写放大，存储成为瓶颈 |
| **过期即删**：读到已过期的会话直接删除记录并清除凭据 | 过期记录堆积无业务价值，且可能被误判为有效 | 存储被过期记录填满；客户端拿到过期会话后行为不定 |
| **会话记录标识与凭据分离**：记录 `id` 由服务端生成且忽略外部指定，`token` 为 32 位随机值 | 外部指定 id 会造成主键冲突或注入既知标识 | 攻击者可预置标识形成会话固定 |

### 3.1 Responsibility Boundary

本域拥有：会话记录的创建/读取/续期/删除、会话凭据（Cookie）的签发与清除、缓存副本（会话数据 Cookie）的封装与校验、`expiresIn`/`updateAge`/`freshAge` 语义、二级存储下的活跃会话索引与批量吊销水位。本域不拥有：会话上的组织上下文字段（组织域以表贡献追加）、登录方式的判定、凭据校验。

### 3.2 Capability Inventory

- 签发：`createSession(userId, dontRememberMe)` —— 记录含 `id`、`token`、`userId`、`expiresAt`、`ipAddress`、`userAgent`、`createdAt`、`updatedAt`；`dontRememberMe` 时有效期缩至 1 天且凭据为会话级 Cookie（不设 `maxAge`），并额外下发 `dont_remember` 标记 Cookie。
- 校验：`GET|POST /get-session` —— 三种来源按优先级合成：权威存储、缓存副本（`session_data` 签名 Cookie，默认 `compact` 策略：base64url + HMAC；可选 `jwt`/`jwe` 策略）、无存储部署下的纯凭据信任。
- 续期：距过期剩余不足 `expiresIn - updateAge` 时回写 `expiresAt` 并重发凭据；`disableSessionRefresh`、查询参数 `disableRefresh`、`deferSessionRefresh`（GET 只读返回 `needsRefresh`，POST 执行刷新）可抑制。
- 新鲜度：`freshSessionMiddleware` 要求会话创建时间在 `freshAge`（默认 86400 秒）内，否则 `SESSION_NOT_FRESH`；`freshAge: 0` 关闭检查。
- 吊销：单会话（`/revoke-session`）、全部（`/revoke-sessions`）、其余（`/revoke-other-sessions`）；敏感端点走 `sensitiveSessionMiddleware` 强制读权威源。
- 中间件族：`sessionMiddleware`（要求有效会话）、`sensitiveSessionMiddleware`（要求权威会话）、`requestOnlySessionMiddleware`（仅浏览器请求要求会话）、`freshSessionMiddleware`（要求新鲜会话）。
- 存储策略：有二级存储时会话默认存二级存储（键为令牌），`storeSessionInDatabase` 镜像入库，`preserveSessionInDatabase` 保留行以审计（结束时置过期而非删除）；无二级存储时存数据库。
- 跨设备：多会话扩展以 `_multi-` 前缀 Cookie 维护每设备凭据，上限默认 5。

### 3.3 Contract

```ts
// 会话记录（取证：packages/core/src/db/schema/session.ts:9-15 与 get-tables.ts:130-195）
interface Session {
  id: string;                       // 服务端生成，外部指定被忽略
  token: string;                    // 32 位随机值，唯一索引
  userId: string;                   // 引用主体，级联删除，建索引
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  impersonatedBy?: string;          // admin 扩展贡献，不入参与返回
  activeOrganizationId?: string;    // organization 扩展贡献
}

// 会话配置（取证：packages/better-auth/src/context/create-context.ts:311-320）
interface SessionConfig {
  expiresIn: number;                // 秒，默认 604800（7 天）
  updateAge: number;                // 秒，默认 86400（1 天），0 表示每次都续期
  freshAge: number;                 // 秒，默认 86400，0 关闭新鲜度检查
}

abstract class SessionAuthority {
  abstract create(userId: string, dontRememberMe: boolean): Promise<Session>;
  abstract find(token: string, opts?: { disableCookieCache?: boolean }): Promise<SessionContext | null>;
  abstract refresh(session: SessionContext): Promise<SessionContext>;
  abstract revoke(token: string): Promise<void>;
  abstract revokeAllForUser(userId: string, exceptToken?: string): Promise<void>;
}
```

### 3.4 Flow

以下伪代码表达会话校验与续期的完整时序，覆盖缓存旁路、过期与刷新抑制分支（取证：`packages/better-auth/src/api/routes/session.ts:290-439`）。

```ts
async function resolveSession(ctx: EndpointContext, query: SessionQuery): Promise<SessionResult | null> {
  // 1. 取候选：有存储的部署默认绕过缓存副本读权威源（disableCookieCache 合并语义为"或"，
  //    调用方强制严格校验不会被查询参数削弱）
  const candidate = await authority.find(ctx.token, {
    disableCookieCache: query.disableCookieCache || isSensitiveEndpoint(ctx),
  });
  if (!candidate) {
    clearSessionCookie(ctx);
    return null; // 无会话：交给端点的中间件决定拒绝方式
  }

  // 2. 过期分支：删除记录 + 清凭据，绝不返回过期会话
  if (candidate.session.expiresAt < new Date()) {
    await authority.revoke(candidate.session.token);
    clearSessionCookie(ctx);
    return null;
  }

  // 3. 刷新抑制分支：禁用刷新、查询参数抑制、不记住我、延迟刷新（GET）都不回写
  const dueAt = candidate.session.expiresAt.getTime() - config.expiresIn * 1000 + config.updateAge * 1000;
  const shouldRefresh = !config.disableRefresh
    && !query.disableRefresh
    && !candidate.dontRemember
    && !config.deferSessionRefresh
    && dueAt <= Date.now();
  if (shouldRefresh) {
    // 续期失败（权威源写入返回空）→ 判定会话已失效，清凭据返回过期错误，不得沿用旧凭据
    const updated = await authority.refresh(candidate);
    if (!updated) {
      clearSessionCookie(ctx);
      throw apiError("FAILED_TO_GET_SESSION");
    }
    setSessionCookie(ctx, updated);
  }
  return candidate;
}
```

失败与恢复：凭据 Cookie 损坏或签名不匹配按"无会话"处理，不抛错（避免给攻击者探测面）；缓存副本过大时按 4050 字节分块（最多 100 块），清除时按名匹配含分块后缀一并清除。

### 3.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| A1 | 已装配存储与邮箱口令 | 登录成功后携带凭据调用 `GET /get-session` | 返回主体与会话档案；记录已落权威存储 |
| A2 | 有效会话 | 调用 `POST /revoke-session` 后再调 `GET /get-session` | 第二次返回空；即使缓存副本 Cookie 仍在也不复活 |
| A3 | 会话距过期剩余超过 `expiresIn - updateAge` | 调用 `GET /get-session` | 权威存储无写入（updatedAt 不变） |
| A4 | 会话距过期剩余不足 `expiresIn - updateAge` | 调用 `GET /get-session` | `expiresAt` 延长，凭据重发 |
| A5 | 有效会话，`freshAge` 默认 | 会话创建超过 1 天后调用 `GET /list-sessions` | 拒绝并返回 `SESSION_NOT_FRESH` |
| A6 | 会话创建时勾选"不记住我" | 关闭浏览器后重开 | 凭据失效（会话级 Cookie）；记录 1 天后过期 |
| A7 | 权威存储不可用 | 携带有效凭据调用 `GET /get-session` | 返回失败码要求重登，不返回缓存副本冒充的有效会话 |
| A8 | 已过期会话记录在库 | 携带其凭据调用 `GET /get-session` | 记录被删除、凭据被清除、返回空 |
