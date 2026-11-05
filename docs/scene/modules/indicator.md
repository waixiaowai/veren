---
title: 指示面（Indicator）
description: "房间的门牌：当前在哪间、系统建议去哪间、一键进入；纯呈现，不产生任何状态变更。"
sidebar:
  order: 6
  label: 指示面
draft: false
lastUpdated: 2026-11-05
---

## 1. Responsibility

指示面是房间模型在人的屏幕上的脸：会话里常驻门牌（当前房间），收到建议时高亮提示「要去这间吗」，一键确认进入；设置里提供绑定管理。它与相邻模块的分界：它只读判定结论与绑定状态、只递显式请求，自身不持有任何状态——它坏了，进门、绑定与记忆毫发无损，只是人看不见。

## 2. Features

- 门牌：显示当前房间的双语名称；刚刚换房时有换牌提示。
- 建议提示：判定器产出建议时高亮「要去这间吗」，一键确认即显式进入；忽略则建议留存至下一次判定更新。
- 进入入口：列出全部已登记房间（含其预设），点选即显式进入；当前房间呈高亮禁用态。
- 绑定管理（设置页）：查看全部绑定行（房间、会话、最近活跃）、显式解绑（带破坏性确认）。
- 错误直显：被拒（如未登记）时在入口处原样展示错误码对应的用户文案。

## 3. Contract

```ts
interface IndicatorModel {
  current: { comboKey: ComboKey; label: LocaleString } | undefined
  suggestion: { comboKey: ComboKey; label: LocaleString; basis: string } | undefined  // 为什么建议
  bindings: readonly { comboKey: ComboKey; sessionId: SessionId; lastActiveAt: number }[]
}
```

数据来源只有两处：绑定状态与最近判定结论。进入与解绑调用与程序面相同的服务方法——界面上没有一个按钮走了后门。

## 4. Acceptance

1. **如实呈现**：门牌与绑定器报告的当前房间一致；建议高亮与最近一次判定结论一致。
2. **无后门**：入口的进入/解绑与 API 直调走同一权限与校验路径；解绑必须走破坏性确认。
3. **故障隔离**：指示面整体不可用时，判定、绑定、会话与记忆不受任何影响。
