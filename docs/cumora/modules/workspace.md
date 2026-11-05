---
title: 工作区
description: "划定租户边界：成员与角色、邀请生命周期、席位与档位配额、开通与删除顺序，并把租户范围写进每一条查询。"
sidebar:
  order: 7
  label: 7 工作区
draft: false
lastUpdated: 2026-11-04
---

## 7. Workspace

工作区是租户本体：一个团队、一份成员名单、一套角色与配额。数据模型里它与公司是同一张表，界面上统一叫工作区。它决定"谁能看见谁"，并把这条边界交给所有模块作为查询的前置条件。它不认人，认人是 [身份](./identity/)；它也不保存对话内容，那是 [会话](./conversation/) 的事。它的失败模式有两种：越界可见，以及误删租户；本章的约束几乎都围绕这两点。

### 7.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 工作区记录、名称、slug 与归属所有者 | 用户与凭据的签发（`Identity`） |
| 成员关系与角色（owner、admin、member） | 名册投影与消息署名（`Conversation`） |
| 邀请的创建、预览、接受、撤销与状态计算 | 邀请邮件的投递与退信处理（`Email`） |
| 席位、人数、每人工作区数的档位配额 | 档位与计费的产品定义（`Billing`） |
| 个人工作区与新建工作区的开通、slug 分配 | 宿主与执行环境的创建（`Host`） |
| 工作区删除的表顺序、确认与清理任务 | 各模块自己的数据保留策略（各模块） |
| 三段一次性播种标记（全员频道、成员私聊、起始智能体） | 智能体人格与技能（`Agent`） |

### 7.2 Capabilities

角色只有三个值，能力在服务端集中判定，不引入自定义角色或权限位：

| 能力 | owner | admin | member |
| --- | --- | --- | --- |
| 改名、改描述、轮换配对码、管设备 | 是 | 是 | 否 |
| 邀请成员、建智能体、建项目与看板 | 是 | 是 | 否 |
| 移除成员 | 是 | 仅普通成员 | 否 |
| 修改成员角色、邀请管理员、删除工作区 | 是 | 否 | 否 |
| 日常读写（会话、消息、文档、日历、上传） | 是 | 是 | 是 |

关键规则：

- **工作区头必须命中成员关系。** 请求携带工作区标识时，服务端用成员关系表验证，不是成员即 `403`；头本身永不构成授权。
- **缺省回退是已知风险。** 没有携带工作区标识时，服务端回退到"最早加入的工作区"，这让漏传头的客户端会对另一个租户成功写入而不报错。设计要求：新客户端一律显式携带；缺省回退只作为过渡，并按调用方计数告警，退出时点见待确认项。这是本章最需要盯住的一处，因为它不产生错误，只产生错的数据。
- **邀请状态是算出来的。** 预览时按撤销、过期、次数用尽、邮箱不符、已是成员的顺序得出 `revoked`、`expired`、`consumed`、`wrong_email`、`already_member`，都不命中才是 `valid`，令牌查不到是 `not_found`。状态不落库，避免定时任务与真实判定打架。
- **原始令牌只出现一次，链接有次数上限。** 创建响应里带令牌与链接，列表页用摘要作标识；同邮箱的旧邀请在创建新邀请时被撤销。无邮箱的分享链接默认最多 100 次，并被剩余席位截断；有邮箱的邀请是单次且锁定邮箱。
- **接受在行锁内完成。** 先锁邀请行，再依次判撤销、过期、次数、邮箱，最后判席位与档位；并发接受同一邀请会排队，不会把次数算两次。已是成员时返回幂等成功，不涨次数、不重复播种。
- **删除按外键顺序显式逐表。** 先删会话与消息，再删名册与成员关系，最后删工作区行；成员关系对名册是限制删除，反向顺序会直接失败，而依赖单条级联也删不掉历史遗留的租户列。删除需要所有者身份、输入工作区名确认，且不允许删掉自己唯一的工作区。
- **档位取自所有者，免费档只允许自带宿主。** 工作区档位是所有者用户档位的投影，所有者缺失时折叠为 `free`；配额三个维度各自独立，超限文案必须说明是哪个维度。免费档不创建托管宿主，也不允许把智能体指派到托管宿主，否则成本会在无付费关系的情况下持续发生。

### 7.3 Contracts

```ts
type CompanyRole = 'owner' | 'admin' | 'member'
type Tier = 'free' | 'pro' | 'max'
type InvitationStatus = 'valid' | 'revoked' | 'expired' | 'consumed' | 'wrong_email' | 'already_member' | 'not_found'

interface Workspace {
  id: string; name: string; slug: string      // slug 由服务端分配，全局唯一
  ownerUserId: string | null
  tier: Tier                                  // 所有者档位的投影，不独立维护
  createdAt: string
}

interface Membership { companyId: string; userId: string; role: CompanyRole; joinedAt: string }

interface Invitation {
  tokenHash: string                           // 主键，原始令牌不再可还原
  companyId: string; invitedBy: string
  email: string | null                        // 为空表示可分享链接
  role: 'member' | 'admin'; note: string | null
  maxUses: number; useCount: number
  expiresAt: string; revokedAt: string | null  // 创建后 7 天，撤销即置位
}

interface InvitationPreview {
  status: InvitationStatus
  workspaceName: string | null; inviterName: string | null
  role: 'member' | 'admin' | null; expiresAt: string | null
}

interface TierLimits { companiesPerUser: number; humansPerWorkspace: number; agentsPerWorkspace: number; hostedHostAllowed: boolean }
interface Scope { companyId: string; actorId: string; role: CompanyRole }

abstract class WorkspaceService {
  abstract resolveScope(actorId: string, companyHeader: string | null): Promise<Scope>
  abstract createWorkspace(actorId: string, input: CreateWorkspaceInput): Promise<Workspace>
  abstract provisionPersonalWorkspace(actorId: string, displayName: string, email: string): Promise<Workspace>
  abstract previewInvitation(token: string): Promise<InvitationPreview>
  abstract acceptInvitation(token: string, actorId: string): Promise<AcceptResult>
  abstract revokeInvitation(scope: Scope, tokenHash: string): Promise<{ revoked: boolean }>
  abstract changeRole(scope: Scope, userId: string, role: Exclude<CompanyRole, 'owner'>): Promise<Membership>
  abstract removeMember(scope: Scope, userId: string): Promise<void>
  abstract deleteWorkspace(scope: Scope, confirmation: string): Promise<void>
}
```

错误约定：非成员或跨租户一律 `404`，与资源不存在不可区分；角色不足 `403` 并说明缺哪个角色；邀请不可用 `410`；邮箱不符 `403`；配额超限 `403` 并写明维度；slug 分配失败是服务端错误，文案只说明种子与尝试次数。稳定码见 [错误码与状态模型](../errors/)。

### 7.4 Flow

```ts
async function acceptInvitation(deps: WorkspaceDeps, token: string, actorId: string): Promise<AcceptResult> {
  const digest = deps.hash(token)
  return deps.db.transaction(async (tx) => {
    // 1) 行锁：并发接受同一邀请必须排队，否则次数会被算两次
    const invite = await tx.lockInvitation(digest)
    if (!invite) throw new WorkspaceError('INVITATION_NOT_FOUND', 404)
    if (invite.revokedAt) throw new WorkspaceError('INVITATION_REVOKED', 410)
    if (deps.now() > invite.expiresAt) throw new WorkspaceError('INVITATION_EXPIRED', 410)
    if (invite.useCount >= invite.maxUses) throw new WorkspaceError('INVITATION_CONSUMED', 410)
    // 2) 邮箱锁：不匹配即拒绝，不透露这个邀请属于谁
    const actor = await tx.findUser(actorId)
    if (invite.email && invite.email !== actor.email.toLowerCase()) throw new WorkspaceError('INVITATION_WRONG_EMAIL', 403)
    // 3) 已是成员：幂等成功，不涨次数、不重复播种
    if (await tx.hasMembership(invite.companyId, actorId)) return { companyId: invite.companyId, alreadyMember: true }
    // 4) 席位与档位在同一事务内判定，任一超限即整体回滚
    const limits = deps.billing.limitsFor(await deps.billing.tierOfWorkspace(tx, invite.companyId))
    if ((await tx.humanCount(invite.companyId)) >= limits.humansPerWorkspace) throw new WorkspaceError('WORKSPACE_MEMBER_LIMIT', 403)
    if ((await tx.companyCount(actorId)) >= limits.companiesPerUser) throw new WorkspaceError('USER_COMPANY_LIMIT', 403)
    // 5) 先落成员关系，再镜像名册与计数；名册失败不回滚成员
    await tx.insertMembership({ companyId: invite.companyId, userId: actorId, role: invite.role })
    await tx.mirrorParticipant(actor, invite.companyId)
    await tx.markInvitationUsed(digest, actorId, deps.now())
    return { companyId: invite.companyId, alreadyMember: false }
  })
}

async function provisionPersonalWorkspace(deps: WorkspaceDeps, actorId: string, displayName: string, email: string) {
  const seed = deps.slugSeed(email)                       // 非字母数字折叠为连字符，空则用固定词
  return deps.db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // 唯一冲突会中止整个事务，必须用 SAVEPOINT 把每次尝试包起来
      await tx.exec('SAVEPOINT personal_workspace')
      const slug = attempt === 0 ? seed : `${seed}-${deps.shortId(4)}`
      try {
        const workspace = await tx.insertWorkspace({ name: `${displayName} 的工作区`, slug, ownerUserId: actorId })
        await tx.insertMembership({ companyId: workspace.id, userId: actorId, role: 'owner' })
        await tx.exec('RELEASE SAVEPOINT personal_workspace')
        return workspace
      } catch (error) {
        await tx.exec('ROLLBACK TO SAVEPOINT personal_workspace')
        if (!deps.isUniqueViolation(error, 'slug')) throw error
      }
    }
    throw new WorkspaceError('WORKSPACE_SLUG_EXHAUSTED', 500)
  })
}
```

分支说明：邀请不存在与已撤销是两种不同表现，因为用户手里拿的是链接，`410` 比 `404` 更能让他去找管理员；邮箱不符不说明邀请绑定的是哪个邮箱；已是成员返回成功而不是冲突，因为目标状态已经达成，报错只会让他重复点击；席位判定在锁内完成，避免两人同时接受把人数顶破；保存点是承重的——裸重试会因唯一冲突已中止事务而直接跳出循环，表现为一个被占用的 slug 让后续同前缀的注册全部失败。

### 7.5 Recovery and Idempotency

- **重复接受**：已是成员即返回成功，次数不涨、播种标记不重放；同一链接被两人接受时，第二次在席位判定处被拒，不会静默降级为普通成员。
- **撤销幂等**：撤销已撤销或已过期的邀请返回成功，只报告本次是否真的改了行，客户端不必先查再删。
- **slug 冲突**：最多重试 5 次，每次追加四位随机后缀；每次尝试都在保存点内，失败不污染外层事务；耗尽后报错并保留种子，便于人工介入。
- **删除可重入**：逐表删除按固定顺序执行，中途失败后重跑安全；清理任务按批次认领，租约到期可被其他实例接手。
- **档位漂移**：所有者档位变更立即反映到配额，不需要迁移工作区行；降档导致的超额不追溯删除既有成员，只阻止新增，具体策略见待确认项。

### 7.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| WS-01 | 用户是工作区 A 的成员、不是工作区 B 的成员 | 携带工作区 B 的标识读取会话列表 | 返回 `403` 或 `404`（按接口约定），响应中不含 B 的名称、成员或计数 |
| WS-02 | 有效邀请、工作区已满员 | 使用该邀请接受 | 返回 `403` 并指出人数维度；成员关系未写入，邀请次数不变，名册无新增 |
| WS-03 | 邀请已成功接受一次 | 同一用户再次接受同一邀请 | 返回成功并标记已是成员；`use_count` 不变，全员频道与成员私聊不出现第二份 |
| WS-04 | 目标 slug 已被另一个工作区占用 | 新用户首次登录触发个人工作区开通 | 开通成功且 slug 带后缀；并发注册不受影响，无事务已中止类错误 |
| WS-05 | 工作区存在会话、消息、名册与成员关系 | 所有者输入正确名称删除工作区 | 删除成功；逐表检查无残留行，再次删除返回不存在，其他工作区不受影响 |
| WS-06 | 免费档工作区 | 把智能体指派到托管宿主 | 返回 `400` 并说明免费档只允许自带宿主；宿主与智能体归属均未变更 |
