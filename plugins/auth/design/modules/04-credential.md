---
title: 凭证域
description: 密钥材料的校验与强度策略：口令散列、长度策略与等时失败保护。
sidebar:
  order: 6
  label: 凭证域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 4. Credential

凭证域负责校验用户持有的密钥材料并维护其存储与强度策略。与相邻模块的分界是：它不管理主体档案（身份域），不签发会话（会话域）；它只回答"这份密钥材料是否有效、强度是否达标、以何种形式存储"。

### 4.0 Key Decisions

| 决策 | 理由 | 违反后果 |
|---|---|---|
| **等时失败**：账号不存在时仍执行一次等价散列运算，返回与"口令错误"相同的错误码 | 响应时长与错误码都是账号存在性的侧信道 | 攻击者可批量探测已注册邮箱 |
| **散列算法可替换、存储格式自描述**：默认散列封装为 `hash`/`verify` 两个函数注入，存储值为 `salt:key` 字符串 | 算法升级时旧值仍可校验，新值用新算法写入 | 算法轮换需要全量重置用户口令 |
| **长度校验在散列之前**：超长输入直接拒绝 | 散列是昂贵操作，超长输入是廉价拒绝点 | 攻击者用超长口令消耗散列算力（DoS 放大） |
| **口令重置在事务内完成**：核销重置令牌、（可选）吊销全部会话、写入新凭证三步一个事务 | 中断会产生"令牌已核销但口令未变"或反之的半状态 | 用户口令被改但旧会话仍有效，或令牌可重复使用 |

### 4.1 Responsibility Boundary

本域拥有：口令散列与校验、最小/最大长度策略（默认 8/128）、口令重置令牌的核销时序、凭证记录（`Account` 表中 `providerId: "credential"` 的行）的创建与更新。本域不拥有：口令泄露库比对（haveibeenpwned 扩展以散列包装器接入）、登录尝试限流（守卫域）、会话签发。

### 4.2 Capability Inventory

- 散列：默认 scrypt（参数 N=16384、r=16、p=1、dkLen=64，16 字节十六进制盐，口令先做 NFKC 规范化），输出 `salt:key` 十六进制串；Node/Bun/Deno 走原生实现，其他运行时走纯 JS 回退。
- 校验：`verify({ hash, password })` 返回布尔；校验失败统一报 `INVALID_EMAIL_OR_PASSWORD`。
- 长度策略：`PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG` 在散列前判定。
- 自定义散列：`emailAndPassword.password.hash` / `password.verify` 整体替换默认实现。
- 口令重置：`POST /request-password-reset` 签发重置链接（令牌默认 3600 秒有效）；`POST /reset-password` 核销令牌并落新口令，可选吊销全部会话（`revokeSessionsOnPasswordReset`，默认否）；重置后回调 `onPasswordReset`。
- 凭证账号：口令存于凭证账号行；`setPassword`（服务端专用）为无口令账号补设口令；已设口令再设报 `PASSWORD_ALREADY_SET`。

### 4.3 Contract

```ts
// 凭证校验契约（取证：packages/better-auth/src/context/create-context.ts:371-379）
interface PasswordCapability {
  hash(password: string): Promise<string>;
  verify(data: { hash: string; password: string }): Promise<boolean>;
  config: { minPasswordLength: number; maxPasswordLength: number }; // 默认 8 / 128
  checkPassword(password: string): { success: true } | { success: false; code: "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" };
}

// 凭证账号行（取证：packages/core/src/db/schema/account.ts:10-36）
interface CredentialAccount {
  userId: string;
  providerId: "credential";
  accountId: string;      // 等于 userId
  password: string | null; // input:false returned:false，永不出现在响应
}
```

### 4.4 Flow

以下伪代码表达口令登录校验与重置的失败分支（取证：`packages/better-auth/src/api/routes/sign-in.ts:541-561`、`packages/better-auth/src/utils/password.ts:40-64`）。

```ts
async function verifySignInCredential(ctx: AuthContext, email: string, password: string): Promise<User> {
  const user = await identity.findUserWithAccounts(email.toLowerCase());
  if (!user) {
    // 等时失败：账号不存在也执行一次散列，再抛同一错误码
    await ctx.password.hash(password);
    throw apiError("INVALID_EMAIL_OR_PASSWORD");
  }
  const credential = user.accounts.find((a) => a.providerId === "credential");
  if (!credential) {
    await ctx.password.hash(password);
    throw apiError("INVALID_EMAIL_OR_PASSWORD");
  }
  const ok = await ctx.password.verify({ hash: credential.password!, password });
  if (!ok) throw apiError("INVALID_EMAIL_OR_PASSWORD");
  return user.user;
}

async function resetPassword(ctx: AuthContext, token: string, newPassword: string): Promise<void> {
  ctx.password.checkPassword(newPassword); // 长度不达标在散列前拒绝
  // 事务内三步：核销令牌 → 吊销会话（可选）→ 写入新口令；任一步失败整体回滚
  await storage.transaction(async (trx) => {
    await verification.consume(trx, token); // 原子核销，重复提交只有一方成功
    if (ctx.options.revokeSessionsOnPasswordReset) {
      await trx.deleteMany({ model: "session", where: [{ field: "userId", value: userId }] });
    }
    await trx.update({ model: "account", where: credentialWhere, update: { password: await ctx.password.hash(newPassword) } });
  });
  await ctx.options.onPasswordReset?.({ user });
}
```

### 4.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| A1 | 已注册用户 | 用正确口令登录 | 校验通过，签发会话 |
| A2 | 已注册用户 | 用错误口令登录 | 返回 `INVALID_EMAIL_OR_PASSWORD` |
| A3 | 未注册邮箱 | 用任意口令登录 | 同样返回 `INVALID_EMAIL_OR_PASSWORD`，响应时长与 A2 同量级 |
| A4 | 长度 4 的新口令 | 调用重置 | 拒绝并返回 `PASSWORD_TOO_SHORT`，不产生散列开销 |
| A5 | 有效重置令牌 | 调用 `POST /reset-password` 两次（同令牌） | 第一次成功；第二次返回令牌无效（原子核销） |
| A6 | `revokeSessionsOnPasswordReset` 开启 | 重置口令成功 | 全部旧会话失效 |
