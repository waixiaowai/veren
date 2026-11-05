---
title: 客户
description: 计费主体与子实体的身份、缓存、控制项与生命周期。
sidebar:
  order: 30
  label: 客户 Customers
lastUpdated: 2026-11-05
---

客户模块维护「谁在被计费」：它给外部标识发一个稳定的内部身份，把子实体挂在这层身份下，并承载客户级的计费控制项。它不判断能不能用、也不计算金额，只保证同一次查询在缓存与数据库之间返回同一份事实。

## 1. Responsibility

### 1.1 Boundary

本模块是外围域：它被所有核心域依赖，但自身不承载定价或资金判断。它与身份模块的分界是：身份管「操作者是谁」，客户管「被计费者是谁」；与账本的分界是：客户只存控制项（上限、自动充值规则），不存余额。

| 相邻模块 | 客户负责 | 不负责 |
| --- | --- | --- |
| 身份 | 提供客户与账号的弱关联（可选） | 登录、密钥、授权 |
| 账本 | 提供实体维度与客户级上限 | 计算余额 |
| 结算 | 提供客户快照与实体列表 | 决定套餐 |
| 事件 | 提供客户解析与去重键 | 事件内容校验 |

## 2. Capabilities

1. 客户创建与查询：按外部标识或邮箱取或建，重复调用返回同一内部身份。
2. 客户更新：名称、邮箱、元数据、计费控制项；邮箱唯一性仅在无外部标识时约束。
3. 子实体：按功能项维度创建席位、工作区等子主体，支持逻辑删除与恢复。
4. 控制项：自动充值、消费上限、用量上限、阈值告警、超额开关，客户级与实体级各一套。
5. 快照读取：一次查询返回客户、实体、客户产品、余额与订阅状态的组合视图，供读路径使用。
6. 缓存：读穿缓存 + 版本号失效；写后主动失效；支持强制清缓存。
7. 生命周期：删除客户时级联清理其产品、余额、事件与发票关联，删除前给出影响预览。

## 3. Contracts

```ts
interface CustomerUpsert {
  id?: string;
  email?: string;
  name?: string;
  fingerprint?: string;
  metadata?: Record<string, string>;
  entityId?: string;
}

interface BillingControls {
  autoTopups: Array<{ featureId: string; threshold: number; quantity: number; enabled: boolean }>;
  spendLimits: Array<{ featureId?: string; limit: number; interval: "hour" | "day" | "week" | "month" }>;
  usageLimits: Array<{ featureId: string; limit: number; interval: "day" | "week" | "month" | "year" }>;
  usageAlerts: Array<{ featureId: string; threshold: number; type: "usage" | "remaining" }>;
  overageAllowed: boolean;
}

interface FullCustomer {
  internalId: string;
  id: string | null;
  email: string | null;
  name: string | null;
  env: "sandbox" | "live";
  entities: Array<{ internalId: string; id: string; name?: string }>;
  customerProducts: Array<{ internalId: string; planId: string; status: string }>;
  balances: Array<{ featureId: string; remaining: number; unlimited: boolean }>;
  controls: BillingControls;
  version: number;
}

abstract class CustomerService {
  abstract upsert(input: CustomerUpsert): Promise<{ customer: FullCustomer; created: boolean }>;
  abstract get(input: { customerId: string; entityId?: string; skipCache?: boolean }): Promise<FullCustomer | null>;
  abstract createEntity(input: { customerId: string; entityId?: string; featureId: string; name?: string }): Promise<{ entityId: string }>;
  abstract delete(input: { customerId: string; deleteInProcessor: boolean }): Promise<{ preview: string[] }>;
}
```

错误约定：客户不存在返回 `null` 而非抛错，由调用方决定是 404 还是创建；删除操作必须先返回影响预览，确认后才执行。

## 4. Core Flows

### 4.1 Upsert

```ts
async function upsert(input: CustomerUpsert, ctx: CustomerContext) {
  const existing = await ctx.customers.findByExternalId(input.id, input.email);
  if (existing) {
    if (input.entityId) await ensureEntity(existing, input.entityId, ctx);
    return { customer: await ctx.customers.full(existing.internalId), created: false };
  }
  const created = await ctx.db.transaction(async (tx) => {
    const row = await ctx.customers.insert(tx, { ...input, env: ctx.env, orgId: ctx.orgId });
    if (input.entityId) await ctx.entities.insert(tx, { customerInternalId: row.internalId, id: input.entityId });
    return row;
  }).catch((error) => {
    if (isUniqueViolation(error)) return ctx.customers.findByExternalId(input.id, input.email);
    throw new CustomerError({ code: "CUS-500-001", cause: error });
  });
  await ctx.events.emit("customer.created", { customerId: created.internalId });
  return { customer: await ctx.customers.full(created.internalId), created: true };
}
```

失败分支：并发创建同一外部标识时依赖唯一约束，后到者捕获冲突后回读已存在记录并返回 `created: false`，不报错；实体创建重复时返回既有实体，不产生第二行。

### 4.2 Cached Read

读路径先查缓存，缓存未命中回源数据库并回填；缓存条目带客户版本号，写入路径提交后递增版本并删除条目，读路径发现版本落后即视为未命中。缓存不可用时直接读数据库并记录降级，不阻断请求。

### 4.3 Delete

删除分三步：先返回影响预览（将删除的客户产品数、余额数、事件数、发票数）；确认后在同一事务内级联删除本地关联；最后按需调用支付通道删除客户。通道删除失败不回滚本地，记录为待清理并允许重试。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| CUS-A1 | 首次创建 | 无同名客户 | 按外部标识创建 | 返回新身份，`created` 为真，投递创建事件 |
| CUS-A2 | 重复创建 | 已存在同标识客户 | 再次创建 | 返回同一内部身份，`created` 为假，不重复投递事件 |
| CUS-A3 | 并发创建 | 同标识两次并发 | 同时创建 | 只产生一行，两次都返回成功 |
| CUS-A4 | 删除预览 | 客户有 2 个套餐、3 张发票 | 请求删除 | 返回影响清单，未删除任何数据 |
| CUS-A5 | 缓存失效 | 缓存中有旧余额 | 更新控制项后读取 | 读到新值，版本号递增 |
| CUS-A6 | 实体重名 | 已存在实体 | 同标识再建实体 | 返回既有实体，不新增 |
