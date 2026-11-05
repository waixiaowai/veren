---
title: 交付（Shipping）
description: "用证据而不是口头声明判断做完了没有：七张表、功能状态机、推进闸门、验证方块与发布回读。"
sidebar:
  order: 17
  label: 17 交付
draft: false
lastUpdated: 2026-11-04
---

## 17. Shipping

交付是外围域里最不像外围的一个：它不承担用户可感知的核心差异化，却决定了"做完了没有"这件事由谁说了算。它的答案只有一条——由证据说了算，而且提供证据的人不能同时是验证证据的人。本章把状态机、闸门、双重的"验证者不得是建造者"以及发布回读写成可执行的判定，而不是流程口号。

### 17.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 七个实体：功能、不变量、验证方块、发布、摩擦、回归、事件 | 代码是否真的正确（构建与测试本身） |
| 功能状态机、暂停与归档 | 镜像构建、部署与集群回滚（发布流水线） |
| 推进闸门与必需方块的完整性判定 | 看板卡片状态与认领（`Board`） |
| 验证者与建造者的互斥判定 | 用量、成本与配额（`Billing`） |
| 失败方块到回归与摩擦的自动派生 | 会话与文档的实际内容（`Conversation`、`Document`） |
| 发布动作、生产批准前置与回读时钟 | 值班响应与人工复盘 |
| 只追加的事件时间线 | 通知渠道本身（`Realtime`、`Admin` 告警） |

### 17.2 Capabilities

七张表的职责是一句话能说清的：功能是"要交付什么"，不变量是"什么必须一直成立"，验证方块是"用什么证据证明它成立"，发布是"哪一次上线"，摩擦是"哪里不顺手"，回归是"怎么重放这个问题"，事件是"谁在什么时候改了什么"。

关键业务规则：

- **建功能即种三个必需方块**。创建功能时原子地种入用户路径、追踪、发布说明三个必需方块（位置递增），因此任何功能从一开始就有最小证据框架，而不是等推进时再补。
- **八态状态机加暂停与归档**。草稿 → 契约 → 构建 → 验证 → 就绪 → 发布中 → 观察 → 已学到；暂停可在前五态之间来回；归档是终态。任何不在邻接表里的转移一律返回 `409`，界面不发明状态。
- **每一态都有闸门**。进契约要求问题、期望结果、契约摘要三者非空；进构建要求至少一个建造者与一条不变量；进验证要求每条必需不变量都有必需方块、每个必需方块都有负责人；进就绪要求**全部**必需方块通过，且至少各有一个通过的用户路径、追踪与发布说明；进观察要求有一次成功的生产发布；进已学到要求生产回读通过且没有失败中的回归。
- **验证者不得是建造者，接口与数据库双重保证**。数据库约束直接拒绝"验证者出现在建造者名单里"的行，接口再拒一次，并额外拒绝"当前操作者本人是建造者时点完成"。方块的负责人也不能是建造者。两道防线是刻意的：约束防绕过，接口给可读的错误。
- **证据有形态要求**。标记通过或失败必须带非空证据；标记豁免必须写书面说明。空证据的"通过"等于没有验证，直接拒绝。
- **失败方块自动派生两个资产**。同一事务内生成或刷新一条可重放的回归（状态为失败）与一条高优摩擦报告，去重键是方块标识；同一个方块反复失败只累加发生次数，不会造出第二条回归。
- **发布动作是一个闭集**：创建、批准、开始、成功、失败、回读通过、回读失败、回滚。创建要求功能处于就绪、发布中或观察；批准与回滚这类动作要求所有者或管理员；成功与失败必须带证据；失败把功能退回就绪。
- **生产批准有四道前置**：先有一次成功的预发或灰度发布、非空回滚方案、非空发布说明、非空可度量基线。缺一项就拒绝，且错误里点名缺哪一项。
- **生产成功即挂回读时钟**。24 小时内必须回读；回读失败生成严重且高频的摩擦并把功能退回构建；回滚必须写理由并同样退回构建。
- **事件只追加**。每次变更都追加一条事件，从不更新或删除，历史可重放。所有变更在事务内对发布行加锁，动作之间串行。
- **租户安全贯穿每个链接**。项目、会话、文档、卡片以及每个参与者标识都要在当前租户内解析成功才可用，证据里的会话与消息也必须能解析。
- **维护任务只做两件事**：把过期的生产回读提升为超期并生成高优摩擦（只提升一次）；把 24 小时内反复出现的回合拒绝或协议违规聚合成一条摩擦。它只产出信号，**永不自动创建功能**。

### 17.3 Contracts

```ts
type FeatureStatus = 'draft' | 'contract' | 'building' | 'verifying' | 'ready' | 'releasing' | 'watching' | 'learned' | 'paused' | 'archived'
type Priority = 'critical' | 'high' | 'medium' | 'low'
type InvariantKind = 'behavior' | 'architecture' | 'data' | 'security' | 'performance' | 'ux' | 'operability'
type VerificationMethod = 'user_path' | 'property' | 'trace' | 'data_reconciliation' | 'design_qa' | 'security' | 'performance' | 'release_note'
type VerificationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'waived'
type ReleaseEnvironment = 'development' | 'staging' | 'canary' | 'production'
type ReadbackStatus = 'pending' | 'passed' | 'failed' | 'overdue'

interface ShippingFeature { id: string; companyId: string; title: string; problem: string; desiredOutcome: string; contractSummary: string; status: FeatureStatus; priority: Priority; builderIds: string[]; archivedAt: string | null }
interface ShippingInvariant { id: string; featureId: string; title: string; kind: InvariantKind; required: boolean; position: number }

// 约束：verifiedById 不得出现在 builderIds；ownerId 同样不得是建造者
interface ShippingVerification { id: string; featureId: string; invariantId: string | null; method: VerificationMethod; required: boolean; status: VerificationStatus; ownerId: string | null; verifiedById: string | null; builderIds: string[]; evidence: string[] }

interface ShippingRelease {
  id: string
  featureId: string
  environment: ReleaseEnvironment
  status: 'planned' | 'approved' | 'running' | 'succeeded' | 'failed' | 'rolled_back'
  releaseNotes: string
  rollbackPlan: string
  baseline: Record<string, number>
  readbackStatus: ReadbackStatus
  readbackDueAt: string | null
}

interface ShippingRegression { id: string; featureId: string; sourceVerificationId: string; kind: 'automated' | 'benchmark' | 'manual_replay' | 'monitor'; status: 'active' | 'passing' | 'failing' | 'disabled'; command: string }
interface ShippingFrictionReport { id: string; companyId: string; source: 'manual' | 'verification' | 'readback' | 'production-readback' | 'agent-observability'; sourceKey: string | null; severity: Priority; status: 'open' | 'triaged' | 'planned' | 'resolved' | 'dismissed'; occurrenceCount: number }

abstract class ShippingService {
  abstract transition(featureId: string, to: FeatureStatus, actorId: string): Promise<ShippingFeature>
  abstract completeVerification(verificationId: string, actorId: string, status: VerificationStatus, evidence: string[]): Promise<ShippingVerification>
  abstract approveRelease(releaseId: string, actorId: string, environment: ReleaseEnvironment): Promise<ShippingRelease>
  abstract recordReadback(releaseId: string, status: ReadbackStatus, evidence: string[]): Promise<ShippingRelease>
}
```

错误约定：非法状态转移返回 `409 INVALID_FEATURE_TRANSITION`；闸门未满足返回 `409` 并在消息里点名缺失项；验证者出现在建造者名单或操作者本人是建造者返回 `409 VERIFIER_IS_BUILDER`；空证据返回 `400 EVIDENCE_REQUIRED`；生产批准缺少预发成功或回滚方案、发布说明、基线返回 `409 RELEASE_GATE_UNMET`；归档功能被修改返回 `409 FEATURE_ARCHIVED`。稳定码清单见 [错误码与状态模型](../errors/)。

### 17.4 Flow

```ts
async function completeVerification(deps: ShippingDeps, input: VerificationInput): Promise<ShippingVerification> {
  return deps.db.transaction(async (tx) => {
    const square = await tx.lockVerification(input.verificationId)
    if (!square) throw new ShippingError('VERIFICATION_NOT_FOUND')

    // 1) 证据不可自证：建造者不能验证自己的工作，也不能由别人代填后自己点完成
    if (square.builderIds.includes(input.actorId)) throw new ShippingError('VERIFIER_IS_BUILDER')
    if (input.status !== 'waived' && input.evidence.length === 0) throw new ShippingError('EVIDENCE_REQUIRED')

    const updated = await tx.setStatus(square.id, input.status, input.evidence, input.actorId)

    // 2) 失败不是一句备注：同一事务内派生可重放回归与高优摩擦，两者按来源键去重
    if (input.status === 'failed') {
      await tx.upsertRegression({ sourceVerificationId: square.id, kind: 'manual_replay', status: 'failing' })
      await tx.upsertFriction({ sourceKey: `verification:${square.id}`, severity: 'high', source: 'verification' })
    }
    await tx.appendEvent(square.featureId, 'verification.completed', { status: input.status, actorId: input.actorId })
    return updated
  })
}

async function approveProduction(deps: ShippingDeps, releaseId: string, actorId: string): Promise<ShippingRelease> {
  return deps.db.transaction(async (tx) => {
    const release = await tx.lockRelease(releaseId)                       // 动作之间串行
    if (!release) throw new ShippingError('RELEASE_NOT_FOUND')
    await deps.auth.requireRole(tx, actorId, ['owner', 'admin'])
    if (release.environment !== 'production') return tx.setReleaseStatus(releaseId, 'approved')

    // 3) 四道前置逐条点名：缺预发、缺回滚、缺说明、缺基线都不放行
    if (!(await tx.lastSucceeded(release.featureId, ['staging', 'canary']))) throw new ShippingError('RELEASE_GATE_UNMET', 'prerelease')
    if (isEmpty(release.rollbackPlan)) throw new ShippingError('RELEASE_GATE_UNMET', 'rollback')
    if (isEmpty(release.releaseNotes) || isEmpty(release.baseline)) throw new ShippingError('RELEASE_GATE_UNMET', 'notes/baseline')

    await tx.setReleaseStatus(releaseId, 'approved', { approvedBy: actorId })
    await tx.appendEvent(release.featureId, 'release.approved', { releaseId, environment: 'production' })
    return tx.findRelease(releaseId)
  })
}
```

分支说明：`lockVerification` 把方块行锁住，并发点完成时只有一次生效；`builderIds` 与数据库约束互为兜底，任何绕过接口的写入也会被约束拒绝；`upsertRegression` 以来源方块为唯一键，同一方块反复失败只累加计数；`lockRelease` 让批准、开始、回滚串行，避免"先开始后批准"这类竞态；`lastSucceeded` 只看已成功的预发或灰度，自测过的分支不算；所有失败都在事务内抛出，状态与事件一并回滚。

### 17.5 Recovery and Idempotency

| 风险 | 机制 | 恢复方式 |
| --- | --- | --- |
| 回读超期被重复提升 | 状态从待回读提升为超期只发生一次，摩擦按来源键去重 | 维护任务重复运行不产生第二条摩擦 |
| 方块重复完成 | 状态覆盖写，事件追加 | 结果幂等；事件保留每一次尝试，可复盘 |
| 同一方块反复失败 | 回归按来源方块唯一，摩擦累加发生次数 | 只累加不新建；已忽略的摩擦不被复活（针对可观测性来源） |
| 发布中断 | 停在发布中，不自动判定成功 | 必须由人带证据标记成功或失败；超期无人处理会留在观察面 |
| 归档后修改 | 归档即不可变 | 返回 `409 FEATURE_ARCHIVED`，需要新建功能而不是复写历史 |
| 多副本维护 | 事务级咨询锁 | 只有一个副本执行，其余跳过；提升逻辑本身也幂等 |
| 证据缺失 | 空证据即拒绝 | 不允许"先通过后补证据"，补证据必须重新提交并留事件 |

### 17.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| SH-01 | 功能缺少通过的追踪方块 | 推进到就绪 | 返回 `409` 并点名缺失的方块类型；状态仍为验证中，不产生发布记录 |
| SH-02 | 操作者是该功能的建造者 | 把自己负责的方块标记为通过 | 返回 `409 VERIFIER_IS_BUILDER`，方块状态与证据均未改变 |
| SH-03 | 某方块已失败过一次并生成了回归 | 同一方块再次失败 | 不新增回归，摩擦发生次数加一，事件追加两条 |
| SH-04 | 没有任何成功的预发或灰度发布 | 批准生产发布 | 返回 `409 RELEASE_GATE_UNMET` 并指出缺预发成功；发布仍未批准 |
| SH-05 | 生产已成功发布且回读超过 24 小时未做 | 等待维护任务 | 回读状态变为超期，生成一条高优摩擦；再次运行不重复生成 |
| SH-06 | 功能已归档 | 修改其契约摘要 | 返回 `409 FEATURE_ARCHIVED`，功能与事件均无变化 |
