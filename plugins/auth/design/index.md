---
title: 封面与目录
description: 认证框架设计方案总入口：范围、用户与痛点、核心架构、阅读目录与统一命名清单。
sidebar:
  order: 1
  label: 封面与目录
  hidden: false
draft: false
lastUpdated: 2026-11-05
---

## 1. Overview

本方案描述一个面向 Web 与移动应用的开源认证框架的完整设计：它以统一的配置装配、统一的端点契约与统一的主体模型，为应用提供注册、登录、会话、账号绑定、组织授权与二次验证能力，并通过插件机制把支付、身份联邦、设备接入等扩展能力收敛在同一套契约之下。

## 2. Users and Pain Points

目标用户分三层。**应用开发者**要在自己的技术栈里落地一套认证：他们被各家的抽象层、绑定方式与数据模型反复绑架，既想保留框架原生能力，又不想为了换一个认证方案重写整个账号体系。**应用运维与安全负责人**需要一套可审计的认证边界：会话如何签发与吊销、跨站请求如何被拦截、密码如何存储、越权访问如何被拒绝、失败与异常如何被定位，这些必须清晰可查，而不是散落在业务代码里的隐式约定。**终端用户**需要稳定且不被暴露身份细节的登录体验：无论使用邮箱口令、第三方账号、组织邀请还是二次验证，失败时的提示必须说明发生了什么、为什么、下一步做什么，同时不泄露账号是否存在。

痛点集中在四处：一是**契约不统一**——每一次认证方式的新增都会引入新的请求格式、新的错误语义与新的客户端调用方式，集成方无法形成稳定预期；二是**边界不清晰**——鉴权、授权、限流、来源校验这些安全职责与业务逻辑混在一起，既难以审计也难以复用；三是**数据模型易漂移**——每种登录方式各自建表、各自定义主体，最终导致"用户是谁"这个问题没有唯一答案；四是**扩展不可控**——第三方扩展要么改核心代码，要么绕过统一契约，最终让安全性依赖每个扩展作者的个人自觉。

本方案回答的核心问题是：如何用一套最小而完整的核心契约——装配、端点、主体、凭证、会话、守卫——承载形态各异的认证方式与扩展能力，同时让安全边界、数据归属与失败语义在所有扩展路径上保持一致。

## 3. Core Architecture

系统由四个职责平面组成。**装配平面**把配置、密钥、存储契约与扩展声明合并成一份可共享的运行时上下文，所有能力都从这份上下文读取依赖，彼此之间不直接互相引用。**契约平面**把业务能力注册为端点，端点携带输入输出模式、鉴权要求与文档元数据；调用进入端点前后，扩展可以插入拦截与加工，拦截可以终止请求，加工可以改写结果。**核心业务平面**承载认证判断本身：守卫在业务逻辑之前判定请求是否来自受信来源、是否超频；身份域确认主体的档案与外部账号绑定关系；凭证域校验用户持有的密钥材料并维护强度策略；会话域把"已认证"这一状态签发、续期与吊销；联合授权域以标准协议向外部身份提供方换取身份断言并回落到同一条身份解析链上。**扩展平面**贯穿其余三层：扩展可以注册端点、贡献数据表模型、挂载拦截与加工、声明限流规则，但扩展不得绕过核心业务平面直接写入会话与主体数据。数据归属单一：主体、会话、账号绑定与校验凭据各有唯一权威存储，其余平面只读取与投影。

## 4. Delivery Scope

| 项 | 值 |
|---|---|
| 方案对象 | 认证框架（仓库 `deepseek/better-auth/better-auth`，发行版 1.7.16） |
| 文档性质 | 对既有系统的中文设计方案（先总后分、可追溯、可验收） |
| 取证基线 | 全部模块、契约、接口、状态与错误码均以源码取证为准，取证位置标注在各模块章 |
| 交付物 | `design/*.md`（唯一内容源）+ Astro 站点（`design/.design-doc/` 构建生成） |
| 覆盖范围 | 16 个模块域、5 个核心域、6 类接口、7 个主体类型、51 项基础错误码、5 组状态模型 |
| 不在范围 | 业务系统实现、具体应用的界面实现、生产部署拓扑 |

## 5. Table of Contents

### 5.1 Cross-cutting Chapters

- [1. Architecture 总体方案与架构](./architecture/)
- [3. External Interfaces 服务端接口](./api/)
- [4. Actors and Permissions 权限与多主体](./permissions/)
- [5. Error Codes 错误码与状态模型](./errors/)
- [6. State Models 状态模型](./states/)
- [7. Data Dictionary 数据字典](./data/)
- [8. Product Surfaces 产品原型](./product/)
- [9. UI Specification UI 规范](./ui/)
- [10.1 Basic Components 基础组件](./components/basic/) · [10.2 Composite Components 复合组件](./components/composite/) · [10.3 Business Components 业务组件](./components/business/) · [10.4 Page Components 页面组件](./components/pages/)
- [11. System Acceptance 系统验收标准](./acceptance/)
- [12. Glossary 专用名词与技术术语](./glossary/)
- [13. Review 校验记录](./review/)

### 5.2 Module Chapters

| 编号 | 模块 | 定位 | 文件 |
|---|---|---|---|
| 01 | context 上下文装配域 | **核心** | [modules/01-context.md](./modules/01-context/) |
| 02 | endpoint 端点路由域 | **核心** | [modules/02-endpoint.md](./modules/02-endpoint/) |
| 03 | session 会话域 | **核心** | [modules/03-session.md](./modules/03-session/) |
| 04 | credential 凭证域 | **核心** | [modules/04-credential.md](./modules/04-credential/) |
| 05 | identity 身份域 | **核心** | [modules/05-identity.md](./modules/05-identity/) |
| 06 | oauth 联合授权域 | 外围 | [modules/06-oauth.md](./modules/06-oauth/) |
| 07 | guard 守卫域 | **核心** | [modules/07-guard.md](./modules/07-guard/) |
| 08 | storage 存储域 | **核心** | [modules/08-storage.md](./modules/08-storage/) |
| 09 | plugin 插件域 | 外围 | [modules/09-plugin.md](./modules/09-plugin/) |
| 10 | client 客户端域 | 外围 | [modules/10-client.md](./modules/10-client/) |
| 11 | cli 命令行域 | 外围 | [modules/11-cli.md](./modules/11-cli/) |
| 12 | diagnostics 诊断域 | 外围 | [modules/12-diagnostics.md](./modules/12-diagnostics/) |
| 13 | organization 组织域 | 外围 | [modules/13-organization.md](./modules/13-organization/) |
| 14 | strongauth 强认证域 | 外围 | [modules/14-strongauth.md](./modules/14-strongauth/) |
| 15 | enterprise 企业域 | 外围 | [modules/15-enterprise.md](./modules/15-enterprise/) |
| 16 | reference 参考域 | 外围 | [modules/16-reference.md](./modules/16-reference/) |

核心域判定依据见 [核心业务识别](./architecture/#14-core-business-identification)。

## 6. Delivery Tree

```text
design/
  index.md                     封面、目录、交付树、统一命名清单
  architecture.md              总体方案、架构图、核心业务识别、时序图
  api.md                       服务端接口
  permissions.md               主体定义、权限矩阵、数据隔离
  errors.md                    全局错误码表
  states.md                    状态模型与转移图
  data.md                      数据字典
  product.md                   产品端、页面清单、页面流转
  ui.md                        UI 规范
  components/basic.md          基础组件
  components/composite.md      复合组件
  components/business.md       业务组件
  components/pages.md          页面组件
  acceptance.md                系统最终验收与追溯表
  glossary.md                  专用名词与技术术语
  review.md                    校验结果、假设与待确认项
  assets/diagrams/             预渲染架构图与时序图
```

## 7. Unified Naming List

本清单是全方案唯一命名来源。任何章节引用模块、实体、接口、状态或角色时，必须使用此处定义的名称，不得另造同义词。

### 7.1 Module Names

| 编号 | 英文标识 | 中文名 | 职责边界 |
|---|---|---|---|
| 01 | `context` | 上下文装配域 | 把配置、密钥、存储契约与扩展声明合并为一份可共享的运行时上下文；不承载业务判断。 |
| 02 | `endpoint` | 端点路由域 | 把业务能力注册为可路由端点，并在调用前后插入拦截与加工；不判定业务合法性。 |
| 03 | `session` | 会话域 | 签发、校验、续期与吊销会话，并把会话状态安全送达客户端；不判定主体权限。 |
| 04 | `credential` | 凭证域 | 校验用户持有的密钥材料并维护其存储与强度策略；不管理主体档案。 |
| 05 | `identity` | 身份域 | 维护主体档案、注册流程与外部账号绑定关系；不持有会话。 |
| 06 | `oauth` | 联合授权域 | 以标准授权协议对接外部身份提供方并回收身份断言；不独立创建主体。 |
| 07 | `guard` | 守卫域 | 在业务逻辑前拦截跨站伪造、越权跳转与高频滥用；不修改业务数据。 |
| 08 | `storage` | 存储域 | 以统一适配契约读写主体数据并保证一致性语义；不解释业务字段含义。 |
| 09 | `plugin` | 插件域 | 以受控契约扩展框架能力并保证扩展点隔离与可卸载；不旁路核心域。 |
| 10 | `client` | 客户端域 | 向浏览器与移动端暴露类型安全的会话与动作调用面；不决定业务结果。 |
| 11 | `cli` | 命令行域 | 为开发者提供脚手架、模型生成、迁移与自检命令；不参与运行时请求。 |
| 12 | `diagnostics` | 诊断域 | 统一错误语义并暴露日志、遥测与链路观测能力；不改变业务结果。 |
| 13 | `organization` | 组织域 | 在主体之上建立多租户组织、团队与角色授权结构；不管理主体登录态。 |
| 14 | `strongauth` | 强认证域 | 在主凭证之上叠加二次验证、无密码凭证与受限设备授权。 |
| 15 | `enterprise` | 企业域 | 面向企业目录与互联场景提供身份联邦、供给与计费对接。 |
| 16 | `reference` | 参考域 | 把运行时契约导出为机器可读的接口参考与开发文档；不参与认证判断。 |

### 7.2 Entity Names

| 英文标识 | 中文名 | 归属模块 | 唯一性约束 |
|---|---|---|---|
| `User` | 主体 | `identity` | `email` 全局唯一 |
| `Account` | 账号绑定 | `identity` | `(providerId, accountId)` 唯一 |
| `Session` | 会话 | `session` | `token` 唯一 |
| `Verification` | 校验凭据 | `identity` | `identifier` 索引 |
| `RateLimit` | 限流计数 | `guard` | `key` 唯一 |
| `Organization` | 组织 | `organization` | `slug` 唯一 |
| `Member` | 组织成员 | `organization` | `(organizationId, userId)` 唯一 |
| `Invitation` | 组织邀请 | `organization` | `id` 唯一，`status` 有状态机 |
| `Team` | 团队 | `organization` | `(organizationId, slug)` 唯一 |
| `TeamMember` | 团队成员 | `organization` | `(teamId, userId)` 唯一 |
| `OrganizationRole` | 组织角色 | `organization` | `(organizationId, name)` 唯一 |
| `TwoFactor` | 二次验证档案 | `strongauth` | `userId` 唯一 |
| `DeviceCode` | 设备码 | `strongauth` | `deviceCode` 唯一，`userCode` 唯一 |
| `WalletAddress` | 钱包地址 | `strongauth` | `(userId, address)` 唯一 |
| `Jwks` | 密钥对 | `strongauth` | `id` 唯一 |

### 7.3 Interface Identifiers

接口标识格式为 `API-<模块编号>-<两位序号>`，例如 `API-02-03` 表示端点路由域第 3 个对外接口。接口路径一律挂在认证基路径之下，默认基路径为 `/api/auth`。全部接口清单见 [服务端接口](./api/)。

### 7.4 Error Code Identifiers

基础错误码沿用框架既有的全大写下划线命名（如 `INVALID_ORIGIN`），由诊断域统一定义；扩展可贡献自己的错误码集合，但不得与基础集合重名。语义统一表见 [错误码](./errors/)。

### 7.5 Actor Names

| 英文标识 | 中文名 | 说明 |
|---|---|---|
| `anonymous` | 匿名访客 | 未携带有效会话的请求来源 |
| `user` | 已认证主体 | 携带有效会话且通过守卫的主体 |
| `admin` | 管理员 | 被授予管理角色的主体 |
| `member` | 组织成员 | 在某个组织内拥有成员角色的主体 |
| `organization` | 组织 | 多租户隔离单位，作为权限判定的作用域 |
| `system` | 系统进程 | 内部作业与后台任务发起方 |
| `integration` | 外部集成方 | 通过机器凭证或身份联邦接入的外部系统 |

### 7.6 State Names

状态枚举见 [状态模型](./states/)，本章不重复列举，仅约定：状态名一律使用小写下划线形式（如 `pending`、`expired`、`revoked`），非法转移一律对应错误码表中的一项。
