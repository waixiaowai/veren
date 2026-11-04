---
title: 身份
description: "把一次请求还原为某个用户以某个身份行动，签发与撤销会话、连接票据与邀请凭据，并决定登录失败时对外只说一句话。"
sidebar:
  order: 6
  label: 6 身份
draft: false
lastUpdated: 2026-11-04
---

## 6. Identity

身份模块回答"这条请求是谁发的"。它保存用户、身份绑定与凭据摘要，签发会话令牌、一次性连接票据与邀请令牌，并在登出、停用、删号时让凭据立刻失效。它不判断这个人能看哪个工作区，也不判断他是不是管理员，那些属于 [工作区](./workspace/)；它只保证认出来的这个人是可信的，认不出来时对外只有一种说法。

### 6.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 用户记录、邮箱规范化与验证状态 | 成员角色、席位与档位（`Workspace`） |
| 身份绑定（提供方加外部主体）与跨提供方关联 | 租户解析与工作区头的校验（`Workspace`） |
| 会话令牌的签发、校验、空闲滑窗、登出与停用清空 | 设备凭据与运行时令牌（`Host`） |
| 一次性连接票据的铸造与单次消费 | 长连建立、帧路由与在线状态（`Realtime`） |
| 登录流程的 state、回跳白名单与失败折叠 | 邀请的状态机、席位校验与接受（`Workspace`） |
| 账号删除的软删标记与 PII 清理 | 推送设备注册与注销（`Realtime`） |

### 6.2 Capabilities

| 凭据 | 形态 | 有效期 | 库中存什么 |
| --- | --- | --- | --- |
| 会话令牌 | 32 字节随机数的 base64url | 30 天硬上限，14 天空闲滑窗 | `sha256(token)` 的 base64url，作为主键 |
| 连接票据 | 24 字节随机数的 base64url | 60 秒，一次性 | `sha256(ticket)`，消费时原子置已用 |
| 邀请令牌 | 32 字节随机数的 base64url | 7 天 | `sha256(token)`，原始值只在创建响应里出现一次 |

关键规则：

- **只走请求头，不发 Cookie。** 人类接口认 `Authorization: Bearer`，长连风格客户端用 `x-session-token`，两者都没有时按未认证处理。不发 Cookie 是刻意的：Cookie 会随任意同域请求自动附带，把跨站请求伪造与子域污染变成默认风险；代价是每个客户端都必须显式带凭据，这一点写进接口约定而非靠框架兜底。
- **令牌只以摘要落库。** 数据库被读走也拿不到可用凭据；登录成功的响应是原始令牌唯一一次出现的场合，此后无法再被服务端还原。
- **空闲滑窗按使用时间推进。** 每次成功校验最多每 30 秒回写一次 `last_used_at`；节流只会延后过期判定，不会提前，也避免每个请求都产生一次写入。
- **登录回跳把令牌放 URL fragment。** fragment 不进入服务端访问日志、不进入 Referer、不被中间代理缓存；失败同样放 `#error=`，成功放 `#token=` 与工作区标识。
- **提供方固定四个。** `google`、`github`、`gitlab` 走浏览器重定向，`apple` 只接受原生登录提交的 identity token；可用清单由部署侧凭据是否齐全决定，缺凭据的提供方不出现在清单里，而不是出现后失败。
- **登录失败折叠为一个码。** 上游的数据库异常、提供方拒绝、邮箱未验证、账号已删除，对外统一是 `signin_failed`；只有"账号被停用"是例外，因为用户需要知道去找管理员，而停用本身不是可被枚举的隐私。折叠是构造性的：只有明确写给用户看的错误能透出，其余一律替换。
- **登出是删行，停用是删全部行。** 登出不写墓碑；停用用户在同一事务内删除该用户的全部会话，避免"停用后旧标签页还能用"。校验每次读库，因此撤销不需要黑名单。
- **账号删除是软删加清 PII。** 用户行只保留主键与必要的引用完整性字段，邮箱、显示名、头像等清空，会话行一并删除；不承诺邮箱可以被立即重新注册，这一点取决于是否保留唯一约束的占位（见待确认项）。

**决策：认证中间件永不拒绝，是否需要身份由处理器自行声明。** 这是现状，也是刻意的取舍：长连、运行时与入站邮件三条路径的凭据形态完全不同，若在统一中间件里拒绝，它们会被一起打死。代价同样明确——新增路由忘记声明守卫就是公开接口，而且没有任何报错。落地的缓解不是"记得加"，而是把所需身份级别写进路由登记表，由启动自检比对实际挂载的守卫，缺失即启动失败。本章把它记为设计决策而不是既成事实，因为这是本模块最容易被后续改动破坏的一处。

### 6.3 Contracts

```ts
type OAuthProvider = 'google' | 'github' | 'gitlab' | 'apple'
type SignInErrorCode = 'signin_failed' | 'bad_state' | 'missing_code_or_state' | 'return_not_allowed'

interface User {
  id: string
  email: string
  displayName: string
  isAdmin: boolean
  suspendedAt: string | null
  deletedAt: string | null
}

interface IdentityBinding { userId: string; provider: OAuthProvider; providerId: string; linkedAt: string }

interface Session {
  tokenHash: string          // 主键，sha256 的 base64url
  userId: string
  createdAt: string
  expiresAt: string          // 签发时刻加 30 天，不可续期
  lastUsedAt: string         // 空闲滑窗依据，回写有节流
}

interface IssuedSession { token: string; session: Session }
interface WsTicket { ticket: string; expiresAt: string }   // 60 秒，一次性，只存摘要
interface AuthenticatedActor { userId: string; displayName: string; isAdmin: boolean; session: Session }
interface InvitationToken { token: string; tokenHash: string; expiresAt: string }

abstract class IdentityService {
  abstract startSignIn(provider: OAuthProvider, returnUrl: string, inviteToken?: string): Promise<{ authorizeUrl: string }>
  abstract completeSignIn(provider: OAuthProvider, code: string, state: string): Promise<IssuedSession>
  abstract resolveActor(request: unknown): Promise<AuthenticatedActor | null>
  abstract issueWsTicket(actor: AuthenticatedActor): Promise<WsTicket>
  abstract consumeWsTicket(ticket: string): Promise<AuthenticatedActor | null>
  abstract logout(rawToken: string): Promise<void>
  abstract suspendUser(userId: string, reason: string, actorId: string): Promise<void>
  abstract deleteAccount(userId: string): Promise<void>
  abstract mintInvitationToken(): Promise<InvitationToken>
}
```

错误约定：未认证返回 `401`，停用与删除在登录回跳里以 fragment 表达而不是 HTTP 码；回跳地址不在白名单返回 `400`；`state` 过期或已消费一律折叠为 `bad_state`，让用户可以自助重来。所有响应体不带数据库异常文本，稳定码见 [错误码与状态模型](../errors/)。

### 6.4 Flow

```ts
async function completeSignIn(deps: SignInDeps, input: SignInInput): Promise<SignInOutcome> {
  // 1) state 一次性消费：拿不到就是过期或被重放，回登录页重来
  const state = await deps.cache.take(`oauth:state:${deps.hash(input.state)}`)
  if (!state) return deps.redirect({ error: 'bad_state' })
  if (!deps.providers.isWebProvider(input.provider)) return deps.redirect({ error: 'signin_failed' })

  // 2) 上游任何失败都折叠，绝不把提供方原文塞进地址栏或页面
  let profile: ExternalProfile
  try {
    profile = await deps.providers.exchange(input.provider, input.code)
  } catch {
    return deps.redirect({ error: 'signin_failed' })
  }
  if (!profile.emailVerified) return deps.redirect({ error: 'signin_failed' })

  // 3) 身份绑定优先，其次按已验证邮箱跨提供方关联，两者都不命中才建号
  const user = await deps.db.transaction((tx) => deps.users.findOrCreateByProfile(tx, profile))
  if (user.deletedAt) return deps.redirect({ error: 'signin_failed' })
  if (user.suspendedAt) return deps.redirect({ suspended: true, email: user.email })

  // 4) 令牌只在这里出现一次；库里写摘要，30 天硬上限
  const token = deps.randomToken(32)
  await deps.db.insertSession({
    tokenHash: deps.hash(token),
    userId: user.id,
    expiresAt: deps.plusDays(deps.now(), 30),
    lastUsedAt: deps.now(),
  })
  return deps.redirect({ token, companyId: await deps.workspaces.defaultFor(user.id) })
}

async function resolveActor(deps: ActorDeps, request: Request): Promise<AuthenticatedActor | null> {
  const raw = deps.bearer(request) ?? deps.header(request, 'x-session-token')
  if (!raw) return null                                    // 没带凭据不是错误，由处理器决定要不要身份
  const row = await deps.db.findSessionWithUser(deps.hash(raw))
  if (!row) return null                                    // 未知、已登出、已过期
  if (row.user.suspendedAt || row.user.deletedAt) {
    await deps.db.deleteSession(row.tokenHash)             // 停用与删号在这里收口
    return null
  }
  if (deps.now() > deps.minusDays(row.lastUsedAt ?? row.createdAt, 14)) {
    await deps.db.deleteSession(row.tokenHash)             // 14 天未使用即视为放弃
    return null
  }
  if (deps.now() > row.expiresAt) {
    await deps.db.deleteSession(row.tokenHash)             // 30 天硬上限，不续期
    return null
  }
  await deps.db.touchSession(row.tokenHash, deps.now())    // 内部节流，最多 30 秒一次
  return deps.toActor(row)
}
```

分支说明：`state` 缺失与提供方不可用都直接把用户送回登录页，不产生"半登录"状态；上游失败折叠为单一码，避免把 Postgres 或提供方的原文写进地址栏；未验证邮箱同样折叠，因为"告诉我哪个邮箱没验证"本身就是一次账号枚举；停用是唯一带原因的失败，因为它需要用户去联系管理员；删除后的登录与首次注册表现一致，不确认这个邮箱是否存在过。

### 6.5 Recovery and Idempotency

- **过期即删行。** 硬上限与空闲滑窗都在校验路径上收敛，过期令牌下一次使用返回未认证，同时清掉那一行；不保留墓碑，也就不需要清理任务。
- **票据不可缓存。** 连接票据是一次性的，丢票只能重新铸造；客户端重试旧票必然得到 `4401`，因此重连逻辑必须是"先取新票再连"，而不是"重试同一 URL"。
- **重复登出幂等。** 删除不存在的会话行返回成功，客户端无论此前是否已登出，都能收敛到同一状态。
- **停用与删除的残留窗口。** 停用在同一事务内删全部会话，但并发请求可能已通过校验并继续处理；允许的最长残留是一个请求的生命周期，这是"校验读库、不做全局黑名单"的必然代价，也是可接受的代价。

### 6.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| ID-01 | 提供方凭据齐全 | 完成一次浏览器登录 | 回跳 URL 的 fragment 带令牌与工作区标识；库中只有摘要行，`expires_at` 为签发时刻加 30 天；响应头与 Cookie 罐里没有任何会话 Cookie |
| ID-02 | 令牌已通过登出失效 | 用旧令牌请求受保护接口 | 返回 `401`，且该摘要对应的会话行不存在，服务端不返回"已登出"这类可区分文案 |
| ID-03 | 会话行最后使用时间在 15 天前 | 携带该令牌请求 | 返回 `401`，该行被删除；重新登录后同一账号得到新令牌且旧令牌仍不可用 |
| ID-04 | 上游提供方返回错误或未验证邮箱 | 完成授权回调 | 回跳为 `#error=signin_failed`，页面与地址栏都不出现上游原文、数据库错误或邮箱是否存在的暗示 |
| ID-05 | 已持有一个有效票据 | 用同一票据连续发起两次长连 | 第一次握手成功；第二次被以 `4401` 关闭，库中该票据 `used_at` 有值且只有一行 |
| ID-06 | 管理员停用某用户 | 该用户下一次请求任意受保护接口 | 返回 `401`；该用户全部会话行在同一事务内被删除，计数为 0，其未过期的连接票据也无法再换到身份 |
| ID-07 | 同一令牌已登出一次 | 再次登出 | 两次都返回成功，无 `5xx`，会话表状态不变 |
