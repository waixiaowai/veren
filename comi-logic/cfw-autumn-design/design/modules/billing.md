---
title: 结算引擎
description: 账单计划的生成与执行、支付通道动作编排、升降级与续费退款。
sidebar:
  order: 22
  label: 结算引擎 Billing
lastUpdated: 2026-11-05
---

结算引擎回答「钱怎么动」：它把一次购买或变更翻译成一份可审计、可重放、可部分回滚的账单计划，再按计划依次驱动账本与支付通道。它是全系统唯一有权限创建客户产品实例的模块，也是唯一有权限发起资金动作的模块。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 结算负责 | 不负责 |
| --- | --- | --- |
| 定价目录 | 读取套餐与价格，校验是否可售 | 定义价格 |
| 额度账本 | 调用授予、扣减、回收 | 维护余额本身 |
| 购买会话 | 生成待确认动作并读取确认结果 | 渲染支付页 |
| 支付通道 | 声明动作、驱动适配器、处理结果 | 验签与通道协议细节 |
| 发票 | 生成行项目、推进发票状态 | 发票的展示与下载 |
| 客户 | 读取客户与实体 | 客户身份 |

### 1.2 Core Position

结算是三个核心域中唯一同时触碰资金与套餐生命周期的模块。它必须同时满足两个互相拉扯的约束：对集成方要「一次调用完成所有事」，对系统要「每一步都可单独失败、单独重试、单独回滚」。解法是把「算」与「做」彻底分开：计算是纯函数，产出计划；执行按计划逐条推进，每条都有对应的补偿动作。

## 2. Capabilities

1. 接入：单套餐购买、多套餐同时购买、指定账期锚点、指定生效时间与结束时间。
2. 预览：在不落库的前提下返回应付金额、行项目明细、降级后的额度变化。
3. 变更：升级、降级、加购、减购、换套餐；按差价策略决定立即结算还是下期结算。
4. 取消与恢复：周期末取消、立即取消、取消后恢复；立即取消需作废未付发票。
5. 试用：一次性试用、带卡试用、试用到期转付费或回退到免费套餐。
6. 定时变更：预约未来某时刻的套餐变更，生成分段计划。
7. 续费：由支付通道回调驱动，重算行项目并推进发票状态。
8. 退款：按发票或按行项目退款，支持部分退款。
9. 对账：把本地状态与通道状态对齐，产出差异提案供人工确认。
10. 恢复：按计划标识续跑中断的执行，或按补偿清单回滚已执行动作。

## 3. Contracts

```ts
type AttachAction = "attach" | "multi_attach" | "update_subscription" | "create_schedule" | "cancel" | "restore";

interface AttachInput {
  customerId: string;
  entityId?: string;
  planId: string;
  action: AttachAction;
  successUrl?: string;
  startsAt?: number;
  endsAt?: number;
  billingCycleAnchor?: "now" | "reset";
  discounts?: Array<{ couponId: string }>;
  invoiceMode?: boolean;
  skipBillingChanges?: boolean;
  metadata?: Record<string, string>;
}

interface AutumnPlan {
  customerProducts: Array<{ op: "create" | "update" | "expire"; customerProductId?: string; planId: string; quantity?: number }>;
  entitlements: Array<{ op: "grant" | "deduct" | "reset" | "expire"; customerEntitlementId?: string; amount?: number }>;
  lineItems: Array<{ description: string; amount: number; direction: "charge" | "refund"; periodStart: number; periodEnd: number }>;
  invoices: Array<{ op: "create" | "update" | "void"; invoiceId?: string; total?: number }>;
}

interface RailPlan {
  actions: Array<
    | { kind: "create_subscription"; planId: string; quantity: number }
    | { kind: "update_subscription"; subscriptionId: string; items: unknown[] }
    | { kind: "create_checkout_session"; mode: "payment" | "subscription"; successUrl: string }
    | { kind: "create_invoice"; autoAdvance: boolean }
    | { kind: "finalize_invoice"; invoiceId: string }
    | { kind: "refund"; invoiceId: string; amount?: number }
  >;
  rollback: Array<{ kind: "void_invoice" | "cancel_subscription" | "refund"; targetId: string }>;
}

interface BillingPlan {
  id: string;
  action: AttachAction;
  deferred: boolean;
  autumn: AutumnPlan;
  rail: RailPlan;
  preview: { total: number; currency: string; nextCycleTotal?: number };
}

interface BillingResult {
  planId: string;
  status: "completed" | "requires_action" | "failed";
  paymentUrl?: string;
  invoice?: { id: string; total: number; status: string };
  balances?: Array<{ featureId: string; granted: number }>;
}

abstract class BillingService {
  abstract preview(input: AttachInput): Promise<BillingPlan>;
  abstract execute(input: AttachInput): Promise<BillingResult>;
  abstract resume(planId: string): Promise<BillingResult>;
  abstract rollback(planId: string, reason: string): Promise<void>;
}
```

错误约定：计划生成阶段的失败是请求级错误，直接返回；执行阶段的失败必须落成计划状态并保留补偿清单，不允许只抛异常而不留痕。

## 4. Core Flows

### 4.1 Execute Attach

执行按「取锁、建上下文、算计划、判延迟、执行、回调」六步推进；锁的粒度是客户，避免同一客户的并发变更互相覆盖。

```ts
async function execute(input: AttachInput, ctx: BillingContext): Promise<BillingResult> {
  const lockKey = `billing:${ctx.orgId}:${ctx.env}:${input.customerId}`;
  const acquired = await ctx.locks.acquire({ key: lockKey, ttlMs: 120_000 });
  if (!acquired) throw new BillingError({ code: "BILL-423-001", customerId: input.customerId });

  try {
    const customer = await ctx.customers.full(input.customerId, input.entityId);
    if (!customer) throw new BillingError({ code: "BILL-404-001", customerId: input.customerId });
    const plan = await ctx.catalog.getSellable(input.planId);
    if (!plan) throw new BillingError({ code: "BILL-410-002", planId: input.planId });

    const billingPlan = await computePlan({ input, customer, plan, ctx });
    const stored = await ctx.plans.insert({ ...billingPlan, paramsHash: hash(input), status: "pending" });

    if (billingPlan.deferred) {
      const session = await ctx.rails.createCheckoutSession({ plan: billingPlan, successUrl: input.successUrl });
      await ctx.plans.update(stored.id, { status: "requires_action", externalRef: session.id });
      return { planId: stored.id, status: "requires_action", paymentUrl: session.url };
    }

    return await applyPlan(stored.id, ctx);
  } finally {
    await ctx.locks.release(lockKey);
  }
}

async function applyPlan(planId: string, ctx: BillingContext): Promise<BillingResult> {
  const plan = await ctx.plans.get(planId);
  if (plan.status === "completed") return plan.result; // 幂等：重复执行返回首次结果
  const executed: Array<{ kind: string; targetId: string }> = [];

  try {
    for (const action of plan.rail.actions) {
      const result = await ctx.rails.apply(action);
      executed.push({ kind: action.kind, targetId: result.id });
    }
    const posted = await ctx.db.transaction(async (tx) => {
      await ctx.autumn.apply(tx, plan.autumn);
      return ctx.plans.markCompleted(tx, planId, { executed });
    });
    await ctx.hooks.afterCommit(planId, posted);
    return posted.result;
  } catch (error) {
    await ctx.plans.markFailed(planId, { error, executed });
    await compensate({ planId, executed, ctx });
    throw new BillingError({ code: "BILL-502-001", planId, cause: error });
  }
}
```

失败分支：通道动作失败时先落失败状态再补偿，补偿只针对已成功的动作且自身幂等；本地事务失败时通道动作按登记顺序反向补偿（先退款再作废订阅）；补偿失败进入人工队列并保持计划为失败态，不自动重试资金动作。

### 4.2 Compute Plan

计划计算必须是纯函数：输入客户快照、套餐快照、当前时刻与策略，输出金额与动作，不读写数据库。计算规则按顺序执行：解析生效时间与账期锚点 → 计算升降级差价 → 应用折扣与试用 → 生成行项目 → 决定是否需要用户确认 → 生成通道动作与补偿清单。

差价策略按「立即结算」「下期结算」「按比例折算」三档，由套餐的升降级配置决定；同一张发票内混用多种策略时，行项目按策略分组，避免抵扣顺序歧义。

### 4.3 Preview

预览与执行共用同一个计算函数，差别只在于预览不取锁、不落库、不创建通道会话。预览结果必须带「与执行时是否一致」的判定依据：把输入参数哈希一并返回，执行时比对哈希，不一致则拒绝执行并要求重新预览，避免用户看到的金额与实际扣款不一致。

### 4.4 Renewal

续费不由定时任务发起，而由通道回调触发：收到「发票已支付」或「订阅已更新」后，按通道订阅号找到客户产品，重算本期行项目，推进发票与账本，再投递产品变更事件。回调处理是幂等的：同一事件编号重复到达只处理一次；处理中发现本地状态已领先于事件，则跳过并记录对账差异。

### 4.5 Sync and Restore

对账用于修复本地与通道的漂移，只产出提案不直接改数据；运维确认后按提案执行。恢复用于把「已取消」的订阅在周期结束前恢复，要求通道仍可恢复且本地未过期，否则返回不可恢复并说明原因。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| BILL-A1 | 单套餐同步购买 | 免确认的固定价套餐 | 发起接入 | 计划完成，客户产品与额度同时生效，返回发票摘要 |
| BILL-A2 | 需要确认 | 需跳转支付的套餐 | 发起接入 | 返回 `requires_action` 与结算页地址，本地无客户产品 |
| BILL-A3 | 并发变更 | 同一客户两笔变更并发 | 同时发起 | 一笔成功，另一笔返回 `BILL-423-001` |
| BILL-A4 | 通道失败补偿 | 通道拒付 | 发起接入 | 计划为失败态，已执行动作被补偿，额度无净变化 |
| BILL-A5 | 执行中断续跑 | 执行到一半进程终止 | 重新执行同一计划 | 已完成动作不重复，剩余动作继续 |
| BILL-A6 | 预览与执行不一致 | 预览后套餐改价 | 用旧预览结果执行 | 拒绝执行，返回参数已变化的冲突码 |
| BILL-A7 | 重复回调 | 同一通道事件投递两次 | 两次到达 | 只推进一次，第二次返回已处理 |
| BILL-A8 | 立即取消 | 存在未付发票 | 立即取消 | 订阅终止，未付发票作废，返回作废清单 |
| BILL-A9 | 降级差价 | 月中降级 | 发起变更 | 行项目按策略生成，金额与预览一致 |
