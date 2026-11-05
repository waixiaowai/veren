---
title: 数据字典
description: "场景系统的关键实体字段：标识、组合定义、绑定行、事件载荷与两层记忆的归属。"
sidebar:
  order: 11
  label: 数据字典
draft: false
lastUpdated: 2026-11-05
---

## 1. Identifiers

| 标识 | 类型 | 必填 | 格式 | 说明 |
| --- | --- | --- | --- | --- |
| `SceneId` | 品牌化字符串 | 是 | 全局唯一，登记时校验 | 场景标识；组合键的一半 |
| `PresetId` | 预设标识 | 是 | 宿主既有格式 | 组合键的另一半：这间房里住着谁 |
| `ComboKey` | `{ sceneId, presetId }` | 是 | 二元组，登记时锁定 | 组合键；绑定行与记忆作用域的主键 |
| `SessionId` | 会话标识 | 是 | 宿主既有格式 | 组合绑定的专属会话 |
| `WorkspaceId` | 工作区标识 | 是 | 宿主既有格式 | 工作记忆层的主体；会话按运行目录归属唯一工作区 |
| `LocaleString` | 双语字符串对 | 是 | 中英两键 | 名称与文案的双语载体 |

## 2. ComboDefinition（组合门牌说明）

| 字段 | 类型 | 必填 | 取值 / 格式 | 默认 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `id` | `SceneId` | 是 | 全局唯一 | — | 场景标识 |
| `presetId` | `PresetId` | 是 | 已登记预设 | — | 组合键的另一半 |
| `label` | `LocaleString` | 是 | 非空 | — | 双语名称，门牌直接显示 |
| `enter` | `SceneEnterCondition` | 是 | 显式 / 自动条件 | — | 进入方式；自动条件供判定钩子取用 |
| `assembly` | `AssemblySpec` | 是 | 工具清单 + 技能目录 | — | 预装配：会话创建时一次装配，自此冻结 |
| `page` | `PageRef` | 否 | 已登记页面引用 | — | 页面指向（可选） |

校验规则（fail-loud，违者 `SCENE_DEFINITION_INVALID`）：`id` 不重复；`presetId`、`assembly` 中的工具引用、`page` 引用必须已存在；`label` 双键非空。

## 3. Runtime Entities

| 字段（`ComboBinding`） | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `comboKey` | `ComboKey` | 是 | 组合键；绑定行与记忆作用域的主键 |
| `sessionId` | `SessionId` | 是 | 专属会话 |
| `createdAt` | 整数（毫秒时间戳） | 是 | 首次进门时刻 |
| `lastActiveAt` | 整数（毫秒时间戳） | 是 | 最近激活时刻 |

| 字段（`ComboState`） | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `comboKey` | `ComboKey` | 是 | 组合键 |
| `state` | `unbound \| bound \| active` | 是 | 房间状态（见[状态模型](./states/)） |
| `sessionId` | `SessionId \| undefined` | 是 | 绑定会话；`unbound` 时为空 |

**记忆阶梯的作用域键**（见[场景记忆](./modules/recall/)）：五层各有归属键，全部是结构性作用域、零打标字段——

| 层 | 主体 | 作用域键 |
| --- | --- | --- |
| L0 临时记忆 | session | `SessionId` |
| L1 工作记忆 | workspace | `WorkspaceId`（宿主既有工作区标识） |
| L2 场景记忆 | combo | `ComboKey` |
| L3 个人记忆 | preset | `PresetId` |
| L4 世界记忆 | null（无主体） | 全局，无键 |

| 字段（`PromotionRecord`，晋升记录） | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fromTier` / `toTier` | `MemoryTier` | 是 | 晋升方向（只允许上行相邻层） |
| `basis` | `{ occurrences, units }` | 是 | 重复判据：出现次数与跨单元数 |
| `entry` | 提炼条目 | 是 | 蒸馏产物（写入目标层的条目本体） |
| `promotedBy` | `"distiller" \| "explicit"` | 是 | 蒸馏器自动 / 显式晋升（人工覆盖通道） |
| `source` | L0 条目引用 | 是 | 晋升源头必须为 L0 条目（统一写入口的推论：无 L0 源的晋升不存在，上层无直接写路径） |
| `governanceReview` | 审核记录 | `toTier = L4` 时必填 | 治理门凭证；缺失即拒绝（L3→L4 禁自动） |

| 字段（`DistillJobRun`，每日整理任务运行记录） | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `day` | 日期 | 是 | 本次回顾的窗口终点日 |
| `window` | `[from, to)` 时间对 | 是 | 处理窗口；水位依据，重跑幂等的凭据 |
| `perTier` | 各层处理摘要 | 是 | 每层的输入计数、候选数、晋升数、顺延数 |
| `costTokens` | 整数 | 是 | 蒸馏模型调用的记账合计（经记账模块） |
| `status` | `completed \| partial \| deferred-budget` | 是 | 完成 / 部分组失败 / 预算超限顺延 |

## 4. Event And Hook Payloads

| 事件 / 钩子 | 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `combo/activated` | `comboKey` | `ComboKey` | 是 | 进入的房间 |
| `combo/activated` | `sessionId` | `SessionId` | 是 | 该房间的专属会话 |
| `combo/activated` | `mode` | `created \| resumed \| rebuilt` | 是 | 首次创建 / 恢复 / 会话丢失后显式重建 |
| `scene/resolve`（钩子） | `signals` | `ContextSignals` | 是 | 页面、时间、会话内容等判定依据 |
| `scene/resolve`（返回） | `sceneId` | `SceneId \| undefined` | 是 | 第一个非空结论生效；`undefined` = 维持现状 |

## 5. Resolution

```ts
type Resolution =
  | { kind: "activated"; comboKey: ComboKey }
  | { kind: "suggested"; comboKey: ComboKey; agree: number; need: number }
  | { kind: "deferred"; comboKey: ComboKey; agree: number; need: number }
  | { kind: "rejected"; code: "SCENE_NOT_FOUND"; message: string }
  | { kind: "kept" }
```

`kind` 与[错误码表](./errors/)的对应：`rejected` 只承载 `SCENE_NOT_FOUND`；进入即时生效，无排队与冲突语义。
