---
title: 定价目录
description: 功能项、套餐、价格与权益模板的定义、版本化与引用完整性。
sidebar:
  order: 20
  label: 定价目录 Catalog
lastUpdated: 2026-11-05
---

定价目录回答「卖什么」：它把功能项、套餐、价格与权益定义成一批可版本化、可被引用、但绝不持有客户实例的数据。它与额度账本的分界是：目录只描述「应该给多少」，账本才记录「实际还剩多少」；与结算引擎的分界是：目录不计算金额，只声明计价结构与规则。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 目录负责 | 不负责 |
| --- | --- | --- |
| 额度账本 | 提供授予模板与重置语义 | 生成或修改任何余额实例 |
| 结算引擎 | 提供可售套餐、价格与升降级规则 | 计算账单、扣款、开票 |
| 客户 | 无 | 客户身份与归属 |
| 迁移 | 提供套餐版本供切换 | 执行批量切换 |
| 控制台 | 提供编辑契约与校验结果 | 渲染与交互 |

### 1.2 Core Position

目录是三个核心域中唯一「纯定义」的域，但它是主链第一步：没有功能项就无法计量，没有套餐就无法购买，没有权益模板就无法生成余额。它的失守方式是静默的——定价写错不会立刻报错，只会在一段时间后表现为收错钱或额度发错，因此本域的设计重心是版本不可变与引用完整性。

## 2. Capabilities

功能清单：

1. 功能项管理：创建、更新、归档；四种类型（布尔、计量、信用系统、AI 信用系统）；计量项声明聚合方式与使用模式；信用系统声明换算表。
2. 套餐管理：创建、编辑、归档；声明是否为附加包、是否默认、互斥分组；套餐由「权益行 + 价格行 + 试用」组成。
3. 价格与计费类型：一次性、周期固定、用量预付、用量后付、后付按比例；阶梯计价支持渐进与整档两种行为；声明计费单位与升降级差价策略。
4. 权益模板：授予量、重置周期与次数、结转规则、过期规则、超额上限、实体维度配置。
5. 版本化：套餐标识稳定、版本自增；已有客户的套餐变更生成新版本，不原地修改。
6. 删除保护：被信用系统或其他套餐引用、或仍有客户的套餐只能归档，不能删除。
7. 声明式推送：接受来自命令行的整份配置，计算差异后按创建、更新、归档、版本升级四类动作落库。

## 3. Contracts

```ts
type FeatureType = "boolean" | "metered" | "credit_system" | "ai_credit_system";
type ResetInterval = "lifetime" | "minute" | "hour" | "day" | "week" | "month" | "quarter" | "semi_annual" | "year";
type BillingType = "one_off" | "fixed_cycle" | "usage_in_advance" | "usage_in_arrear" | "usage_below_threshold";
type TierBehavior = "graduated" | "volume";

interface FeatureDefinition {
  id: string;
  name: string;
  type: FeatureType;
  eventNames?: string[];
  metered?: { usageType: "single_use" | "continuous_use"; aggregate: "sum" };
  creditSchema?: Array<{ featureId: string; creditCost: number }>;
}

interface EntitlementTemplate {
  featureId: string;
  allowanceType: "fixed" | "unlimited" | "none";
  allowance?: number;
  interval: ResetInterval;
  intervalCount?: number;
  rollover?: { max?: number; maxPercentage?: number; duration: "month" | "forever"; length?: number };
  usageLimit?: number;
  expiry?: { duration: "day" | "week" | "month" | "year"; length: number };
}

interface PriceDefinition {
  id: string;
  billingType: BillingType;
  amount?: number;
  tiers?: Array<{ to: number | "inf"; amount: number }>;
  tierBehavior?: TierBehavior;
  interval?: ResetInterval;
  billingUnits?: number;
  proration?: { onIncrease: string; onDecrease: string };
  entitlementId?: string;
}

interface PlanDefinition {
  id: string;
  name: string;
  version: number;
  isAddOn: boolean;
  isDefault: boolean;
  group: string;
  entitlements: EntitlementTemplate[];
  prices: PriceDefinition[];
  freeTrial?: { duration: "day" | "month" | "year"; length: number; onEnd: "bill" | "revert" };
  archived: boolean;
}

interface PublishResult {
  planId: string;
  version: number;
  action: "created" | "updated_in_place" | "versioned" | "archived";
  affectedCustomerCount: number;
}

abstract class CatalogService {
  abstract publishPlan(input: PlanDefinition, options?: { dryRun?: boolean }): Promise<PublishResult>;
  abstract archiveFeature(input: { featureId: string }): Promise<void>;
  abstract validatePlan(input: PlanDefinition): Promise<ValidationIssue[]>;
}
```

错误约定：校验失败抛出带字段路径的结构化错误；引用冲突返回稳定失败码；并发发布同一套餐时以数据库唯一约束为准，后到者失败并提示重试。

## 4. Core Flows

### 4.1 Publish Plan

发布是幂等偏序操作：同一份声明重复推送应得到同一版本，不产生空版本。

```ts
async function publishPlan(input: PlanDefinition, ctx: CatalogContext): Promise<PublishResult> {
  const issues = await validatePlan(input, ctx);
  if (issues.length > 0) throw new CatalogValidationError(issues);

  const existing = await ctx.plans.findByKey(input.id, ctx.orgId, ctx.env);
  if (!existing) {
    const created = await ctx.plans.insert({ ...input, version: 1 });
    await ctx.events.emit("catalog.plan.created", created);
    return { planId: created.id, version: 1, action: "created", affectedCustomerCount: 0 };
  }

  const { customerCount } = await ctx.plans.usage(existing.internalId);
  if (!differs(existing, input)) {
    return { planId: existing.id, version: existing.version, action: "updated_in_place", affectedCustomerCount: customerCount };
  }
  if (customerCount === 0) {
    const updated = await ctx.plans.replace(existing.internalId, input);
    await ctx.events.emit("catalog.plan.updated", updated);
    return { planId: updated.id, version: existing.version, action: "updated_in_place", affectedCustomerCount: 0 };
  }
  const nextVersion = existing.version + 1;
  const versioned = await ctx.plans.insertVersion(existing.internalId, { ...input, version: nextVersion });
  await ctx.events.emit("catalog.plan.versioned", versioned);
  return { planId: versioned.id, version: nextVersion, action: "versioned", affectedCustomerCount: customerCount };
}

async function archiveFeature(featureId: string, ctx: CatalogContext): Promise<void> {
  const refs = await ctx.catalog.referencesTo(featureId);
  if (refs.creditSystems.length > 0 || refs.plans.length > 0) {
    throw new CatalogReferenceError({ featureId, code: "CAT-409-001", references: refs });
  }
  await ctx.catalog.markArchived(featureId);
  await ctx.events.emit("catalog.feature.archived", { featureId });
}
```

失败分支：校验失败不落库；版本升级写失败时已有版本保持可用，写事务回滚；事件投递失败不回滚定义，由订阅方按库内版本重读。

### 4.2 Validate Plan

校验顺序固定，先结构后语义，最后是经济性检查：权益行引用的功能项必须存在且未归档；价格行的计费类型与金额结构必须匹配；阶梯金额必须单调递增且首档起点为零；同一套餐内同一功能项不得出现两行互斥权益；试用与一次性价格不得共存于同一行。

### 4.3 Push Configuration

声明式推送按「远端快照 → 差异 → 用户确认 → 分批执行」推进。执行顺序为先功能项后套餐，先创建后归档，最后触发受影响客户的迁移提示。任一步失败即停止后续步骤，已执行部分保留并在结果中逐条列出，重试时按同一份差异重算，已成功的条目自然变为无差异。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| CAT-A1 | 首次发布 | 组织内无同名套餐 | 发布合法套餐 | 版本为 1，可被结算引擎检索到 |
| CAT-A2 | 有客户时改价 | 套餐已有 3 个客户 | 修改价格并发布 | 生成版本 2，3 个客户仍绑定版本 1 |
| CAT-A3 | 删除被引用功能项 | 功能项被信用系统引用 | 请求归档该功能项 | 拒绝，返回 `CAT-409-001`，引用清单一并返回 |
| CAT-A4 | 阶梯非法 | 无 | 提交首档从 10 开始的阶梯 | 校验失败，错误指向 `prices[0].tiers`，不落库 |
| CAT-A5 | 重复推送 | 已推送一次且远端一致 | 再次推送同一份配置 | 无差异，不产生新版本 |
| CAT-A6 | 推送中断后重试 | 上一次在第 3 步失败 | 重试同一份配置 | 前三步中已成功者跳过，从失败项继续 |
| CAT-A7 | 归档套餐再购买 | 套餐已归档 | 发起接入请求 | 结算引擎拒绝，返回 `BILL-410-002` |
