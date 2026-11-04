---
title: 运营（Admin）
description: "以只读为主的运营面：用户、候补、可观测与设置四页，少量写操作、审计、指标、告警与保留清理。"
sidebar:
  order: 16
  label: 16 运营
draft: false
lastUpdated: 2026-11-04
---

## 16. Admin

运营是外围域，且刻意做成"薄"的：它不承担核心差异化，不参与任何业务判定，只把已经发生的事实摆出来，并保留四类能改变准入的写操作。薄不等于随便——越权读取、审计缺口、清理误删都属于不可逆伤害，所以本章把写路径的顺序与清理的边界写得比页面清单更细。

### 16.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 后台四页：用户、候补、可观测、设置 | 各业务数据的写入与校验（各自模块） |
| 四类写操作：改档位、封禁、批准候补、全局开关 | 档位定价、台账与配额计算（`Billing`） |
| 审计事件的记录与检索 | 身份认证与会话签发（`Identity`） |
| 指标计数、文本输出与访问令牌 | 指标采集与长期存储（外部监控） |
| 两种告警通道与告警去重 | 部署、回滚与发布证据（`Shipping` 与发布流程） |
| 保留清理的编排（目标表、批次、超时） | 被清理表本身的业务语义（`Turn`、`Realtime`） |
| 多副本任务的安全性说明与配置约束 | 各后台任务的具体实现（会话、邮件、日程各写各的） |

### 16.2 Capabilities

后台以只读为主：列表、详情、聚合、导出都在这一侧；能改变状态的只有四类操作，且每一类都必须落一条审计。

- **四页各司其职**。用户页看成员、档位、试用、最近活跃与智能体数量；候补页开关邀请制、批准或拒绝候补；可观测页看指标、告警记录、清理结果与失败计数；设置页是键值表，含邀请制与注册暂停这类全局开关。
- **读宽写窄**。读页面对所有者与管理员开放，且结果按租户裁剪，跨租户的行根本不出现在查询里；写操作只有四类，封禁必须写理由，理由随审计一起落库，事后能回答"为什么封的"。
- **设置页是显式默认**。邀请制关闭、注册开放这类预置值写成显式键值，缺键按默认处理而不是按空处理；任何改动都写审计并立即失效相关缓存，不依赖 30 秒过期兜底。
- **聚合缓存 30 秒且不淘汰**。页面的统计结果缓存半分钟，按键存放、过期即重取，但**没有容量上限也没有淘汰**。这是一个已知风险：租户数增长会让缓存条目单调增长，**待确认**是否加固定容量与 LRU。当前取舍是"宁可多占内存，也不要让后台把库打穿"。
- **审计只追加**。每次写操作插入一条事件（操作者、租户、来源地址、动作、细节）；插入失败只告警，不回滚业务。这意味着审计可能缺行，属于明确取舍：不能让审计表故障变成业务不可用。
- **指标是进程内计数器**。按白名单化的标签计数，文本输出需要令牌，未配置令牌即视为不存在；标签未注册只告警不拒绝。计数器随进程重启归零，采集端按速率计算，因此归零不影响判读。
- **两种告警通道**。结构化告警按"标签 + 消息前缀"在时间窗内去重，永不抛、永不阻塞；即时通知是单条消息，同样永不抛，未配置则只写标准错误。
- **保留清理只覆盖 5 张表**：一次性连接票据、智能体日志、智能体事件、运行记录、调用台账。消息、邮件、看板、文档都不在清理范围内——这是刻意的：删业务数据要人决定，不能交给定时任务。
- **清理用两段式删除**：先按时间列选出主键（限量），再按主键删除；每批的语句超时 55 秒，每表最多 10 批，以"选不满一批"判定排空。目标表必须有时间列上的裸索引，缺索引时检查会失败而不是让清理慢到把库拖死。
- **多副本下唯一不安全的是空闲调度器**。它没有认领机制，每个副本都会把同一批智能体分类并唤醒；其余任务靠库锁、咨询锁或"跳过已锁定行"收敛，允许重叠但不会重复生效。因此部署约束是：空闲调度器**必须单副本运行或显式关闭**，这是一条上线检查项。

### 16.3 Contracts

```ts
type AdminRole = 'owner' | 'admin' | 'member'
type AlertLevel = 'error' | 'warn' | 'info'
type WaitlistStatus = 'pending' | 'approved' | 'rejected'

interface AdminUserRow { id: string; email: string; displayName: string; tier: 'free' | 'pro' | 'max'; trialExpiresAt: string | null; bannedAt: string | null; lastSeenAt: string | null; agentCount: number }
interface WaitlistEntry { id: string; email: string; note: string | null; status: WaitlistStatus; createdAt: string }
interface MetricSample { name: string; labels: Record<string, string>; value: number }
interface AlertPayload { title: string; detail: string; level: AlertLevel }
interface AppSetting { key: string; value: unknown; updatedBy: string | null; updatedAt: string }
interface RetentionTarget { table: string; timeColumn: string; retentionDays: number }
interface SweepReport { table: string; deleted: number; batches: number; drained: boolean }

abstract class AdminService {
  abstract listUsers(actorId: string, query: string, limit: number): Promise<AdminUserRow[]>
  abstract changeTier(actorId: string, userId: string, tier: AdminUserRow['tier']): Promise<AdminUserRow>
  abstract banUser(actorId: string, userId: string, reason: string): Promise<AdminUserRow>
  abstract approveWaitlist(actorId: string, entryId: string): Promise<WaitlistEntry>
  abstract metrics(actorId: string): Promise<MetricSample[]>
  abstract sweepRetention(target: RetentionTarget): Promise<SweepReport>
}
```

错误约定：调用者不是所有者或管理员返回 `403 ADMIN_FORBIDDEN`；目标用户不属于当前租户返回 `404`；网关分组映射缺失返回 `409 TIER_GROUP_UNMAPPED`；网关不可用返回 `502 QUOTA_GATEWAY_UNAVAILABLE` 且本地档位不变；候补重复批准返回 `200` 与既有成员（幂等）；被清理目标缺少时间索引返回 `500 RETENTION_INDEX_MISSING` 并停止清理。稳定码清单见 [错误码与状态模型](../errors/)。

### 16.4 Flow

```ts
async function changeTier(deps: AdminDeps, actorId: string, userId: string, tier: 'free' | 'pro' | 'max'): Promise<AdminUserRow> {
  // 1) 写操作先判角色，再判目标归属：越权与跨租户都在读取任何数据之前被拒
  const actor = await deps.auth.requireRole(actorId, ['owner', 'admin'])
  const before = await deps.db.findUserInTenant(userId, actor.companyId)
  if (!before) throw new AdminError('ADMIN_TARGET_NOT_FOUND')

  // 2) 先改网关分组：网关失败即本地不变，避免"界面显示升级、实际仍被限流"
  const group = deps.quota.groupFor(tier)
  if (!group) throw new AdminError('TIER_GROUP_UNMAPPED')
  await deps.quota.assignGroup(userId, group)              // 失败抛 QUOTA_GATEWAY_UNAVAILABLE

  // 3) 网关成功后写本地档位并清试用标记，防止下一轮降级任务把用户打回免费
  const user = await deps.db.updateTier(userId, { tier, trialExpiresAt: null })

  // 4) 审计失败只告警：不能因为审计表写不进去，就把一次已经生效的改档回滚
  try {
    await deps.audit.insert({ kind: 'admin.tier_changed', actorId, companyId: actor.companyId, detail: { from: before.tier, to: tier } })
  } catch (error) {
    await deps.alerts.raise({ title: 'admin audit missing', detail: `tier change ${userId}`, level: 'warn' })
  }

  await deps.cache.delete(`admin:users:${actor.companyId}`)  // 30 秒缓存，主动失效只是加速
  return user
}
```

分支说明：`requireRole` 对普通成员直接 `403`，不返回任何用户行；`findUserInTenant` 把跨租户目标变成 `404`，不泄漏该用户是否存在；`assignGroup` 失败时本地档位仍为旧值，重试同一路径可获得同一结果；`updateTier` 清掉试用标记，这是"人工改档不会被降级任务覆盖"的前提；审计与缓存失效都在业务成功之后，前者失败只告警，后者失败最多让页面半分钟内显示旧值。

### 16.5 Recovery and Idempotency

| 风险 | 机制 | 恢复方式 |
| --- | --- | --- |
| 聚合缓存无上限 | 30 秒过期，不淘汰 | **待确认**：条目随租户增长单调增长，重启释放；是否加容量上限尚未决定 |
| 审计缺行 | 只追加，失败只告警 | 缺口无法自动补齐，只能从网关与业务表反查；属于已知取舍 |
| 清理中断 | 两段式删除、每表 10 批、55 秒超时 | 下一轮从时间列继续，删除按主键幂等，不会误删已删行 |
| 缺索引导致清理拖库 | 启动检查要求时间列裸索引 | 检查失败即拒绝执行该表，等索引补齐 |
| 告警通道不可用 | 通道调用永不抛，未配置写标准错误 | 告警丢失，但业务不受影响；可观测页仍能查到计数 |
| 多副本空闲调度 | 无认领机制 | 上线检查要求单副本或关闭；否则同一智能体被重复唤醒，成本翻倍 |
| 指标重启归零 | 进程内计数 + 采集端按速率 | 归零不产生误判；跨重启的累计请在采集端聚合 |

### 16.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| AD-01 | 调用者是普通成员 | 请求后台用户列表 | 返回 `403 ADMIN_FORBIDDEN`，响应不含任何用户行；审计无成功读取记录 |
| AD-02 | 某候补已被批准过一次 | 再次批准同一条 | 返回既有成员与 `approved` 状态，成员不重复创建，邀请不重复发出 |
| AD-03 | 网关不可用 | 把用户改为专业档 | 返回 `502`，本地档位仍为免费，审计中没有"改档成功"记录 |
| AD-04 | 清理任务按目标表运行 | 等待一轮清理 | 只删除 5 张目标表的时间窗数据；消息、邮件、看板与文档均完整 |
| AD-05 | 用户在线且被封禁 | 封禁该用户 | 其会话立即失效，后续请求被拒；重复封禁不产生第二条审计 |
| AD-06 | 部署两个副本且都开启空闲调度 | 等待一个调度周期 | 同一智能体出现两次唤醒（反例）；改为单副本后只出现一次 |
