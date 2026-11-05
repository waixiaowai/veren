---
title: 身份域
description: 主体档案、注册流程与外部账号绑定关系的唯一权威。
sidebar:
  order: 7
  label: 身份域
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 5. Identity

身份域负责维护主体档案、注册流程与外部账号绑定关系，是"用户是谁"这一问题的唯一权威。与相邻模块的分界是：它不持有会话（签发交给会话域），不校验口令散列算法本身（交给凭证域）；它只回答"这个邮箱 / 这个外部账号标识对应哪个主体，如何为其建档与绑定"。

### 5.0 Key Decisions

| 决策 | 理由 | 违反后果 |
|---|---|---|
| **绑定先行**：主体解析先按 `(提供方, 账号标识)` 查绑定，命中即直通；邮箱匹配只是回落 | 同一主体换邮箱、两个主体同邮箱时，绑定是比邮箱更强的归属证据 | 按邮箱先查会把两个外部账号并入同一主体，形成账号合并攻击 |
| **孤儿绑定即拒绝**：绑定存在但不归属任何主体时直接拒绝登录 | 孤儿绑定意味着归属数据已损坏，静默重建会掩盖损坏 | 损坏扩散为静默的账号劫持 |
| **隐式绑定设门槛**：邮箱回落绑定要求（提供方受信或邮箱已验证）且（本地邮箱已验证）且（未显式禁用） | 任一条件缺失时，攻击者可用一个邮箱相同但未验证的外部账号认领他人主体 | 账号预注册攻击：先以受害者邮箱注册，等待受害者经第三方登录时接管 |
| **注册与建绑在同一事务**：新用户建档与首绑定的写入在一个事务内 | 中断会产生无绑定的"幽灵用户"或无用户的"孤儿绑定" | 后续登录落入孤儿绑定拒绝分支，用户永久无法登录 |
| **邮箱小写归一**：邮箱在入库与查询前统一小写 | 大小写差异制造重复账号与绕过唯一约束 | 同一邮箱可注册两次 |

### 5.1 Responsibility Boundary

本域拥有：主体档案（`User` 表）、账号绑定（`Account` 表）、校验凭据（`Verification` 表）的读写权、注册流程（邮箱注册与第三方首次授权的建档）、账号绑定与解绑、邮箱变更时序。本域不拥有：会话签发、口令散列算法、组织归属、二次验证档案。

### 5.2 Capability Inventory

- 主体档案：`id`、`name`、`email`（唯一索引、小写归一）、`emailVerified`（默认 false，不参与输入）、`image`（可空）、`createdAt`、`updatedAt`；扩展可经表贡献追加字段（如 `role`、`username`、`phoneNumber`）。
- 邮箱注册：`POST /sign-up/email` —— 长度策略 → 查重（已存在报 `USER_ALREADY_EXISTS`）→ 建档 → 建凭证账号 → （可选）自动登录；`disableSignUp` 时拒绝注册。
- 邮箱校验：`POST /send-verification-email` 签发校验链接（默认 3600 秒）；`GET /verify-email` 核销令牌置位 `emailVerified`；`autoSignInAfterVerification` 可选直接登录。
- 邮箱变更：`POST /change-email` —— 新邮箱签发校验凭据，核销后才切换；变更前后发通知；`changeEmail.enabled` 可关闭（报 `CHANGE_EMAIL_DISABLED`）。
- 账号绑定：`POST /link-social`（要求活跃会话，携带加密的会话令牌进状态值）；`POST /unlink-account` —— 解绑最后一个账号报 `FAILED_TO_UNLINK_LAST_ACCOUNT`（`allowUnlinkingAll` 可放开）。
- 账号列出：`GET /list-accounts` —— 令牌类字段（`accessToken`/`refreshToken`/`idToken` 等）标记 `returned: false` 永不外泄。
- 主体更新：`POST /update-user` —— 扩展贡献的字段在此合并；`validateUserInfo` 钩子可拦截。
- 主体删除：`POST /delete-user` 默认软删（双请求确认），回调路径核销。

### 5.3 Contract

```ts
// 主体档案（取证：packages/core/src/db/schema/user.ts:9-17）
interface User {
  id: string;
  name: string;
  email: string;            // 唯一索引；入库前小写归一
  emailVerified: boolean;   // 默认 false；input:false
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// 账号绑定（取证：packages/core/src/db/schema/account.ts:10-36 与 get-tables.ts:251-341）
interface Account {
  id: string;
  userId: string;           // 引用主体，级联删除，建索引
  providerId: string;       // 提供方标识，如 "credential"、"github"
  accountId: string;        // 外部账号标识，(providerId, accountId) 唯一
  accessToken?: string;     // 以下令牌字段 returned:false
  refreshToken?: string;
  idToken?: string;
  accessTokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string;
  password?: string;        // 仅凭证提供方使用
}

abstract class IdentityAuthority {
  abstract findByEmail(email: string): Promise<{ user: User; accounts: Account[] } | null>;
  abstract findAccountOwner(providerId: string, accountId: string): Promise<User | null>;
  abstract register(input: SignUpInput): Promise<{ user: User }>;         // 事务内建档+凭证
  abstract link(input: LinkInput): Promise<void>;                          // 事务内建绑定
  abstract unlink(userId: string, providerId: string, accountId: string): Promise<void>;
}
```

### 5.4 Flow

以下伪代码表达第三方登录的主体解析时序，覆盖绑定命中、孤儿绑定、邮箱回落与新用户分支（取证：`packages/better-auth/src/oauth2/link-account.ts:196-703`）。

```ts
async function resolveSubject(ctx: AuthContext, input: ExternalIdentity): Promise<ResolveResult> {
  // 1. 绑定先行：按 (providerId, accountId) 查绑定
  const owner = await identity.findAccountOwner(input.providerId, input.accountId);
  if (owner === "orphaned") {
    return { error: "unable to link account" }; // 孤儿绑定：拒绝而非重建
  }
  if (owner) return { user: owner, created: false };

  // 2. 邮箱回落：查找同邮箱主体
  const existing = await identity.findByEmail(input.email.toLowerCase());
  if (existing) {
    // 隐式绑定门槛：三条件全过才允许并入既有主体
    const providerTrusted = trustedProviders.includes(input.providerId) || input.emailVerified;
    const localVerified = existing.user.emailVerified; // requireLocalEmailVerified 默认开
    const linkingEnabled = !ctx.options.accountLinking?.disableImplicitLinking;
    if (providerTrusted && localVerified && linkingEnabled) {
      await identity.link({ ...input, userId: existing.user.id });
      return { user: existing.user, created: false };
    }
    return { error: "account not linked" }; // 门槛不过：拒绝并入
  }

  // 3. 新用户：建档与首绑定同一事务；注册被禁用时拒绝
  if (signUpDisabled) return { error: "signup disabled" };
  return await storage.transaction(async (trx) => {
    const user = await trx.create({ model: "user", data: profile });
    await trx.create({ model: "account", data: { ...binding, userId: user.id } });
    return { user, created: true };
  });
}
```

失败与恢复：事务中断无半状态（铁律 4）；绑定冲突（同一外部账号已归属他人）返回 `account_already_linked_to_different_user`；邮箱变更沿用校验凭据原子核销，重复点击只有一方生效。

### 5.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
|---|---|---|---|
| A1 | 邮箱已注册且本地邮箱已验证 | 用已验证同邮箱的外部账号首次登录 | 并入既有主体（隐式绑定），登录成功 |
| A2 | 本地邮箱未验证 | 用已验证同邮箱的外部账号首次登录 | 拒绝并入，返回 `account not linked` |
| A3 | 外部账号已绑定主体甲 | 同一外部账号再尝试绑定到主体乙 | 返回 `account_already_linked_to_different_user` |
| A4 | 孤儿绑定存在 | 用该外部账号登录 | 拒绝登录，报无法绑定；不静默重建 |
| A5 | 全新外部账号 | 首次登录（注册开启） | 主体与绑定同事务建立；中断后无半状态 |
| A6 | 主体只有一个绑定 | 调用 `POST /unlink-account` | 返回 `FAILED_TO_UNLINK_LAST_ACCOUNT` |
| A7 | 大小写混合邮箱 | 两次以不同大小写注册 | 第二次报 `USER_ALREADY_EXISTS`（小写归一） |
