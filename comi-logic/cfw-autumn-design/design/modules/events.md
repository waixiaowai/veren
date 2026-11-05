---
title: 事件
description: 用量上报的接收、校验、去重、批量与异步入账。
sidebar:
  order: 31
  label: 事件 Events
lastUpdated: 2026-11-05
---

事件模块承接集成方的用量上报：它负责把一次上报变成一条不可变记录，并以可控的并发与重试把记录交给账本扣减。它是外围域——即便整块退化成同步直扣，产品仍能工作，代价是吞吐与可回放性。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 事件负责 | 不负责 |
| --- | --- | --- |
| 账本 | 交付去重后的扣减请求 | 计算余额与判定 |
| 目录 | 校验事件名是否属于某功能项 | 定义功能项 |
| 客户 | 解析上报的客户与实体 | 客户身份 |
| 分析 | 写出可聚合的明细 | 报表口径 |

## 2. Capabilities

1. 单条上报：按功能项或事件名上报，支持自定义属性与指定时间戳。
2. 批量上报：一次最多 1000 条，逐条校验、整体受理、局部失败逐条回执。
3. 幂等：支持请求级幂等键与事件级幂等键，重复上报不重复扣减。
4. 异步入账：默认入队，队列不可用时降级为同步扣减并记录降级。
5. 事件名校验：事件名必须属于目标功能项允许集合，空集合表示不限。
6. 用量覆盖：支持「设置为某额度」而非增量扣减，用于对账与初始化。
7. 明细查询：按客户、功能项、时间范围分页查询事件，支持聚合。

## 3. Contracts

```ts
interface TrackInput {
  customerId: string;
  entityId?: string;
  featureId?: string;
  eventName?: string;
  value?: number;
  properties?: Record<string, string | number | boolean>;
  timestamp?: number;
  idempotencyKey?: string;
  async?: boolean;
}

interface TrackResult {
  accepted: number;
  duplicated: number;
  balances: Array<{ featureId: string; remaining: number }>;
}

abstract class EventService {
  abstract track(input: TrackInput): Promise<TrackResult>;
  abstract batchTrack(inputs: TrackInput[]): Promise<{ results: Array<TrackResult | { error: string }> }>;
  abstract list(query: {
    customerId: string;
    featureId?: string;
    from: number;
    to: number;
    cursor?: string;
  }): Promise<{ events: Array<Record<string, unknown>>; nextCursor?: string }>;
}
```

## 4. Core Flows

### 4.1 Track

```ts
async function track(input: TrackInput, ctx: EventContext): Promise<TrackResult> {
  const feature = await ctx.catalog.resolveFeature(input.featureId, input.eventName);
  if (!feature) throw new EventError({ code: "EVT-404-001", featureId: input.featureId });
  if (feature.eventNames.length > 0 && !feature.eventNames.includes(input.eventName ?? "")) {
    throw new EventError({ code: "EVT-422-001", eventName: input.eventName, allowed: feature.eventNames });
  }

  const key = input.idempotencyKey ?? ctx.requestId;
  if (await ctx.events.seen(key)) return { accepted: 0, duplicated: 1, balances: [] };

  if (input.async !== false && ctx.queue.available()) {
    await ctx.queue.send({ job: "track", payload: { ...input, idempotencyKey: key } });
    return { accepted: 1, duplicated: 0, balances: [] };
  }
  const deducted = await ctx.balances.deduct({ subject: toSubject(input), amount: input.value ?? 1, idempotencyKey: key });
  return { accepted: 1, duplicated: 0, balances: [{ featureId: feature.id, remaining: deducted.remaining }] };
}
```

失败分支：队列不可用时同步扣减，不丢事件但增加请求延迟；队列可用而扣减失败时消息按重试策略重投，重投携带同一幂等键；校验失败不入队也不扣减。

### 4.2 Batch

批量上报按「解析全部 → 逐条校验 → 合并为一次扣减事务 → 投递」四步处理。校验失败的单条返回错误而不阻塞其他条目；同一批次内同一客户同一功能项的多条事件在扣减前合并，减少行锁竞争。批量结果必须逐条对应请求顺序，便于调用方定位失败项。

### 4.3 Insert and Replay

事件落库采用「先写事件、再扣减」的顺序：写事件成功而扣减失败时，可由补偿任务按事件重放；写事件失败则整条消息重试。重放以事件编号为准，已扣减的事件跳过。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| EVT-A1 | 正常上报 | 客户有足够余额 | 上报 10 单位 | 受理，余额减 10 |
| EVT-A2 | 重复上报 | 同一幂等键已上报 | 再上报一次 | 返回重复计数，余额不再变化 |
| EVT-A3 | 事件名非法 | 功能项允许集合为 `api_call` | 上报 `other` | 拒绝，返回 `EVT-422-001` 与允许集合 |
| EVT-A4 | 队列不可用 | 队列绑定缺失 | 上报 | 降级为同步扣减，受理成功并记录降级 |
| EVT-A5 | 批量部分失败 | 10 条中 1 条功能项不存在 | 批量上报 | 9 条受理，1 条返回错误，顺序对应 |
| EVT-A6 | 扣减失败重放 | 事件已落库，扣减超时 | 补偿任务重放 | 余额最终一致，不重复扣减 |
