---
title: 判定器（Resolver）
description: "决定现在该进哪间房：显式请求立即进门，自动信号过迟滞门后只产出建议；判定从不碰会话。"
sidebar:
  order: 3
  label: 判定器
draft: false
lastUpdated: 2026-11-05
---

## 1. Responsibility

判定器回答一个问题：「现在该进哪间房」。它接收两类输入——人的显式请求与上下文信号（所在页面、时间、会话内容）——产出一个结论：进门、建议、推迟、拒绝或维持现状。它与相邻模块的分界：登记处告诉它「有哪些房」，绑定器替它「开门」；它自己从头到尾不碰任何会话与记忆。

## 2. Features

- 接收显式进入请求（用户或插件），做存在性检查后立即触发激活（交给绑定器）。
- 接收自动判定信号：向所有判定钩子征询，第一个拍板的结论生效（拦截式征询）。
- 对自动信号执行迟滞门：滑动窗口内连续命中足够次数才产出建议，防来回抖动。
- **建议制（铁律）**：自动判定默认只产出建议——门牌高亮「要去这间吗」，不自动进门；经用户设置显式开启自动跟随，过门限的建议才自动进门。
- 幂等：对当前房间的进入请求与对同房间的重复建议都是空操作。
- 优先级：显式请求永远压过自动建议；同一时刻两者并存只处理显式。

## 3. Contract

```ts
interface ResolutionInput {
  /** 显式请求：来自人或插件。缺席时本次调用是自动判定。 */
  explicit?: { sceneId: SceneId; requester: "user" | "plugin" }
  /** 上下文信号：所在页面、时间、会话内容等，供判定钩子使用。 */
  signals: ContextSignals
}

type Resolution =
  | { kind: "activated"; comboKey: ComboKey }            // 显式进门（含确认建议）
  | { kind: "suggested"; comboKey: ComboKey; agree: number; need: number }  // 建议：过迟滞门，等确认或自动跟随
  | { kind: "deferred"; comboKey: ComboKey; agree: number; need: number }   // 迟滞未满：仅计数
  | { kind: "rejected"; code: "SCENE_NOT_FOUND"; message: string }
  | { kind: "kept" }
```

判定钩子是运行时拦截式事件（`scene/resolve`）：监听者按顺序被征询，第一个给出非空结论的监听者胜出并短路整条征询；无人拍板即「维持现状」，不是错误。

## 4. Flow

```ts
async function request(input: ResolutionInput): Promise<Resolution> {
  if (input.explicit) {
    const def = registry.get(input.explicit.sceneId)
    if (!def) {
      // 未登记的房间不可进：快速失败，零状态变更。
      return { kind: "rejected", code: "SCENE_NOT_FOUND", message: `scene ${input.explicit.sceneId} not registered` }
    }
    const comboKey = { sceneId: def.id, presetId: def.presetId }
    if (binder.current()?.comboKey === comboKey) return { kind: "activated", comboKey }   // 幂等：已在房内
    await binder.bindOrResume(comboKey)                                                   // 显式：立即进门
    return { kind: "activated", comboKey }
  }

  // 自动判定：征询钩子，第一个拍板的结论生效；无人拍板 = 维持现状。
  const proposed = await hooks.resolve.bail(input.signals)
  if (!proposed || binder.current()?.sceneId === proposed) return { kind: "kept" }

  // 迟滞门：滑动窗口内连续命中 need 次才产出建议。
  const agree = window.record(proposed)
  if (agree < settings.hysteresis.need) return { kind: "deferred", comboKey: proposed, agree, need: settings.hysteresis.need }
  window.reset()

  if (settings.autoFollow) {
    await binder.bindOrResume(proposed)                                                   // 显式开启自动跟随才进门
    return { kind: "activated", comboKey: proposed }
  }
  indicator.suggest(proposed)                                                             // 默认：门牌高亮建议，等确认
  return { kind: "suggested", comboKey: proposed, agree, need: settings.hysteresis.need }
}
```

**关键设计决策（铁律级）与违反后果**：

| 决策 | 违反后果 |
| --- | --- |
| 建议制默认：自动判定不自动进门 | 视图被人机对话牵着走，用户失去「我在哪」的掌控感 |
| 显式永远压过自动 | 页面钩子的抖动信号可能覆盖用户刚进的房间 |
| 自动信号必须过迟滞门 | 每次信号抖动都触发建议，门牌闪个不停 |
| 幂等：同房间重复操作是空操作 | 重复触发导致会话反复创建/恢复 |

## 5. Acceptance

1. **显式进门**：显式请求进入已登记房间 → 立即激活（绑定器创建或恢复其会话），返回 `activated`；已在房内时重复请求为幂等空操作。
2. **未登记拒绝**：请求进入未登记场景 → `SCENE_NOT_FOUND`，状态零变更。
3. **建议不进门（核心）**：自动信号过迟滞门且未开启自动跟随 → 仅返回 `suggested`，门牌高亮建议；当前视图、会话与绑定行均不变，需用户确认才进门。
4. **迟滞防抖**：信号在窗口内交替指向 X 与 Y 各 `need-1` 次 → `deferred` 不产出建议；连续 `need` 次指向 X → 建议出现一次。
5. **自动跟随开关**：开启自动跟随的部署中，过迟滞门的建议直接进门；关闭时（默认）永远停在建议。
