---
title: 购买会话
description: 结算会话的创建、预览、确认、过期与支付方式选择。
sidebar:
  order: 32
  label: 购买会话 Checkout
lastUpdated: 2026-11-05
---

购买会话模块把「需要用户确认的一步」变成一个有状态、可重放、可过期的会话：它冻结下单参数、提供预览、承接支付方式选择，并在确认时把控制权交回结算引擎。它是外围域——没有它，同步可完成的购买仍然成立，只是失去了托管支付页。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 会话负责 | 不负责 |
| --- | --- | --- |
| 结算 | 冻结参数、调用预览与执行 | 计算金额、写客户产品 |
| 支付通道 | 呈现支付方式、承接跳转与二维码 | 验签与通道协议 |
| 客户 | 展示客户与套餐摘要 | 身份创建 |
| 发票 | 展示应付与下期金额 | 开票 |

## 2. Capabilities

1. 会话创建：由结算引擎在计划需要确认时创建，冻结参数快照与参数哈希。
2. 会话读取：按会话标识返回组织信息、客户摘要、待确认计划、是否可调整数量与明细。
3. 预览：接受数量与折扣调整后重新计算，返回行项目、应付、下期应付。
4. 确认：执行冻结的计划，成功后返回结果快照并置为已完成。
5. 支付方式选择：托管支付、国内扫码、账户余额抵扣；选择结果写入会话。
6. 过期：超时未确认自动过期，过期后确认返回已过期并提示重新下单。
7. 重放保护：同一参数重复确认返回首次结果；参数已变更时拒绝。

## 3. Contracts

```ts
interface CheckoutSession {
  id: string;
  action: "attach" | "update_subscription" | "create_schedule";
  status: "pending" | "action_required" | "completed" | "expired";
  paramsHash: string;
  expiresAt: number;
  customer: { id: string; name?: string; email?: string };
  plan: { id: string; name: string; version: number };
  preview: {
    lineItems: Array<{ description: string; amount: number; direction: "charge" | "refund" }>;
    total: number;
    nextCycleTotal?: number;
    currency: string;
  };
  adjustableFeatureIds: string[];
  paymentMethods: Array<"card" | "domestic_qr" | "balance">;
}

abstract class CheckoutService {
  abstract create(input: { planId: string; customerId: string; params: Record<string, unknown>; expiresInMs: number }): Promise<CheckoutSession>;
  abstract preview(input: { sessionId: string; quantity?: number; couponId?: string }): Promise<CheckoutSession["preview"]>;
  abstract confirm(input: { sessionId: string; paymentMethod: string; paramsHash: string }): Promise<{ status: "completed"; result: unknown }>;
  abstract expire(input: { sessionId: string }): Promise<void>;
}
```

## 4. Core Flows

### 4.1 Confirm

```ts
async function confirm(input: { sessionId: string; paymentMethod: string; paramsHash: string }, ctx: CheckoutContext) {
  const session = await ctx.checkouts.get(input.sessionId);
  if (!session) throw new CheckoutError({ code: "CHK-404-001", sessionId: input.sessionId });
  if (session.status === "completed") return { status: "completed" as const, result: session.response };
  if (session.status === "expired" || session.expiresAt <= ctx.now()) {
    await ctx.checkouts.markExpired(session.id);
    throw new CheckoutError({ code: "CHK-410-001", sessionId: session.id });
  }
  if (session.paramsHash !== input.paramsHash) {
    throw new CheckoutError({ code: "CHK-409-002", sessionId: session.id, reason: "params_changed" });
  }

  const lock = await ctx.locks.acquire({ key: `checkout:${session.id}`, ttlMs: 60_000 });
  if (!lock) throw new CheckoutError({ code: "CHK-423-001", sessionId: session.id });

  try {
    const result = await ctx.billing.executeFromSession({ session, paymentMethod: input.paymentMethod });
    await ctx.checkouts.complete(session.id, result);
    return { status: "completed" as const, result };
  } catch (error) {
    await ctx.checkouts.recordFailure(session.id, error);
    throw error;
  } finally {
    await ctx.locks.release(`checkout:${session.id}`);
  }
}
```

失败分支：支付被拒时会话保持可确认状态并记录失败原因，允许换支付方式重试；结算执行失败进入补偿，会话标记 `action_required` 并展示可重试原因；重复确认由「已完成直接返回」与锁双重保护。

### 4.2 Expire

过期由定时任务扫描与读取时惰性判断双路径完成。过期只改状态，不删除记录：记录保留用于排查与重放分析。过期后若支付通道侧会话仍未关闭，按通道能力尝试关闭，失败仅记录。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| CHK-A1 | 正常确认 | 会话未过期、参数一致 | 确认并选择卡支付 | 状态变为已完成，返回结果快照 |
| CHK-A2 | 过期确认 | 会话已过期 | 确认 | 拒绝，返回 `CHK-410-001`，状态保持过期 |
| CHK-A3 | 参数变更 | 会话创建后套餐改价 | 用旧哈希确认 | 拒绝，返回 `CHK-409-002`，提示重新预览 |
| CHK-A4 | 重复确认 | 已完成会话 | 再确认一次 | 返回首次结果，不重复扣款 |
| CHK-A5 | 支付被拒 | 通道拒付 | 确认 | 会话可再次确认，展示拒付原因 |
| CHK-A6 | 数量调整 | 支持按量购买的套餐 | 修改数量后预览 | 行项目与应付同步变化，参数哈希随之更新 |
