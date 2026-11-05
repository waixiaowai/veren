---
title: 身份
description: 账号、会话、密钥、授权码与机器身份的签发与校验。
sidebar:
  order: 35
  label: 身份 Identity
lastUpdated: 2026-11-05
---

身份模块回答「调用者是谁、能做什么」：它签发人类会话与机器密钥，校验每一次调用，并把权限收敛成一组可枚举的能力。它是外围域——可以由上游网关代管，但自托管形态下它是唯一的安全边界。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 身份负责 | 不负责 |
| --- | --- | --- |
| 租户 | 提供账号、会话、成员绑定 | 组织与环境的业务语义 |
| 全部领域 | 提供已解析的调用上下文 | 资源级判定 |
| 工具链 | 为命令行与智能体签发授权码 | 业务调用 |

## 2. Capabilities

1. 人类账号：邮箱一次性验证码、密码、第三方登录；同一账号可加入多个组织。
2. 会话：服务端会话 + 客户端 Cookie；支持主动登出与全部登出。
3. 机器密钥：秘密密钥按环境签发，明文只在创建时返回一次，存储仅保留哈希与前缀。
4. 可公开密钥：用于浏览器侧只读调用，权限固定为最小集合。
5. 授权码：命令行与智能体使用 PKCE 授权码换取访问令牌，令牌可限定资源与范围。
6. 作用域：按资源与读写组合的能力集合，支持自定义密钥的子集授权。
7. 管理身份：平台管理员与代登录，代登录产生的操作在审计中标注来源。
8. 无密码登录：设备侧通行密钥（Passkey）注册与登录。

## 3. Contracts

```ts
type Scope = `${string}:${"read" | "write"}`;

interface Principal {
  kind: "user" | "machine" | "oauth" | "admin";
  userId?: string;
  orgId: string;
  env: "sandbox" | "live";
  scopes: Scope[];
  keyId?: string;
  impersonatedBy?: string;
}

interface ApiKey {
  id: string;
  prefix: string;
  env: "sandbox" | "live";
  scopes: Scope[];
  createdAt: number;
  lastUsedAt?: number;
}

abstract class IdentityService {
  abstract authenticate(input: { headers: Record<string, string> }): Promise<Principal>;
  abstract issueKey(input: { orgId: string; env: "sandbox" | "live"; scopes: Scope[]; name: string }): Promise<{ key: string; record: ApiKey }>;
  abstract revokeKey(input: { orgId: string; keyId: string }): Promise<void>;
  abstract exchangeCode(input: { code: string; verifier: string; resource?: string }): Promise<{ accessToken: string; scopes: Scope[] }>;
}
```

## 4. Core Flows

### 4.1 Authenticate

认证顺序固定，先机器后人类，任一环节失败即停止并且不回落到更低等级：

```ts
async function authenticate(input: { headers: Record<string, string> }, ctx: IdentityContext): Promise<Principal> {
  const bearer = readBearer(input.headers);
  if (!bearer) throw new AuthError({ code: "AUTH-401-001" });

  if (isSecretKey(bearer)) {
    const record = await ctx.keys.verify(bearer);           // 哈希比对 + 前缀索引
    if (!record) throw new AuthError({ code: "AUTH-401-002" });
    if (record.revokedAt) throw new AuthError({ code: "AUTH-401-003" });
    return { kind: "machine", orgId: record.orgId, env: record.env, scopes: record.scopes, keyId: record.id };
  }
  if (isPublishableKey(bearer)) {
    const org = await ctx.orgs.byPublishableKey(bearer);
    if (!org) throw new AuthError({ code: "AUTH-401-004" });
    return { kind: "machine", orgId: org.id, env: envFromKey(bearer), scopes: PUBLIC_SCOPES };
  }
  if (isOAuthToken(bearer)) return ctx.oauth.resolve(bearer, input.headers);
  return ctx.sessions.fromCookie(input.headers);
}
```

失败分支：密钥正确但已吊销返回专门的吊销码，便于调用方区分「写错」与「被撤销」；环境前缀与请求环境不一致时直接拒绝，不做隐式切换；会话过期返回可续期提示而非泛化 401。

### 4.2 Issue Key

签发一次性返回明文，之后不可再取。作用域不得超过签发者自身拥有的集合，超出即拒绝。签发与吊销都写审计，包含操作者、目标组织、时间与来源地址。

### 4.3 Exchange Code

命令行与智能体走同一套授权码流程：客户端生成挑战，浏览器完成授权，服务端校验挑战后发放访问令牌，令牌带资源限定与范围。令牌过期后需重新授权，不支持静默永久续期。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| IDN-A1 | 密钥认证 | 有效秘密密钥 | 调用任意领域接口 | 认证通过，上下文中环境取自密钥前缀 |
| IDN-A2 | 密钥吊销 | 密钥已吊销 | 调用 | 拒绝，返回 `AUTH-401-003` |
| IDN-A3 | 环境不匹配 | 沙箱密钥访问生产数据 | 调用 | 拒绝，不返回生产数据 |
| IDN-A4 | 越权签发 | 调用者只有只读权限 | 签发写权限密钥 | 拒绝，返回 `AUTH-403-001` |
| IDN-A5 | 可公开密钥 | 使用可公开密钥 | 调用写接口 | 拒绝，仅允许只读白名单接口 |
| IDN-A6 | 授权码重放 | 同一授权码已兑换 | 再兑换一次 | 拒绝，令牌不重复发放 |
