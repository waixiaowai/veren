---
title: 百度网盘 Agent 存储能力套件 · 设计方案
description: 封面、目录与交付说明。
sidebar:
  order: 1
---
## Overview

把百度网盘的存储能力整理成一套可被 Agent、终端用户与开发者共同调用的能力面：自然语言触发、命令执行、协议暴露、库级嵌入，四条通路共享同一套路径边界、确认规则、错误语义与回端链接。

## Audience and Problems

本方案服务三类使用者。第一类是终端用户与他们的 Agent 宿主：用户希望用一句话完成上传、下载、转存、分享、检索、读正文与记忆备份，而 Agent 需要一组可预测的命令、稳定的机器可读输出和明确的危险操作确认点。第二类是协议宿主，它通过标准工具目录把网盘能力挂到会话里，需要工具描述、参数模式与结果文本足够自解释，且不依赖本地文件系统。第三类是开发者，他们要把网盘读写嵌进自己的服务，需要可组合的调用单元、可重试的错误分类与可控的超时。现状的痛点是：同一能力在四条通路上有各自的参数命名、输出信封、错误码与展示约定；危险操作（覆盖、删除、分享转存）的确认责任散落在提示词里；回端链接这类"易漏展示"的字段在不同命令里位于不同层级；异步任务（转存、正文解析）的中间态容易被误报为失败。本方案要解决的问题是：用一份统一的领域模型与契约，把四条通路收敛到同一套语义，并把安全边界、状态机与验收口径写成可执行、可核对的设计。

## Core Architecture

系统分为接入面、治理面与外部依赖三层。接入面有四个入口：行为层把自然语言意图翻译成受约束的调用，命令层承载完整的能力面并产出面向人与面向机器的两种结果，协议层把能力注册成宿主可发现的工具目录，库层供开发者直接组合调用。治理面不与用户直接交互，负责三类判断：路径是否落在授权根内、凭据是否可用且不外泄、危险动作是否已取得明确意图与确认；此外还负责记忆备份的清单与恢复安全网，以及安装、校验与版本分发。所有对外请求都经治理面放行后抵达外部服务；文件元数据不落本地库，账号凭据只以加密形式保存在本机凭据库，任务状态以服务端为准、本地仅保留短时缓存。控制流上，同步调用直接返回结果，异步任务（转存提交、文档解析）由任务标识驱动轮询推进，轮询失败只影响状态可见性、不回滚已提交的任务；数据流上，写操作先做冲突预检再落盘，读操作只返回授权根内的条目，回端链接由链接服务生成、调用方只做透传。

## Contents

- [1. 总体方案与架构](/design/architecture/#1-architecture)
  - [1.1 系统边界与外部参与者](/design/architecture/#11-boundary-and-participants)
  - [1.2 模块清单与职责边界](/design/architecture/#12-modules-and-responsibilities)
  - [1.3 总体架构图](/design/architecture/#14-architecture-diagram)
  - [1.4 控制流与数据归属](/design/architecture/#15-control-flow-and-data-ownership)
  - [1.5 关键异步时序](/design/architecture/#16-key-asynchronous-sequences)
  - [1.6 部署与运行形态](/design/architecture/#17-deployment-and-runtime)
- [2. 功能模块划分](/design/modules/overview/#2-modules)
  - [2.1 client 开发库内核](/design/modules/client/#21-client)
  - [2.2 command 命令行能力面](/design/modules/command/#22-command)
  - [2.3 bridge 协议网关](/design/modules/bridge/#23-bridge)
  - [2.4 skill 行为与展示层](/design/modules/skill/#24-skill)
  - [2.5 guard 安全闸门](/design/modules/guard/#25-guard)
  - [2.6 memory 记忆备份](/design/modules/memory/#26-memory)
  - [2.7 delivery 分发与版本](/design/modules/delivery/#27-delivery)
- [3. 服务端接口设计](/design/api/#3-api-design)
  - [3.1 接口分层与清单](/design/api/#31-interface-inventory)
  - [3.2 统一输出信封](/design/api/#32-unified-envelope)
  - [3.3 CLI 命令接口](/design/api/#33-cli-interfaces)
  - [3.4 协议工具接口](/design/api/#34-tool-interfaces)
  - [3.5 开发库公共契约](/design/api/#35-library-contracts)
  - [3.6 上游接口映射](/design/api/#36-upstream-mapping)
- [4. 权限与多主体](/design/permissions/#4-permissions-and-subjects)
- [5. 错误码](/design/errors/#5-error-codes)
  - [5.1 分级与命名](/design/errors/#51-taxonomy)
  - [5.2 全局错误码表](/design/errors/#52-global-table)
  - [5.3 上游映射](/design/errors/#53-upstream-mapping)
  - [5.4 重试与退避](/design/errors/#54-retry)
  - [5.5 用户可见文案](/design/errors/#55-copy-rules)
- [6. 状态模型](/design/states/#6-state-model)
  - [6.1 状态清单](/design/states/#61-inventory)
  - [6.2 授权会话](/design/states/#62-authorization-session)
  - [6.3 上传](/design/states/#63-upload)
  - [6.4 转存](/design/states/#64-transfer)
  - [6.5 正文解析](/design/states/#65-content-parse)
  - [6.6 分享链接](/design/states/#66-share-link)
  - [6.7 非法转移与失败码](/design/states/#67-illegal-transitions)
- [7. 数据字典](/design/data/#7-data-dictionary)
- [8. 产品端与页面原型](/design/product/#8-product-surfaces)
  - [8.1 产品端划分](/design/product/#81-surfaces)
  - [8.2 终端端视图](/design/product/#82-terminal-views)
  - [8.3 Agent 会话场景](/design/product/#83-agent-scenes)
  - [8.4 协议宿主端](/design/product/#84-host-surface)
  - [8.5 开发者嵌入端](/design/product/#85-developer-surface)
  - [8.6 页面流转](/design/product/#86-flow)
  - [8.7 原型说明](/design/product/#87-prototype)
- [9. UI 与交互规范](/design/ui/#9-ui-and-interaction)
  - [9.1 适用性判断](/design/ui/#91-scope)
  - [9.2 色彩](/design/ui/#92-color)
  - [9.3 间距与排版](/design/ui/#93-spacing-and-type)
  - [9.4 布局](/design/ui/#94-layout)
  - [9.5 图标与插图](/design/ui/#95-icons)
  - [9.6 微交互](/design/ui/#96-motion)
  - [9.7 微文案](/design/ui/#97-copy)
  - [9.8 无障碍](/design/ui/#98-accessibility)
  - [9.9 国际化](/design/ui/#99-internationalization)
- [10. 基础组件](/design/components/basic/#10-basic-components)
- [11. 复合组件](/design/components/composite/#11-composite-components)
- [12. 业务组件](/design/components/business/#12-business-components)
- [13. 页面组件](/design/components/pages/#13-page-components)
- [14. 系统验收标准](/design/acceptance/#14-acceptance)
  - [14.1 验收项](/design/acceptance/#141-items)
  - [14.2 需求追溯表](/design/acceptance/#142-traceability)
- [15. 专用名词](/design/glossary/#15-domain-glossary)
- [16. 技术术语表](/design/glossary/#16-technical-glossary)
- [17. 校验结果与待确认项](/design/review/#17-review)

## Delivery Layout

```text
design/
├── index.md                      # 封面、目录、交付说明（本文件）
├── architecture.md               # 总体方案、架构图、异步时序
├── modules/
│   ├── overview.md               # 2 功能模块划分（总述）
│   ├── client.md                 # 2.1 开发库内核
│   ├── command.md                # 2.2 命令行能力面
│   ├── bridge.md                 # 2.3 协议网关
│   ├── skill.md                  # 2.4 行为与展示层
│   ├── guard.md                  # 2.5 安全闸门
│   ├── memory.md                 # 2.6 记忆备份
│   └── delivery.md               # 2.7 分发与版本
├── api.md                        # 3 接口设计
├── permissions.md                # 4 权限与多主体
├── errors.md                     # 5 错误码
├── states.md                     # 6 状态模型
├── data.md                       # 7 数据字典
├── product.md                    # 8 产品端与页面
├── ui.md                         # 9 UI 与交互规范
├── components/
│   ├── basic.md                  # 10 基础组件
│   ├── composite.md              # 11 复合组件
│   ├── business.md               # 12 业务组件
│   └── pages.md                  # 13 页面组件
├── acceptance.md                 # 14 系统验收与追溯
├── glossary.md                   # 15–16 名词与术语
├── review.md                     # 17 校验结果与待确认项
└── assets/
    └── diagrams/                  # 8 张预渲染 SVG（架构图、3 张时序图、4 张状态图）
```

原型不在内容根内：`prototype/index.html` 为独立静态页，与方案站点分离，使用演示数据，不接入真实请求。

## Build and Preview

Markdown 是唯一内容来源：方案站点由 Astro/Starlight 渲染，本方案不含任何自建 HTML 渲染器，也不维护第二份正文。图在提交前预渲染为 `assets/diagrams/*.svg`，Markdown 只引用图片，Mermaid 源码放在 `<details>` 中作为可折叠对照，Astro 不执行 Mermaid。

```bash
# 内容校验：frontmatter、标题、链接、锚点、资源与语法
node .agents/skills/project-design-doc/scripts/cli.mjs check design
# 构建：首次加 --install 安装站点依赖，产物在 design/.design-doc/
node .agents/skills/project-design-doc/scripts/cli.mjs build design --install
# 本地预览：默认 http://localhost:4321/design/
node .agents/skills/project-design-doc/scripts/cli.mjs dev design --port 4321
```

站点路由为 `/design/` 与 `/design/<id>/`，按根路径部署；实测版本为 Astro 7.4.5、Starlight 0.42.8（2026-11-04）。产物按 HTTP 访问，不承诺 `file://` 阅读；构建与校验的实际结果记录在 [17. 校验结果与待确认项](/design/review/#17-review)，未验证项也在同一处列明，不把"设计已描述"当作"系统已验收"。

站点结构：左侧为按目录自动生成的导航并高亮当前章；正文提供目录、深链、站点搜索与明暗主题；窄屏导航收为抽屉。原型页（`../prototype/index.html`） 为独立静态文件，不连接真实服务。

> 本方案的"实现状态"标记：`【实现】` 表示现有代码或文档已具备；`【拟议】` 表示本方案提出、尚未落地；`【待确认】` 表示依赖外部确认的假设或缺口。三条标记贯穿全文，不另设图例章节。
