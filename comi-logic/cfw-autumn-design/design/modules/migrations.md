---
title: 迁移
description: 套餐与客户的批量迁移、试运行、断点续跑与回滚。
sidebar:
  order: 37
  label: 迁移 Migrations
lastUpdated: 2026-11-05
---

迁移模块把「存量客户换到新套餐」这件事做成可预演、可分批、可中断、可回滚的作业：它先冻结筛选条件与操作集合，再以逐客户为单位推进，每一步都留下可核查的记录。它是外围域——没有迁移，历史客户仍能用旧套餐，只是无法批量演进。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 迁移负责 | 不负责 |
| --- | --- | --- |
| 客户 | 按条件筛选目标客户 | 客户身份 |
| 套餐 | 读取新旧套餐并校验兼容性 | 定义套餐 |
| 结算 | 为每个客户生成变更计划 | 执行资金动作 |
| 账本 | 声明额度如何处理（保留、重算、清零） | 维护余额 |

## 2. Capabilities

1. 定义迁移：筛选条件（套餐、状态、创建时间、标签）、操作集合（换套餐、改价格、改额度、清余额）、是否影响计费。
2. 预演：按条件抽样，输出受影响客户数、预计金额变化与不可迁移清单，不写任何数据。
3. 试运行：对全量客户计算变更但不落库，逐客户产出变更摘要。
4. 正式运行：分批推进，每客户一个可重试单元，支持并发上限与按客户串行。
5. 断点续跑：中断后从上次进度继续，已成功项跳过。
6. 取消：请求取消后不再领取新客户，已在处理中的客户完成当前事务后停止。
7. 惰性迁移：读取客户时发现存在未完成迁移，按需在后台为该客户补齐。
8. 审计：每个客户的处理结果、耗时、错误与变更前后快照可查。

## 3. Contracts

```ts
type MigrationStatus = "draft" | "prepared" | "running" | "succeeded" | "failed" | "canceled";
type ItemStatus = "pending" | "running" | "succeeded" | "skipped" | "failed";

interface MigrationPlan {
  id: string;
  orgId: string;
  env: "sandbox" | "live";
  filter: { planIds?: string[]; statuses?: string[]; createdBefore?: number; tag?: string };
  operations: Array<
    | { kind: "change_plan"; fromPlanId: string; toPlanId: string; prorate: boolean }
    | { kind: "set_allowance"; featureId: string; allowance: number }
    | { kind: "reset_balance"; featureId: string }
  >;
  noBillingChanges: boolean;
  retryFailed: boolean;
}

interface MigrationRun {
  id: string;
  migrationId: string;
  dryRun: boolean;
  status: MigrationStatus;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

abstract class MigrationService {
  abstract prepare(input: { migration: MigrationPlan }): Promise<{ total: number; blocked: Array<{ customerId: string; reason: string }> }>;
  abstract run(input: { migrationId: string; dryRun: boolean; concurrency?: number }): Promise<MigrationRun>;
  abstract cancel(input: { runId: string }): Promise<MigrationRun>;
  abstract resume(input: { runId: string }): Promise<MigrationRun>;
}
```

## 4. Core Flows

### 4.1 Run

```ts
async function runMigration(input: { runId: string; concurrency: number }, ctx: MigrationContext) {
  const run = await ctx.runs.claim(input.runId);           // 同时只允许一个活动运行
  if (!run) throw new MigrationError({ code: "MIG-409-001", runId: input.runId });
  if (run.dryRun) return ctx.runs.executeDry(run);

  const limit = Math.min(input.concurrency ?? 5, 5);
  for await (const batch of ctx.items.pendingBatches(run.migrationId, limit)) {
    if (await ctx.runs.isCancelRequested(run.id)) break;
    await Promise.all(
      batch.map(async (item) => {
        const claimed = await ctx.items.claim(item.id);        // 唯一约束保证不重复领取
        if (!claimed) return;
        try {
          const plan = await ctx.billing.planForMigration({ customerId: item.customerId, operations: run.operations });
          await ctx.billing.apply(plan);
          await ctx.items.succeed(item.id, { snapshot: plan.summary });
        } catch (error) {
          await ctx.items.fail(item.id, { error: String(error) });
        }
      }),
    );
  }
  return ctx.runs.finish(run.id);
}
```

失败分支：单客户失败不影响其他客户，失败项单独可重试；运行级失败保留已完成进度，续跑从失败项继续；同一迁移并发启动两次时第二次被唯一约束拒绝。

### 4.2 Prepare

预演逐条检查可迁移性：目标套餐是否仍可售、客户是否处于可变更状态、变更是否会产生未支付发票、额度是否有未结算的锁定。不可迁移的客户连同原因一并返回，正式运行时默认跳过并计入 `skipped`。

### 4.3 Lazy Migration

惰性迁移挂在读取路径上：读取客户时若发现命中未完成迁移，投递一个只针对该客户的任务并立即返回当前数据；任务完成后的下一次读取返回新状态。任务重复投递由「客户 + 迁移」唯一键去重。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| MIG-A1 | 预演 | 100 个匹配客户 | 执行预演 | 返回 100，其中不可迁移项带原因，库内无变化 |
| MIG-A2 | 正式运行 | 预演通过 | 以并发 5 运行 | 全部成功，逐客户有结果记录 |
| MIG-A3 | 中断续跑 | 运行到 60% 中断 | 恢复运行 | 已完成 60 个跳过，剩余继续，无重复变更 |
| MIG-A4 | 取消 | 运行中请求取消 | 取消 | 不再领取新客户，运行状态为已取消 |
| MIG-A5 | 并发启动 | 同一迁移两次启动 | 同时运行 | 第二次拒绝，返回 `MIG-409-001` |
| MIG-A6 | 惰性迁移 | 客户有未完成迁移 | 读取该客户 | 立即返回旧数据，后台补齐后返回新数据 |
| MIG-A7 | 单客户失败 | 某客户目标套餐已归档 | 运行 | 该客户失败，其余成功，失败项可重试 |
