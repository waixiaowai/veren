---
title: 计费（Billing）
description: "记录每一次平台侧模型调用的用量与成本，按小时重算汇总，执行档位、试用与网关配额。"
sidebar:
  order: 15
  label: 15 计费
draft: false
lastUpdated: 2026-11-04
---

## 15. Billing

计费是外围域，但它守着一条全系统不变量：**每一次平台侧模型调用都必须留下可聚合的记录**。它不决定一次回合该花多少（那在回合的预算里），只负责把已经发生的花费记准、把未来的花费挡在配额之外。本章因此把"估算与实测的区别""重算而非累加""自带宿主不计入平台台账"三件事写得比字段清单更细。

### 15.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 每次平台侧模型调用一行台账（用量、成本、延迟、状态） | 单次回合内的跳数、上下文与预算判定（`Turn`） |
| 小时汇总的聚合、回填与保留 | 档位的产品权益与成员上限（`Workspace`） |
| 内置价格表、运维覆盖与已验证标记 | 网关内部的限流、计费与账单（上游网关） |
| 配额快照（日、周、月窗口）与档位到分组的映射 | 支付、发票与退款（本方案不含） |
| 试用到期降级与档位变更的唯一路径 | 后台的权限与审计（`Admin`） |
| 自带宿主调用的运行事实登记（不计量） | 宿主的配对、引擎与沙箱（`Host`） |

### 15.2 Capabilities

台账一行对应一次出站模型调用：用途、来源、模型、未缓存输入、缓存读、缓存写、输出、推理、成本、是否估算、是否实测、延迟、状态、错误与守护版本。写入是"发了就算"的旁路动作，台账失败不会让一次已经完成的思考变成失败。

关键业务规则：

- **用途与来源都是闭集**。用途区分大小模型（对话与会议发言走大模型；收件箱判断、唤醒闸门、议程、压缩、完成复核、路由、调色板等走小模型），来源区分平台与各自带引擎。闭集之外的值视为缺陷，不允许"其他"这种兜底项。
- **缓存要拆开记**。输入应记为未缓存输入，缓存读与缓存写各自单列；把缓存命中混进输入会让成本虚高，把缓存写漏记会让成本虚低。归一化在计费侧完成，调用方只报原始计数。
- **汇总按七维聚合、且重算而非累加**：小时桶、租户、智能体（可为空）、用途、模型、来源、守护版本。刷新时对窗口内的桶重新聚合再覆盖写，因此同一桶刷新十次与刷新一次结果相同；累加式汇总一旦重跑就会翻倍，这是被明确否决的做法。
- **价格表内置，只有运维覆盖才算已验证**。每条价格含四项单价与一个"已验证"标记；内置条目一律标记为未验证，未验证即始终按估算展示。运维用精确模型标识覆盖的条目才算验证过。匹配是双向包含，避免裸名落到更贵的档上；查不到价格时用兜底价并继续标记为估算。
- **配额来自网关分组**。档位映射到网关的三个分组，配额快照包含日、周、月三个美元窗口与到期时间；未配置时返回"未配置"而不是零，网络失败时降级返回而不是阻塞回合。
- **档位三档加试用**：免费、专业、旗舰。专业档带试用到期时间；到期且未删除的用户按批走后台同一条降级路径回到免费档，保证网关分组与本地档位不漂移。人工改档会清掉到期标记，因此"真的升级了"的用户不会被误降。
- **自带宿主的本地调用不计入平台台账**。用户用自己的模型订阅在本地思考时，平台只记运行事实（运行记录与来源标记），不产生费用行；把这些调用混进台账会让成本报表失去意义。
- **成本口径唯一**。展示、配额与告警都读同一个成本函数，不在各个页面各算一遍；估算与否随行落库，页面上必须能看出这一行是估算。

### 15.3 Contracts

```ts
type LlmCallPurpose = 'agent-turn' | 'convene-speech' | 'inbox-triage' | 'synthetic-wake-gate' | 'agenda'
  | 'compaction' | 'completion-verify' | 'steer-summary' | 'convene-decision' | 'message-routing'
  | 'palette' | 'gender' | 'avatar-image' | 'agent-image'
type LlmCallSource = 'cloud' | 'byoa-claude' | 'byoa-codex' | 'byoa-cursor' | 'byoa-gemini' | 'byoa-opencode'
type LlmCallStatus = 'ok' | 'rate_limited' | 'timeout' | 'failed'
type Tier = 'free' | 'pro' | 'max'

interface TokenUsage { input: number; cachedInput: number; cacheWrite: number; output: number; reasoning: number }

interface LlmCallRow {
  id: string
  companyId: string
  agentId: string
  runId: string | null
  purpose: LlmCallPurpose
  source: LlmCallSource
  model: string
  usage: TokenUsage
  costUsd: number
  costEstimated: boolean          // 价格未验证或用量不完整时为 true
  measured: boolean
  latencyMs: number
  status: LlmCallStatus
  daemonVersion: string | null
  createdAt: string
}

interface PriceEntry { model: string; inPer1M: number; cachedInPer1M: number; cacheWritePer1M: number; outPer1M: number; verified: boolean }

interface RollupKey { bucketHour: string; companyId: string; agentId: string | null; purpose: LlmCallPurpose; model: string; source: LlmCallSource; daemonVersion: string | null }
interface QuotaWindow { usedUsd: number; limitUsd: number | null; windowStart: string | null }
interface QuotaSnapshot { groupId: string; groupName: string; status: string; expiresAt: string | null; daily: QuotaWindow; weekly: QuotaWindow; monthly: QuotaWindow }

abstract class BillingService {
  abstract record(call: LlmCallRow): Promise<void>                    // 永不抛
  abstract refreshRollup(fromHour: string, toHour: string): Promise<number>
  abstract quotaFor(companyId: string): Promise<QuotaSnapshot | null> // null = 未配置
  abstract changeTier(companyId: string, tier: Tier, actorId: string): Promise<void>
}
```

错误约定：档位与网关分组映射缺失时返回 `409 TIER_GROUP_UNMAPPED` 并拒绝改档，而不是悄悄按免费档处理；配额查询失败降级为"未配置"，不返回 `5xx`；台账写入失败只计数与告警，不向回合冒泡；改档的网关调用失败返回 `502 QUOTA_GATEWAY_UNAVAILABLE` 且本地档位不变。稳定码清单见 [错误码与状态模型](../errors/)。

### 15.4 Flow

```ts
async function recordCall(deps: BillingDeps, call: LlmCallInput): Promise<void> {
  // 1) 先定价再落库：价格未验证一律标为估算，绝不把估算当实测展示
  const price = deps.pricing.priceFor(call.model)          // 双向匹配，无命中用兜底价
  const usage = normalizeUsage(call)                       // 从总量中扣除缓存读写，避免重复计费
  const costUsd = deps.pricing.cost(price, usage)
  const costEstimated = !price.verified || call.measured === false

  // 2) 记账永不抛：台账失败只变成计数与告警，不改变已经完成的回合
  try {
    await deps.db.insertLlmCall({ ...call, usage, costUsd, costEstimated })
  } catch (error) {
    await deps.metrics.increment('billing.ledger_failed')
    await deps.alert.raise('llm call not recorded', error)  // 未记账即缺陷，必须可见
  }
}

async function refreshRollup(deps: BillingDeps, now: number): Promise<number> {
  return deps.db.withAdvisoryLock(ROLLUP_LOCK_KEY, async () => {
    // 3) 只重算窗口内的桶：回填上限 95 天，稳定窗口 3 小时
    const buckets = await deps.db.aggregate(max(now - STEADY_WINDOW_MS, deps.db.earliestHour()), now)
    // 4) 覆盖写而不是累加：重跑不会翻倍，空智能体的桶用 NULLS NOT DISTINCT 收敛
    await deps.db.upsertBuckets(buckets)
    return buckets.length
  })
}
```

分支说明：`priceFor` 双向包含匹配是为了让裸名（如只写 `haiku`）不会落到更贵的档上，代价是必须显式写出更精确的标识才能覆盖；`normalizeUsage` 对 OpenAI 口径（输入含缓存）与另一家口径（缓存单列）分别处理，归一化前不得计入成本；`insertLlmCall` 是唯一的写入口，任何绕过它的调用点都由 CI 守卫拦下；`withAdvisoryLock` 保证多副本只有一个在刷，窗口重叠时后一轮覆盖前一轮，结果仍然一致。

### 15.5 Recovery and Idempotency

| 风险 | 机制 | 恢复方式 |
| --- | --- | --- |
| 汇总重复刷新 | 按桶重算并覆盖，不清零也不累加 | 同一小时刷新多次，行数与金额都不变 |
| 回填中断 | 窗口回填上限 95 天，保留同长 | 下一轮从窗口起点重建，不需要人工补数 |
| 台账写入失败 | 计数与告警，不冒泡 | 该次调用永久缺失（**待确认**：是否需要本地缓冲后补写）；报表按缺口标注 |
| 网关超时 | 快照降级为"未配置" | 回合继续，配额页显示暂不可用；不把网络故障当作用尽 |
| 改档半途失败 | 先调网关、成功才写本地档位 | 网关失败即本地不变，重试同一路径可获得同一结果 |
| 试用降级重复执行 | 批处理 + 清标记 | 已降级用户不再命中；网关分组与本地档位保持一致 |
| 自带宿主调用 | 不入台账，只记运行事实 | 成本报表不含自有订阅支出，需要时按来源维度另看运行记录 |

### 15.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| BL-01 | 平台托管智能体完成一次回合 | 查看台账 | 出现至少一行调用记录，含用途、来源、四项 token、成本与延迟，估算标记与实际相符 |
| BL-02 | 模型标识不在价格表内 | 发起一次调用 | 使用兜底价计价且 `costEstimated: true`，界面不把该行呈现为实测成本 |
| BL-03 | 同一小时桶已被汇总过 | 连续触发两轮汇总刷新 | 该桶仍是一行，金额与 token 数不翻倍；空智能体的桶不重复 |
| BL-04 | 日配额窗口已用尽 | 智能体尝试一次发言 | 回合记为跳过并给出配额提示，不产生新的模型调用，也不进入重试风暴 |
| BL-05 | 用户在自己机器上用自带引擎思考 | 查看台账 | 台账无该次调用；运行记录里存在该次运行且来源为自带引擎 |
| BL-06 | 专业档试用已过期 | 等待降级任务运行 | 档位回到免费，网关分组同步变化，审计可见；重复运行不再产生第二次降级 |
| BL-07 | 目标档位没有对应的网关分组 | 把用户改为该档位 | 返回 `409 TIER_GROUP_UNMAPPED`，本地档位与网关分组均未变化，台账不受影响 |
