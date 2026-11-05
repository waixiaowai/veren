---
title: 接口契约
description: "场景系统的全部程序触面：服务面方法、协调事件与运行时判定钩子；进入即时生效，无排队语义。"
sidebar:
  order: 7
  label: 接口契约
draft: false
lastUpdated: 2026-11-05
---

## 1. Applicability

**HTTP 服务端接口：不适用。** 场景是宿主内的运行时概念，没有独立服务端；Web 客户端的触达走宿主既有的客户端通道（与设置页、插件页同路），本方案不新增传输协议。对程序的全部触面收敛为一个服务面（`ctx.scenes`）、一套模型记忆工具（recall/write）、一个协调事件与一个运行时判定钩子。权限判定以[权限矩阵](./permissions/)为唯一来源；错误语义统一引用[错误码表](./errors/)，本章不重复定义。

## 2. Service Face

| 标识 | 方法 | 用途 | 归属模块 |
| --- | --- | --- | --- |
| SVC-1 | `register(def): Disposable` | 登记组合定义，返回注销凭证 | Registry |
| SVC-2 | `get(sceneId): ComboDefinition \| undefined` | 按场景标识查定义 | Registry |
| SVC-3 | `list(): readonly ComboDefinition[]` | 全量已登记房间 | Registry |
| SVC-4 | `current(): ComboState \| undefined` | 当前视图所在房间 | Binder |
| SVC-5 | `enter(sceneId, requester)` 返回 `Resolution` | 进入房间：首次创建或恢复专属会话，**即时生效** | Resolver + Binder |
| SVC-6 | `confirmSuggestion(sceneId)` 返回 `Resolution` | 确认建议（等价于显式进入） | Resolver |
| SVC-7 | `unbind(sceneId, confirmToken)` 返回空 | 显式解绑：拆除绑定行并清除房间专有记忆（破坏性） | Binder |
| SVC-8 | `promote(l0Ref, targetTier, requester)` 返回 `PromotionRecord` | 显式晋升：对指定 **L0 条目**立即执行晋升（跳过重复判据）；源头必须为 L0，不直接写上层；L3→L4 仍须治理门 | Recall |

调用约定：

- SVC-5 / SVC-6 **即时生效**（进入就是打开对应会话，无排队、无回合边界等待）；被切走的旧会话若有在途回合，按宿主无人值守契约后台继续。
- SVC-5 幂等：已在该房间时为空操作；SVC-7 无确认凭证即拒绝。
- `requester` 取 `"user" | "plugin"`；`"model"` 不在取值内——模型没有进入房间的入口（铁律「换房权在人」，见[权限矩阵](./permissions/)）。
- SVC-8 是自动蒸馏管道的人工覆盖旁路：越过重复判据直接晋升，但留下 `PromotionRecord`（`promotedBy: "explicit"`）；目标为世界记忆（L4）时仍须治理门审核。
- 同步 vs 异步：SVC-1/2/3/4/7 同步；SVC-5/6 立即返回结论，会话创建与恢复的实际耗时体现在视图切换完成时。

## 3. Coordination Event

| 标识 | 事件 | 载荷 | 语义 |
| --- | --- | --- | --- |
| EVT-1 | `combo/activated` | `{ comboKey, sessionId, mode: "created" \| "resumed" \| "rebuilt" }` | 进入房间完成（客户端换视图、门牌换牌的协调信号） |

注意与 v2 路线的本质区别：**没有会话级场景落账事件**。会话的能力面自创建起冻结，「模型可见即可重建」不变量由宿主既有会话账本独立保证；场景层的换房是客户端视图协调，不触碰任何会话账本。

## 4. Runtime Hook

| 标识 | 钩子 | 模式 | 语义 |
| --- | --- | --- | --- |
| HK-1 | `scene/resolve` | 拦截（bail） | 自动判定征询：监听者按序收到上下文信号，第一个非空结论胜出并短路；无人拍板 = 维持现状（非错误）。产出的默认是**建议**，不是进门 |

插件经由 HK-1 提供判定依据（如「当前在文档页」）；这是插件影响场景的**唯一**通道，没有第二条。

## 5. Memory Tool Face

模型侧的记忆能力收敛为两个工具，随会话预装配挂载（每间房都有，无需场景声明）：

| 标识 | 工具 | 语义 | 能力边界 |
| --- | --- | --- | --- |
| TOOL-1 | `memory_recall(query)` | 读取：按可见性规则返回全阶梯（L0–L4 各自作用域内）的匹配条目 | 只读；兄弟房间原始记忆不在可见面 |
| TOOL-2 | `memory_write(content)` | 写入：只落 L0（本会话临时记忆） | **接口没有目标层参数**——L1–L4 的写入无表达形式，全部来自晋升 |

统一入口即约束：这套工具对五层共用，高层写入不可表达是接口形状决定的，不是运行时检查决定的。模型可自主调用两工具，但不运行蒸馏器——晋升仍归管道与治理门（见[权限矩阵](./permissions/)）。

## 6. Ordering

- 视图唯一：客户端同一时刻只在一个房间；进入新房间即切走视图，旧房间会话后台继续。
- 进入即时生效，无排队语义；建议与显式请求不排队、不合并——每次请求独立处理，幂等保护在房间粒度。
- 自动建议按迟滞窗口节流（见[判定器](./modules/resolver/)），同一房间的重复建议是空操作。
