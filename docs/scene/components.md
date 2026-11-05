---
title: 组件设计
description: "门牌区四层组件：基础复用宿主组件库，复合组件管呈现，业务组件组合数据，页面保持薄封装。"
sidebar:
  order: 14
  label: 组件设计
draft: false
lastUpdated: 2026-11-05
---

> 合并说明：房间 UI 面积小，四层组件合并为一文件交付；分层依据与取舍记录在[校验与假设](./review/)。

## 1. Basic

全部复用宿主组件库，零自造：徽标（Badge）、弹层容器（Popover）、对话框（Dialog）、行内消息条（InlineMessage）、即时提示（Tooltip）。本方案不定义任何新基础组件。

## 2. Composite

| 组件 | 组合 | 职责 |
| --- | --- | --- |
| `SceneBadge` | Badge + Tooltip | 门牌：渲染当前房间双语名与建议标记；自己不发起请求，只呈现模型数据 |
| `SceneRoomList` | Popover + 列表 | 房间清单：当前项高亮禁用、建议项标记；选中即回调，无内嵌状态 |
| `SuggestionExplainer` | Popover + 列表 | 建议解释时间线：渲染最近一次判定依据，空数据呈空态 |
| `UnbindConfirm` | Dialog | 解绑破坏性确认：标题、破坏范围正文、取消为默认焦点 |

复合组件的 props 全部是派生共享数据（门牌显示什么、列表有什么、谁被禁用），不含回调之外的行为；交互状态存放在业务层 store，不进组件。

## 3. Business

| 组件 | 用途 | 接口 |
| --- | --- | --- |
| `SceneIndicator` | 会话页门牌区：组合四枚复合组件 + InlineMessage，是唯一持有交互状态的业务组件 | 数据面 = 指示面模型（当前房间、建议、绑定列表）；动作面 = 进入、确认建议、解绑（转发到服务面 `enter`/`confirmSuggestion`/`unbind`，与 API 直调同路） |

业务组件遵守宿主客户端铁律：组件不接触运行时上下文、不 import 服务类、不读全局应用状态；要什么数据由宿主接入层从服务面投影后穿 props 下来；错误展示直接取[错误码表](./errors/)的文案键。

## 4. Pages

| 页面封装 | 组合 | 薄封装范围 |
| --- | --- | --- |
| 会话页门牌区 | 挂 `SceneIndicator` | 定位与显隐（无登记房间整区不渲染），零业务逻辑 |
| 设置页场景分区 | 挂绑定管理表 + `UnbindConfirm` | 过滤查询参数与解绑确认的弹层开关，零业务逻辑 |

页面不出现任何接口调用与状态改写：一切动作都发生在 `SceneIndicator` 与其转发链上，页面只决定「放不放、放哪里」。
