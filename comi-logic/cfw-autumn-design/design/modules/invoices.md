---
title: 发票
description: 账单文档、行项目、折扣、退款与托管账单页。
sidebar:
  order: 34
  label: 发票 Invoices
lastUpdated: 2026-11-05
---

发票模块保存「已经发生的账」：它把结算计划产出的行项目落成可展示、可下载、可退款的账单文档，并保证本地金额与支付通道金额始终可对照。它是外围域——没有发票，收款仍能完成，但失去对账与争议处理依据。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 发票负责 | 不负责 |
| --- | --- | --- |
| 结算 | 接收行项目、推进状态 | 计算金额与策略 |
| 支付通道 | 对齐通道发票号与金额 | 通道协议 |
| 客户 | 归属到客户与实体 | 客户身份 |
| 控制台 | 提供列表、详情与下载地址 | 页面渲染 |

## 2. Capabilities

1. 发票创建：草稿态创建，写入折扣快照与行项目。
2. 行项目：追加式写入，区分收费与退款方向、预付与后付时点、折前折后金额、计费区间与来源实例。
3. 状态推进：草稿、待付、已付、作废、无法收回；只允许单向推进与显式作废。
4. 折扣：百分比与固定额，支持一次性与多期；折扣快照随发票冻结。
5. 退款：按发票或按行项目部分退款，回写已退金额并生成退款方向行项目。
6. 托管页：返回通道托管账单地址，供终端用户查看与下载。
7. 对账：以通道发票为准清理本地过期行项目，支持只对账不重算。
8. 模板：组织可配置账单页展示的品牌信息与页脚。

## 3. Contracts

```ts
interface InvoiceLine {
  stripeId?: string;
  description: string;
  amount: number;
  amountAfterDiscounts: number;
  currency: string;
  direction: "charge" | "refund";
  billingTiming: "in_advance" | "in_arrear";
  periodStart?: number;
  periodEnd?: number;
  prorated: boolean;
  customerProductIds: string[];
}

interface InvoiceView {
  id: string;
  customerId: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  total: number;
  amountPaid: number;
  refundedAmount: number;
  currency: string;
  hostedUrl?: string;
  lineItems: InvoiceLine[];
  periodStart?: number;
  periodEnd?: number;
}

abstract class InvoiceService {
  abstract createDraft(input: { customerId: string; currency: string; lines: InvoiceLine[] }): Promise<InvoiceView>;
  abstract finalize(input: { invoiceId: string }): Promise<InvoiceView>;
  abstract markPaid(input: { invoiceId: string; paidAt: number }): Promise<InvoiceView>;
  abstract void(input: { invoiceId: string; reason: string }): Promise<InvoiceView>;
  abstract refund(input: { invoiceId: string; amount?: number }): Promise<InvoiceView>;
  abstract reconcile(input: { invoiceId: string; lines: InvoiceLine[] }): Promise<InvoiceView>;
}
```

## 4. Core Flows

### 4.1 Finalize and Pay

```ts
async function markPaid(input: { invoiceId: string; paidAt: number }, ctx: InvoiceContext) {
  return ctx.db.transaction(async (tx) => {
    const invoice = await ctx.invoices.lockForUpdate(tx, input.invoiceId);
    if (!invoice) throw new InvoiceError({ code: "INV-404-001", invoiceId: input.invoiceId });
    if (invoice.status === "paid") return invoice;           // 幂等
    if (invoice.status === "void") throw new InvoiceError({ code: "INV-409-001", invoiceId: invoice.id, status: "void" });

    const paid = await ctx.invoices.updateStatus(tx, invoice.id, { status: "paid", amountPaid: invoice.total, paidAt: input.paidAt });
    await ctx.ledger.recordPayment(tx, { invoiceId: invoice.id, amount: invoice.total, at: input.paidAt });
    return paid;
  });
}
```

失败分支：状态非法时拒绝并保持原状态；同一发票重复支付回调直接返回已付；事务失败则金额与状态均不变。

### 4.2 Reconcile

对账模式只重算行项目集合，不改发票状态与金额：拉取通道行项目，按通道行项目号比对本地记录，删除本地多出的行、补齐缺失的行、更新金额变化的行。写入在事务内完成，失败回滚到对账前快照。

### 4.3 Refund

退款先校验可退金额（已付减去已退），再生成退款行项目并调用通道退款；通道成功后回写已退金额与状态，通道失败则删除退款行项目。部分退款允许多次，累计不超过已付。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| INV-A1 | 正常支付 | 发票待付，金额 100 | 标记支付 | 状态为已付，已付金额 100 |
| INV-A2 | 重复支付 | 已付发票 | 再次标记支付 | 返回同一结果，金额不叠加 |
| INV-A3 | 作废后支付 | 发票已作废 | 标记支付 | 拒绝，返回 `INV-409-001` |
| INV-A4 | 部分退款 | 已付 100，已退 0 | 退 30 | 已退 30，状态仍为已付 |
| INV-A5 | 超额退款 | 已付 100，已退 80 | 退 30 | 拒绝，提示可退上限 20 |
| INV-A6 | 对账清理 | 本地多一条过期行项目 | 执行对账 | 该行被删除，发票金额按剩余行重算 |
