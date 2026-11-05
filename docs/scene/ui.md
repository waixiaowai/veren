---
title: UI 规范
description: "房间门牌区的微交互、微文案、无障碍与国际化规范。"
sidebar:
  order: 13
  label: UI 规范
draft: false
lastUpdated: 2026-11-05
---

## 1. Micro-interactions

| 触发条件 | 变化属性 | 时长与曲线 | 可中断性 | 降级行为 |
| --- | --- | --- | --- | --- |
| 进入新房间（视图切换完成） | 门牌内容与色相 | 150ms ease-out | 可中断：连续切换立即改写目标态 | 偏好减少动态效果时直接替换 |
| 建议到达 | 门牌旁建议标记淡入 | 200ms ease-out | 可中断：新建议替换旧建议 | 直接显示 |
| 房间列表弹层展开 | 透明度 0→1、位移 4px→0 | 120ms ease-out | 可中断：连点不叠加 | 直接显示 |
| 解绑确认对话框 | 遮罩淡入 | 150ms ease-out | Esc 可取消 | 直接显示 |
| 进入被拒 | 错误文案条淡入 | 200ms ease-out，停留 4s 自动消失 | 可中断：新错误替换旧文案 | 直接显示 |

规则：动画结束后 DOM 与状态一致（门牌永远等于绑定器报告的当前房间），不停在中间帧；所有动画只动透明度与位移，不动布局尺寸。

## 2. Micro-copy

| 场景 | 中文 | 英文 |
| --- | --- | --- |
| 建议提示 | 要去这间吗：{房间名} | Head to {room}? |
| 建议来源说明 | 为什么建议这间 | Why this room |
| 进入完成 | 已进入：{房间名} | Now in {room} |
| 场景不存在 | 这个场景不存在或已下架 | This scene does not exist or has been removed |
| 解绑确认标题 | 拆除这间房？ | Remove this room? |
| 解绑确认正文 | 将删除该房间的专属记忆并解除绑定；会话记录仍保留在会话列表。此操作不可撤销。 | Its room memory will be deleted and the binding removed. Session history stays in your session list. This cannot be undone. |
| 空态（无登记房间） | 暂无可用房间 | No rooms available |
| 绑定损坏 | 房间记录损坏，已停止使用该房间 | Room record is corrupted; this room is disabled |

文案规则：说「房间/门牌」不说「combo/绑定行」（人话）；解绑文案必须说清破坏范围（记忆删、会话留、不可撤销）；全部文案来自[错误码表](./errors/)与本文表，组件内不得现写。

## 3. Accessibility

- 门牌：`aria-label="当前房间：{名称}"`；建议态附加文字说明（不只靠高亮表达）。
- 弹层：`role="dialog"` + 焦点圈闭；Esc 关闭且焦点回门牌；方向键在房间列表内移动。
- 确认对话框：焦点落在「取消」上（破坏性操作的默认焦点永远是最安全的按钮）。
- 对比度：门牌与文案条满足 AA（正文 ≥ 4.5:1）；状态不靠颜色单传。
- 动效：全部尊重系统的减少动态效果偏好（见微交互降级列）。

## 4. Internationalization

- 全部界面文案走宿主双语注册表（中英两键），与[微文案表](#2-micro-copy)一一对应；组件内零硬编码文案。
- 房间名称本身是双语数据（`LocaleString`），按会话语言渲染对应键，缺键回退另一键并记录。
- 无日期时间格式化需求（最近活跃时间在设置页，用宿主既有时间格式化）；目标语言下文案不溢出：门牌最大宽 160px 超长省略号，完整名在 tooltip。
