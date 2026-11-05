---
title: 支付通道
description: 通道适配、回调验签、履约与对账的多服务商隔离层。
sidebar:
  order: 33
  label: 支付通道 Payments
lastUpdated: 2026-11-05
---

支付通道模块把不同支付服务商的协议差异关在适配器里，对上只暴露四个语义：发起支付、查询、关闭、解析通知。它是外围域——单通道部署时可以内联到结算引擎，但一旦要支持第二个服务商，没有这层就会污染全部核心逻辑。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 通道负责 | 不负责 |
| --- | --- | --- |
| 结算 | 执行通道动作、返回通道结果 | 决定扣多少、何时扣 |
| 购买会话 | 提供支付方式能力与跳转地址 | 会话状态 |
| 发票 | 对齐通道发票号与金额 | 行项目计算 |
| 租户 | 读取通道配置与密钥 | 配置录入界面 |

## 2. Capabilities

1. 通道注册：按组织与环境启用一个或多个通道，各自持独立配置。
2. 支付发起：卡支付跳转、一次性支付、扫码支付（返回二维码内容）。
3. 查询与关闭：按通道单号查询状态、主动关闭未支付单。
4. 通知解析：验签、解密、映射为内部状态；不合法通知一律拒绝。
5. 幂等履约：同一通知重复到达只履约一次；履约与状态推进分离。
6. 退款：按支付单或发票退款，支持部分退款。
7. 对账：按日拉取通道流水与本地记录比对，产出差异清单。

## 3. Contracts

```ts
type Provider = "stripe" | "revenuecat" | "wechatpay" | "alipay";

interface PaymentIntent {
  id: string;
  provider: Provider;
  amount: number;
  currency: string;
  status: "created" | "requires_action" | "processing" | "paid" | "failed" | "expired" | "refunding" | "refunded";
  providerReference: string;
  action?: { kind: "redirect"; url: string } | { kind: "qr_code"; content: string };
  expiresAt: number;
}

interface ParsedNotification {
  providerEventId: string;
  intentReference: string;
  status: PaymentIntent["status"];
  paidAt?: number;
  raw: Record<string, unknown>;
}

abstract class PaymentAdapter {
  abstract provider: Provider;
  abstract createPayment(input: { intentId: string; amount: number; currency: string; description: string }): Promise<PaymentIntent>;
  abstract queryPayment(input: { providerReference: string }): Promise<PaymentIntent>;
  abstract closePayment(input: { providerReference: string }): Promise<void>;
  abstract parseNotification(input: { headers: Record<string, string>; body: string }): Promise<ParsedNotification>;
}

abstract class PaymentService {
  abstract createIntent(input: { sessionId: string; provider: Provider; amount: number }): Promise<PaymentIntent>;
  abstract handleNotification(input: { provider: Provider; headers: Record<string, string>; body: string }): Promise<{ handled: boolean }>;
  abstract refund(input: { intentId: string; amount?: number }): Promise<{ refunded: number }>;
  abstract reconcile(input: { provider: Provider; day: string }): Promise<{ differences: Array<Record<string, unknown>> }>;
}
```

## 4. Core Flows

### 4.1 Handle Notification

通知处理分四步：验签解密、事件去重、状态推进、履约。任何一步失败都不得影响前一步的持久化结果。

```ts
async function handleNotification(input: HandleNotificationInput, ctx: PaymentContext) {
  const adapter = ctx.adapters.get(input.provider);
  let parsed: ParsedNotification;
  try {
    parsed = await adapter.parseNotification({ headers: input.headers, body: input.body });
  } catch (error) {
    throw new PaymentError({ code: "PAY-401-001", provider: input.provider, cause: error });
  }

  const recorded = await ctx.intents.recordEvent({
    provider: input.provider,
    providerEventId: parsed.providerEventId,
    idempotencyKey: `${input.provider}:${parsed.providerEventId}`,
    payload: parsed.raw,
  });
  if (!recorded.inserted) return { handled: false }; // 重复通知，直接确认

  const intent = await ctx.intents.applyStatus({ reference: parsed.intentReference, status: parsed.status, paidAt: parsed.paidAt });
  if (intent.status !== "paid") return { handled: true };

  const fulfilled = await ctx.fulfillments.runOnce({
    intentId: intent.id,
    idempotencyKey: `fulfillment:${intent.id}`,
    run: () => ctx.billing.completeFromPayment(intent),
  });
  if (fulfilled.status === "failed") throw new PaymentError({ code: "PAY-500-002", intentId: intent.id });
  return { handled: true };
}
```

失败分支：验签失败直接拒绝且不落事件；事件已记录但状态推进失败时，通道重投会命中重复键，此时先查本地状态再补推进；履约失败保留 `failed` 记录并允许人工重放，不重复扣款。

### 4.2 Reconcile

对账以「通道流水为准、本地记录为对象」：逐笔比对手续费、金额、状态与时间，差异分为四类——本地缺失、本地多出、金额不符、状态不符。每类产出可执行的修复动作，运维确认后执行；不自动修改资金状态。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| PAY-A1 | 正常通知 | 已创建支付单 | 投递合法通知 | 状态变为已支付并完成履约 |
| PAY-A2 | 验签失败 | 无 | 投递签名错误的通知 | 拒绝，返回 `PAY-401-001`，不落事件 |
| PAY-A3 | 重复通知 | 同一事件已处理 | 再次投递 | 返回未处理标记，不重复履约 |
| PAY-A4 | 履约失败 | 通知合法但本地写入失败 | 处理通知 | 记录失败，允许重放，资金不重复扣 |
| PAY-A5 | 退款部分 | 已支付 100 | 退款 30 | 返回退款 30，剩余 70 仍有效 |
| PAY-A6 | 对账差异 | 通道多一笔本地无记录 | 执行对账 | 产出「本地缺失」差异项，不改数据 |
