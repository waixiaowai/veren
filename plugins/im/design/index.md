---
title: Cumora 设计方案
description: "让一支由人和智能体共同组成的小队，在同一个工作区里对话、认领任务并协作交付，而智能体拥有稳定的人格、记忆与邮箱。"
sidebar:
  order: 0
  label: 封面与目录
draft: false
lastUpdated: 2026-11-04
---

## Summary

把一支由人和智能体共同组成的小队放进同一个工作区：同一份成员名单、同一批对话、同一块看板与日历，智能体有稳定人格、长期记忆、真实邮箱，能在没人点名时自己判断该不该接手，并在多人多智能体同时发言时不撞车。

## Problem

目标用户是三到三十人的产品、设计与工程小队：他们已经在用群聊推进工作，也已经在用通用对话模型写代码、写文案、做调研，但两件事始终接不上。第一，通用模型是一次性工具：没有固定身份、不记得上周的决定、不会主动接活，关掉窗口就等于换了一个人。第二，真正把智能体放进群聊的团队会立刻撞上三类事故：没事找事地刷屏、同一句话被两个智能体同时说、以及智能体声称完成了实际没有发生的工作。团队因此退回到"人工点名 + 人工转述"的模式，智能体退化成更贵的小工具。

这套系统要解决的是"智能体能不能当同事"这一件事：给它一份长期身份（人格、记忆、技能、邮箱、可以挂在云上也可以挂在自己的机器上），给它一套可判定的行动边界（一次发言只有一个人说、说过的话不会重复、声称的行动必须真的发生），再给它一个团队能看懂的工作面（对话、看板、日程、文档、邮件）。人类不需要学习新的工作方式，智能体也不需要伪装成人：双方在同一条消息流里出现，区别只在于谁在思考、谁在审批。

## Core Architecture

整套系统沿四条纵向能力组织，外加四个共享工作面。第一条是**事实**：会话保存消息、成员、已读游标与反应，所有其他能力都从这里取"现在发生了什么"。第二条是**行动**：一次回合把"该不该看、看到了什么、决定做什么、做了什么"收敛成一条可回放的记录，智能体对外部世界的一切动作都经由受控的工具调用落地，而不是直接改库。第三条是**仲裁**：在任何人动手之前，先由一次廉价判断决定"这次唤醒值不值得启动昂贵思考"，再在真正写入时用新鲜度闸门决定"你看到的世界是否已经过期"，两者一前一后，把重复与撞车挡在事实层之外。第四条是**身份与凭据**：工作区、成员角色、设备、宿主与令牌构成一条从"谁"到"可以在哪台机器上以什么身份行动"的链路，智能体进程本身永远拿不到服务端凭据。

四个共享工作面是看板、日程、文档与邮件：它们与对话共享同一份成员与权限，也共享同一条写入协议——先落库、再分发、可对账。所有持久写入在同一个事务里登记一条失效通知，由独立的外发通道在网络可用时投递；通道故障只延迟"别人多久看到"，不改变"命令是否成功"。客户端在此基础上按需拉取，把"推送"当作加速而非真相。执行侧遵循同一条分层：服务端决定谁该在什么时候思考，宿主决定用什么引擎思考，引擎进程只看见自己那一小片工作目录。由此，同一份产品可以同时容纳托管执行与用户自带执行，而失败语义、权限判定与成本记账保持一致。

## Contents

| 章节 | 内容 | 读者关注点 |
| --- | --- | --- |
| [1 总体方案与架构](./architecture/) | 边界、16 个模块、核心域判定、依赖与控制流、核心链路时序、降级与不变量 | 先读这章建立全局图 |
| [2 Conversation](./modules/conversation/) | 会话、消息、成员、已读、反应、附件与线程 | 消息为什么这样排序 |
| [3 Turn](./modules/turn/) | 一次智能体回合的装载、思考、工具与收敛 | 智能体为什么这样回答 |
| [4 Coordination](./modules/coordination/) | 唤醒仲裁、廉价判断、新鲜度闸门、认领与会议 | 两个智能体为什么没有撞车 |
| [5 Agent](./modules/agent/) | 人格、记忆、技能、模型策略与引擎归属 | 智能体的"我是谁" |
| [6 Identity](./modules/identity/) | 登录、令牌、单点登录、设备与会话撤销 | 谁在调用 |
| [7 Workspace](./modules/workspace/) | 租户、成员、角色、邀请、开通与删除 | 数据边界在哪 |
| [8 Host](./modules/host/) | 云端沙箱、用户设备守护进程、引擎适配与文件系统 | 智能体在哪台机器上思考 |
| [9 Board](./modules/board/) | 看板、列、卡片、评论、截止日与认领 | 工作如何被接走 |
| [10 Schedule](./modules/schedule/) | 日历、重复规则、提醒与派发 | 时间如何被共享 |
| [11 Document](./modules/document/) | 协作文档、快照、提及与打开权限 | 长文本如何共同编辑 |
| [12 Email](./modules/email/) | 每个智能体的真实邮箱、收发、归属与保留 | 外部世界如何进入 |
| [13 Realtime](./modules/realtime/) | 外发箱、长连推送、在线状态、提醒与推送 | 变化如何到达眼前 |
| [14 Storage](./modules/storage/) | 附件、对象存储、签名链接与配额 | 文件如何安全地给出 |
| [15 Billing](./modules/billing/) | 模型调用台账、套餐、试用、配额与网关 | 钱花在哪 |
| [16 Admin](./modules/admin/) | 后台、候补名单、审计、指标与告警 | 运营与排障 |
| [17 Shipping](./modules/shipping/) | 证据化的功能生命周期、发布与回读 | 什么算"做完了" |
| [18 服务端接口](./api/) | 分组端点、核心请求响应、错误与幂等 | 对接与评审 |
| [19 权限与多主体](./permissions/) | 主体定义、权限矩阵、隔离与切换失效 | 安全评审 |
| [20 错误码与状态模型](./errors/) | 稳定错误码、重试语义、非法转移 | 排障 |
| [21 数据字典](./data/) | 关键实体字段、约束、默认值与可见性 | 契约对齐 |
| [22 产品端与页面](./product/) | 4 个产品端、页面清单、流转与原型说明 | 体验评审 |
| [23 界面规范](./ui/) | 色彩、间距、字体、布局、动效、文案、无障碍、国际化 | 视觉与交互 |
| [24 基础组件](./components/basic/) | 原子控件与微交互契约 | 实现盘点 |
| [25 复合组件](./components/composite/) | 布局与组合 | 布局评审 |
| [26 业务组件](./components/business/) | 数据绑定的业务块 | 数据与状态 |
| [27 页面组件](./components/pages/) | 页面级组装、URL 状态与四态 | 页面级验收 |
| [28 系统验收](./acceptance/) | 端到端验收与需求追溯 | 交付判据 |
| [29 名词与术语](./glossary/) | 业务名词与技术术语，分列两表 | 统一用语 |
| [30 校验记录](./review/) | 假设、待确认、核心域核对与实测结果 | 已知缺口 |

## Deliverables

```text
design/cumora/
  index.md                      封面、问题、核心架构与目录
  architecture.md               1 总体方案与架构
  modules/                      2 到 17 逐模块设计
    conversation.md turn.md coordination.md agent.md
    identity.md workspace.md host.md board.md schedule.md
    document.md email.md realtime.md storage.md billing.md
    admin.md shipping.md
  api.md                        18 服务端接口
  permissions.md                19 主体、权限矩阵与数据隔离
  errors.md                     20 全局错误码与状态模型
  data.md                       21 数据字典
  product.md                    22 产品端、页面与流转
  ui.md                         23 界面规范
  components/                   24 到 27 四层组件
    basic.md composite.md business.md pages.md
  acceptance.md                 28 系统验收与追溯表
  glossary.md                   29 业务名词与技术术语
  review.md                     30 假设、待确认与校验记录
  assets/diagrams/              构建期预渲染的 SVG 图
```

## Build and Preview

本方案是纯 Markdown 内容集合，渲染、路由、目录与搜索全部交给 Astro 与 Starlight；仓库不提供第二份正文。

```bash
node .agents/skills/project-design-doc/scripts/cli.mjs check design/cumora
node .agents/skills/project-design-doc/scripts/cli.mjs build design/cumora --install
node .agents/skills/project-design-doc/scripts/cli.mjs dev design/cumora --port 4321
```

- 检查：frontmatter、文件名、标题层级与字符、站内链接与锚点、图片与图源码、禁用 HTML。
- 构建：同步到 `design/cumora/.design-doc/site` 并执行 `astro build`，产物在 `.design-doc/dist`。
- 预览：默认地址 `http://localhost:4321/design/`。

## Baseline

| 项 | 值 |
| --- | --- |
| 被描述项目 | `cumora` 0.18.9（私有工作区 `deepseek/yetone/cumora`） |
| 提交 | `fd3d6c5`（2026-11-01） |
| 方案站渲染 | Astro 7.4.5 与 Starlight 0.42.8（模板 `site-starlight`） |
| 方案位置 | 工作区 `design/cumora/`，与被描述项目仓库分离，不改动其源码与产物 |
| 覆盖范围 | 前端四个壳、服务端 HTTP 与运行时接口、智能体回合与协调、宿主与守护进程、四个工作面、实时与存储、计费与运营、交付证据链 |
| 明确排除 | 模型自身能力与训练、云厂商内部实现、应用商店审核流程、第三方引擎（Claude Code、Codex 等）的内部实现、邮件与推送网络的投递行为 |

方案中的事实来自源码、仓库内文档与配置；凡属"现状如此但方案提出改变"的条目，均在 [校验记录](./review/) 的假设表中列明，不把设计描述当成已实现事实。
