---
title: 额度账本
description: 余额实例、重置与结转、扣减顺序、锁定凭证与准入判定。
sidebar:
  order: 21
  label: 额度账本 Balances
lastUpdated: 2026-11-05
---

额度账本回答「还能不能用」：它把目录里的授予模板落成客户或实体维度的余额实例，维护重置、结转、过期与扣减，并在每次准入请求上给出允许与否的结论。它是全系统读写比最高的模块，也是唯一有权限说「不行」的模块。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 账本负责 | 不负责 |
| --- | --- | --- |
| 定价目录 | 按模板创建实例并解释重置语义 | 定义授予量与价格 |
| 结算引擎 | 在套餐变更时被调用，执行授予与回收 | 决定买什么、扣多少钱 |
| 事件 | 消费用量事件，执行扣减 | 事件接收、去重与批量 |
| 客户 | 按客户或实体维护实例 | 客户身份 |
| 发票 | 给出本期用量与超额数 | 出账与收款 |

### 1.2 Core Position

账本是「产品承诺」的兑现处：集成方调用的每个准入判断都由它回答，每个用量上报最终都落成它的一次扣减。它的失守方式有两种，都不可接受：一是少算（客户超用却仍被允许），二是多扣（客户没用完却被判失败）。因此本域所有写动作都必须在一个事务内完成，且必须留下可重放的凭证。

## 2. Capabilities

1. 余额实例：按客户或实体创建，支持不限量、固定额度、无额度三种授予；记录可用额度、额外额度、下次重置时刻与过期时刻。
2. 结转：按比例与上限把上一周期剩余额度转入下一周期，结转额度独立过期。
3. 重置：按分钟到年的周期重置；订阅类实例以账期锚点对齐，重置与扣款同一天发生。
4. 扣减：按到期先后消耗结转、额外额度与基础额度；支持按实体分摊；支持一次请求多个功能项的批量扣减。
5. 准入判定：按需求量判断是否允许，支持信用系统换算，支持返回差额与剩余额度。
6. 锁定：准入时可预占额度并返回凭证，凭证到期由调度自动释放，也可由集成方显式结算。
7. 自动充值：余额跌破阈值时按配置触发一次充值，带突发抑制。
8. 上限与告警：客户级与实体级的消费上限、用量上限、超额开关、阈值告警。
9. 重算：按事件历史重算某客户某功能项的余额，用于纠正漂移。

## 3. Contracts

```ts
type BalanceSubject = { customerId: string; entityId?: string; featureId: string };

interface BalanceView {
  featureId: string;
  entityId?: string;
  unlimited: boolean;
  granted: number;
  remaining: number;
  usage: number;
  nextResetAt?: number;
  expiresAt?: number;
  rolloverRemaining?: number;
}

interface CheckInput {
  subject: BalanceSubject;
  requiredBalance?: number;
  sendEvent?: boolean;
  lock?: { enabled: true; expiresAt: number; receiptKey?: string };
}

interface CheckResult {
  allowed: boolean;
  requiredBalance: number;
  balance: BalanceView | null;
  shortfall: number;
  lockReceipt?: string;
}

interface DeductionRequest {
  subject: BalanceSubject;
  amount: number;
  eventId: string;
  idempotencyKey?: string;
  properties?: Record<string, string | number | boolean>;
}

abstract class BalanceService {
  abstract check(input: CheckInput): Promise<CheckResult>;
  abstract deduct(request: DeductionRequest): Promise<{ deducted: number; remaining: number }>;
  abstract grant(input: { subject: BalanceSubject; amount: number; expiresAt?: number; reason: string }): Promise<BalanceView>;
  abstract reset(input: { customerEntitlementId: string; now: number }): Promise<BalanceView>;
  abstract recalculate(input: { subject: BalanceSubject; from: number; to: number }): Promise<BalanceView>;
}
```

错误约定：余额不足不是异常，而是 `allowed: false`；写路径的资源冲突、凭证重复、数据不一致才抛错，并附稳定失败码。

## 4. Core Flows

### 4.1 Check

判定必须只读：除显式要求写事件或加锁外，不得修改任何余额行。

```ts
async function check(input: CheckInput, ctx: BalanceContext): Promise<CheckResult> {
  const subject = await ctx.subjects.resolve(input.subject);
  if (!subject) return { allowed: false, requiredBalance: 0, balance: null, shortfall: 0 };

  const required = await ctx.credit.convertIfNeeded(subject, input.requiredBalance ?? 1);
  const view = await ctx.balances.read(subject);
  if (!view) return { allowed: false, requiredBalance: required, balance: null, shortfall: required };
  if (view.unlimited) return { allowed: true, requiredBalance: required, balance: view, shortfall: 0 };

  const allowed = view.remaining >= required || subject.usageAllowed;
  if (allowed && input.lock?.enabled) {
    const receipt = await ctx.locks.reserve({ subject, amount: required, expiresAt: input.lock.expiresAt, key: input.lock.receiptKey });
    return { allowed: true, requiredBalance: required, balance: view, shortfall: 0, lockReceipt: receipt };
  }
  return { allowed, requiredBalance: required, balance: view, shortfall: Math.max(required - view.remaining, 0) };
}
```

失败分支：读取缓存不可用时回源数据库并标记降级；锁定写入失败时不发凭证但保留允许结论（读路径不因写失败而阻塞），由调用方按未锁定流程处理；凭证键重复时返回冲突码，提示调用方复用既有凭证。

### 4.2 Deduct

扣减是唯一会改变余额的同步路径，必须单事务、幂等、可重放。

```ts
async function deduct(request: DeductionRequest, ctx: BalanceContext): Promise<{ deducted: number; remaining: number }> {
  const subject = await ctx.subjects.resolve(request.subject);
  if (!subject) throw new BalanceError({ code: "BAL-404-001", subject: request.subject });

  if (request.idempotencyKey) {
    const seen = await ctx.events.findDeduction(request.idempotencyKey);
    if (seen) return { deducted: seen.deducted, remaining: seen.remaining };
  }

  return ctx.db.transaction(async (tx) => {
    const ents = await ctx.balances.lockForUpdate(tx, subject);
    if (ents.length === 0) throw new BalanceError({ code: "BAL-409-002", subject: request.subject });

    const plan = ctx.allocator.allocate({ ents, amount: request.amount });
    if (plan.shortfall > 0 && !subject.overageAllowed) {
      throw new BalanceError({ code: "BAL-402-001", shortfall: plan.shortfall, subject: request.subject });
    }

    for (const line of plan.lines) {
      await ctx.balances.applyDeduction(tx, line);
      await ctx.windows.addUsage(tx, { subject, amount: line.amount });
    }
    const inserted = await ctx.events.insertDeduction(tx, { request, plan, idempotencyKey: request.idempotencyKey });
    if (!inserted) throw new BalanceError({ code: "BAL-409-003", idempotencyKey: request.idempotencyKey });
    return { deducted: plan.total, remaining: plan.remainingAfter };
  }).then(async (result) => {
    await ctx.cache.invalidate(subject);
    if (result.remaining <= subject.alertThreshold) {
      await ctx.events.emit("balances.threshold_reached", { subject, remaining: result.remaining });
    }
    return result;
  });
}
```

失败分支：行锁等待超时返回可重试冲突；事务内任一步失败整笔回滚，不产生部分扣减；幂等键重复时返回首次结果而不重复扣减；缓存失效失败只记录，不阻断返回，读路径有版本号兜底。

### 4.3 Reset

重置由定时调度批量驱动，读路径对已过期但未重置的实例做惰性重置兜底。重置顺序为：结算上一周期的结转、写入结转行、按模板重算起始额度、设置下一次重置时刻。重置与订阅账期对齐：订阅类实例的下次重置时刻取账期锚点，而非「上次重置 + 一个月」，以避免漂移。

失败分支：批量任务处理到某客户失败时跳过该客户并记录，不阻塞同批；惰性重置与批量重置同时发生时以数据库行锁串行，先到者生效，后到者读到已重置状态直接返回。

### 4.4 Lock and Release

锁定凭证记录预占额度与到期时刻，写入时带唯一键；释放按「凭证号 + 动作」幂等执行，重复释放返回已释放状态而不报错。凭证过期由调度任务扫描并释放，释放失败的凭证在下一次扫描中重试，超过三次进入人工处理队列。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| BAL-A1 | 足额准入 | 余额 100，需求 30 | 调用准入 | 允许，剩余 100，不扣减 |
| BAL-A2 | 不足准入 | 余额 10，需求 30 | 调用准入 | 拒绝，差额 20，余额不变 |
| BAL-A3 | 无限量 | 授予为不限量 | 需求 10 万 | 允许，不写用量 |
| BAL-A4 | 并发扣减 | 余额 100，两笔 60 并发 | 同时扣减 | 一笔成功一笔失败，总额不超 100 |
| BAL-A5 | 幂等重放 | 同一幂等键扣减两次 | 重复提交 | 第二次返回首次结果，余额只减一次 |
| BAL-A6 | 事务失败回滚 | 扣减中途数据库报错 | 触发扣减 | 余额、用量窗口均无变化，错误可重试 |
| BAL-A7 | 锁定释放 | 已发凭证 50，到期未结算 | 调度扫描 | 预占释放，余额恢复 50 |
| BAL-A8 | 到期结转 | 上期剩余 20，结转上限 10 | 周期重置 | 结转 10，其余清零，结转单独过期 |
| BAL-A9 | 重算纠偏 | 手工改过余额 | 触发重算 | 按事件历史还原，差异写入审计 |
