---
title: 服务端接口
description: 接口清单、认证与权限、请求响应契约、幂等与版本约定。
sidebar:
  order: 6
  label: 服务端接口
lastUpdated: 2026-11-05
---

本章定义集成方与控制台使用的全部对外接口。字段口径以 数据字典 为准，错误语义以 错误码表 为准；本章只引用码，不重复定义含义。

## 1. Conventions

### 1.1 Base and Transport

服务端接口统一前缀 `/v1`，仅 HTTPS，JSON 请求与响应，UTF-8。时间字段为毫秒时间戳或 ISO-8601 字符串二选一，同一接口内保持一致；金额为最小货币单位整数；标识符为字符串，不做数值化处理。

### 1.2 Authentication

| 方式 | 凭证 | 适用 | 环境来源 |
| --- | --- | --- | --- |
| 秘密密钥 | `Authorization: Bearer am_sk_test_*` 或 `am_sk_live_*` | 服务端到服务端 | 密钥前缀 |
| 可公开密钥 | `Authorization: Bearer am_pk_test_*` 或 `am_pk_live_*` | 浏览器只读 | 密钥前缀 |
| 会话 | 会话 Cookie | 控制台 | 请求头中的环境标记 |
| 授权码令牌 | `Authorization: Bearer am_oauth_*` | 命令行与智能体 | 令牌绑定 |

组织一律由凭证推导，不接受请求体传入；客户由请求体或路径传入，且必须属于该组织与该环境。

### 1.3 Cross-cutting Rules

| 规则 | 约定 |
| --- | --- |
| 幂等 | 所有写接口接受 `Idempotency-Key` 头，24 小时内同键同体返回首次结果；同键不同体返回 `BAL-409-003` |
| 分页 | 页码式返回 `{list,total,limit,offset,has_more}`，游标式返回 `{list,next_cursor}`；默认 100，上限 1000 |
| 过滤 | 查询参数与请求体同名时以请求体为准 |
| 展开 | `expand` 逗号分隔，支持 `balances.feature`、`customer.products` 等投影 |
| 版本 | `x-api-version` 接受日期或语义化版本，缺省取组织创建时的基线版本 |
| 限流 | 按组织与客户双维度，超限返回 `GEN-429-001` 并带 `Retry-After` |
| 响应过滤 | 内部标识与密钥字段永不出现在响应中 |
| 错误体 | `{message, code, env}`，不返回堆栈 |

## 2. Customer APIs

| 标识 | 方法与路径 | 用途 | 认证与权限 | 关键请求 | 响应 | 错误 |
| --- | --- | --- | --- | --- | --- | --- |
| `API-CUS-01` | `GET /v1/customers` | 分页列出客户 | 秘密密钥；`customers:read` | `limit`、`offset`、`search`、`plans[]`、`subscription_status` | 客户分页对象 | `GEN-400-001`、`GEN-429-001` |
| `API-CUS-02` | `POST /v1/customers` | 按外部标识取或建客户 | 秘密密钥；`customers:write` | `id?`、`email?`、`name?`、`fingerprint?`、`entity_id?` | 客户对象，含 `created` 标记 | `CUS-409-001`、`CUS-500-001` |
| `API-CUS-03` | `GET /v1/customers/:customer_id` | 读取客户快照 | 秘密密钥或可公开密钥；`customers:read` | `expand`、`skip_cache` | 客户快照 | `CUS-404-001` |
| `API-CUS-04` | `POST /v1/customers/:customer_id` | 更新客户资料与控制项 | 秘密密钥；`customers:write` | `name?`、`email?`、`metadata?`、`billing_controls?` | 客户快照 | `CUS-404-001`、`GEN-400-001` |
| `API-CUS-05` | `DELETE /v1/customers/:customer_id` | 删除客户 | 秘密密钥；`customers:write` | `delete_in_stripe` | `{success:true}` 与级联摘要 | `CUS-404-001`、`GEN-409-001` |
| `API-CUS-06` | `POST /v1/customers/:customer_id/entities` | 创建子实体 | 秘密密钥；`customers:write` | `id?`、`name?`、`feature_id`、`billing_controls?` | 实体对象 | `CUS-404-001`、`GEN-404-001` |
| `API-CUS-07` | `GET /v1/customers/:customer_id/entities` | 列出子实体 | 秘密密钥；`customers:read` | 无 | 实体列表 | `CUS-404-001` |
| `API-CUS-08` | `POST /v1/customers/:customer_id/billing_portal` | 获取托管账单页地址 | 秘密密钥；`billing:read` | `return_url` | `{url}` | `BILL-404-001` |
| `API-CUS-09` | `POST /v1/customers/:customer_id/transfer` | 转移套餐到另一客户 | 秘密密钥；`billing:write` | `to_customer_id`、`product_ids[]` | 转移结果 | `CUS-404-001`、`GEN-409-001` |

## 3. Catalog APIs

| 标识 | 方法与路径 | 用途 | 认证与权限 | 关键请求 | 响应 | 错误 |
| --- | --- | --- | --- | --- | --- | --- |
| `API-CAT-01` | `GET /v1/features` | 列出功能项 | 秘密密钥；`features:read` | `include_archived` | `{list}` | `GEN-429-001` |
| `API-CAT-02` | `POST /v1/features` | 创建功能项 | 秘密密钥；`features:write` | `id`、`name`、`type`、`metered?`、`credit_schema?` | 功能项对象 | `CAT-422-001`、`GEN-409-001` |
| `API-CAT-03` | `POST /v1/features/:feature_id` | 更新功能项 | 秘密密钥；`features:write` | `name?`、`display?`、`event_names?` | 功能项对象 | `GEN-404-001`、`CAT-409-001` |
| `API-CAT-04` | `DELETE /v1/features/:feature_id` | 删除功能项 | 秘密密钥；`features:write` | 无 | `{success:true}` | `CAT-409-001` |
| `API-CAT-05` | `GET /v1/features/:feature_id/deletion_info` | 删除前影响查询 | 秘密密钥；`features:read` | 无 | 引用清单 | `GEN-404-001` |
| `API-CAT-06` | `GET /v1/products` | 列出套餐 | 秘密密钥或可公开密钥；`plans:read` | `customer_id?`、`include_archived` | `{list}` | `GEN-429-001` |
| `API-CAT-07` | `POST /v1/products` | 创建套餐 | 秘密密钥；`plans:write` | `id`、`name`、`items[]`、`price?`、`free_trial?`、`add_on` | 套餐对象 | `CAT-422-001` |
| `API-CAT-08` | `GET /v1/products/:product_id` | 读取套餐 | 秘密密钥；`plans:read` | `version?` | 套餐对象 | `GEN-404-001` |
| `API-CAT-09` | `POST /v1/products/:product_id` | 更新套餐 | 秘密密钥；`plans:write` | 同创建 | 套餐对象与新版本号 | `CAT-409-002`、`CAT-422-001` |
| `API-CAT-10` | `DELETE /v1/products/:product_id` | 删除套餐 | 秘密密钥；`plans:write` | 无 | `{success:true}` | `CAT-409-001` |
| `API-CAT-11` | `GET /v1/products/:product_id/has_customers` | 是否仍有客户 | 秘密密钥；`plans:read` | 无 | `{has_customers,count}` | `GEN-404-001` |

## 4. Balance and Usage APIs

| 标识 | 方法与路径 | 用途 | 认证与权限 | 关键请求 | 响应 | 错误 |
| --- | --- | --- | --- | --- | --- | --- |
| `API-BAL-01` | `POST /v1/check` | 准入判定 | 秘密密钥或可公开密钥；`balances:read` | `customer_id`、`feature_id` 或 `product_id`、`required_balance?`、`send_event?`、`lock?` | `{allowed,balance,shortfall,lock_receipt?}` | `CUS-404-001`、`EVT-404-001` |
| `API-BAL-02` | `POST /v1/track` | 上报用量 | 秘密密钥；`balances:write` | `customer_id`、`feature_id` 或 `event_name`、`value?`、`properties?`、`idempotency_key?`、`async?` | 余额摘要或 202 | `EVT-404-001`、`EVT-422-001`、`BAL-402-001` |
| `API-BAL-03` | `POST /v1/track_tokens` | 按模型 token 计费 | 秘密密钥；`balances:write` | `customer_id`、`model`、`input_tokens`、`output_tokens` | 余额摘要 | `EVT-422-001` |
| `API-BAL-04` | `POST /v1/balances.create` | 创建独立余额 | 秘密密钥；`balances:write` | `customer_id`、`feature_id`、`included_grant?`、`unlimited?`、`reset?`、`expires_at?` | `{success:true,balance_id}` | `CUS-404-001`、`GEN-404-001` |
| `API-BAL-05` | `GET /v1/balances.list` | 列出余额 | 秘密密钥；`balances:read` | `customer_id` | 余额列表 | `CUS-404-001` |
| `API-BAL-06` | `POST /v1/balances.update` | 调整余额 | 秘密密钥；`balances:write` | `customer_id`、`feature_id`、`balance_id?`、`delta` | `{success:true}` | `BAL-404-001` |
| `API-BAL-07` | `POST /v1/balances.recalculate` | 按事件重算余额 | 秘密密钥；`balances:write` | `customer_id`、`feature_id` | 重算结果与差异 | `BAL-404-001`、`GEN-503-001` |
| `API-BAL-08` | `POST /v1/balances.finalize` | 结算锁定凭证 | 秘密密钥；`balances:write` | `lock_receipt`、`amount?` | `{success:true}` | `GEN-404-001`、`GEN-409-001` |

## 5. Billing APIs

| 标识 | 方法与路径 | 用途 | 认证与权限 | 关键请求 | 响应 | 错误 |
| --- | --- | --- | --- | --- | --- | --- |
| `API-BILL-01` | `POST /v1/billing.attach` | 购买或续接套餐 | 秘密密钥；`billing:write` | `customer_id`、`plan_id`、`success_url?`、`discounts?`、`starts_at?`、`ends_at?`、`no_billing_changes?` | `{customer_id,invoice?,payment_url?,required_action?}` | `BILL-404-001`、`BILL-410-002`、`BILL-423-001`、`BILL-502-001` |
| `API-BILL-02` | `POST /v1/billing.preview_attach` | 预览接入 | 秘密密钥；`billing:read` | 同接入 | 行项目、应付、下期应付、参数哈希 | 同接入（不含锁冲突） |
| `API-BILL-03` | `POST /v1/billing.update` | 变更订阅 | 秘密密钥；`billing:write` | `customer_id`、`plan_id`、`quantity?`、`proration?` | 同接入 | 同接入 |
| `API-BILL-04` | `POST /v1/billing.preview_update` | 预览变更 | 秘密密钥；`billing:read` | 同变更 | 预览结果 | 同预览 |
| `API-BILL-05` | `POST /v1/billing.multi_attach` | 多套餐接入 | 秘密密钥；`billing:write` | `customer_id`、`plans[]` | 同接入 | 同接入 |
| `API-BILL-06` | `POST /v1/billing.create_schedule` | 预约变更 | 秘密密钥；`billing:write` | `customer_id`、`phases[]` | 分段计划 | `BILL-409-001` |
| `API-BILL-07` | `POST /v1/billing.cancel` | 取消订阅 | 秘密密钥；`billing:write` | `customer_id`、`plan_id?`、`cancel_immediately?` | 取消摘要 | `GEN-404-001`、`GEN-409-001` |
| `API-BILL-08` | `POST /v1/billing.restore` | 恢复已取消订阅 | 秘密密钥；`billing:write` | `customer_id`、`plan_id` | 恢复结果 | `GEN-409-001` |
| `API-BILL-09` | `POST /v1/billing.setup_payment` | 设置支付方式 | 秘密密钥；`billing:write` | `customer_id`、`success_url?` | `{url}` | `BILL-404-001` |
| `API-BILL-10` | `POST /v1/billing.sync` | 对齐通道状态 | 秘密密钥；`billing:write` | `customer_id`、`dry_run?` | 差异提案 | `BILL-404-001` |
| `API-BILL-11` | `POST /v1/billing.sync_proposals` | 读取差异提案 | 秘密密钥；`billing:read` | `customer_id` | 提案列表 | `BILL-404-001` |

## 6. Checkout Invoice and Payment APIs

| 标识 | 方法与路径 | 用途 | 认证与权限 | 关键请求 | 响应 | 错误 |
| --- | --- | --- | --- | --- | --- | --- |
| `API-CHK-01` | `GET /checkouts/:checkout_id` | 读取会话 | 无需认证，按会话号限流 | 无 | 会话、客户摘要、预览 | `CHK-404-001` |
| `API-CHK-02` | `POST /checkouts/:checkout_id/preview` | 调整后预览 | 无需认证 | `quantity?`、`coupon_id?` | 预览结果 | `CHK-404-001`、`GEN-400-001` |
| `API-CHK-03` | `POST /checkouts/:checkout_id/confirm` | 确认并执行 | 无需认证 | `payment_method`、`params_hash` | 结果快照 | `CHK-409-002`、`CHK-410-001`、`CHK-423-001` |
| `API-INV-01` | `GET /v1/invoices/:invoice_id` | 读取发票 | 秘密密钥；`billing:read` | 无 | 发票与行项目 | `INV-404-001` |
| `API-INV-02` | `POST /v1/customers/:customer_id/invoices/:invoice_id/refund` | 发票退款 | 秘密密钥；`billing:write` | `amount?` | 退款结果 | `INV-409-002` |
| `API-INV-03` | `GET /invoices/hosted_invoice_url/:invoice_id` | 跳转托管账单页 | 无需认证，按 IP 限流 | 无 | 302 到托管地址 | `INV-404-001`、`GEN-429-001` |
| `API-PAY-01` | `POST /webhooks/:provider/:org_id/:env` | 接收通道通知 | 通道签名或共享密钥 | 通道原始报文 | 通道要求的确认体 | `PAY-401-001` |
| `API-PAY-02` | `POST /v1/platform.link_revenuecat` | 关联通道账号 | 秘密密钥；`platform:write` | `account_id` | `{linked:true}` | `GEN-400-001` |

## 7. Identity Tenancy and Migration APIs

| 标识 | 方法与路径 | 用途 | 认证与权限 | 关键请求 | 响应 | 错误 |
| --- | --- | --- | --- | --- | --- | --- |
| `API-AUTH-01` | `POST /api/auth/sign-in/email-otp` | 发送登录验证码 | 无需认证 | `email` | `{success:true}` | `GEN-429-001` |
| `API-AUTH-02` | `POST /api/auth/sign-in/email-otp/verify` | 校验验证码 | 无需认证 | `email`、`otp` | 会话 Cookie | `AUTH-401-002` |
| `API-AUTH-03` | `GET /organization/members` | 列出成员 | 会话；`organisation:read` | 无 | 成员列表 | `TEN-403-001` |
| `API-AUTH-04` | `POST /organization/invites` | 邀请成员 | 会话；`organisation:write` | `email`、`role` | 邀请对象 | `AUTH-403-001` |
| `API-AUTH-05` | `GET /v1/organization` | 读取当前组织 | 秘密密钥；`organisation:read` | 无 | 组织对象 | `AUTH-401-002` |
| `API-AUTH-06` | `POST /oauth/token` | 授权码换令牌 | 客户端凭证 + PKCE | `code`、`code_verifier` | 访问令牌与范围 | `AUTH-401-002` |
| `API-MIG-01` | `POST /v1/migrations.create` | 创建迁移 | 秘密密钥；`migrations:write` | `id`、`filter`、`operations` | 迁移对象 | `MIG-422-001` |
| `API-MIG-02` | `POST /v1/migrations.prepare` | 预演 | 秘密密钥；`migrations:write` | `id` | 受影响数与阻塞清单 | `MIG-422-001` |
| `API-MIG-03` | `POST /v1/migrations.run` | 正式运行 | 秘密密钥；`migrations:write` | `id`、`dry_run?`、`concurrency?` | 运行对象 | `MIG-409-001` |
| `API-MIG-04` | `POST /v1/migrations.cancel_run` | 取消运行 | 秘密密钥；`migrations:write` | `run_id` | 运行对象 | `GEN-404-001` |
| `API-MIG-05` | `POST /v1/migrations.runs.list` | 运行历史 | 秘密密钥；`migrations:read` | `id`、`limit` | 运行列表 | `GEN-404-001` |

## 8. Webhooks

### 8.1 Inbound

入站回调只接受通道原始报文，验签在解析之前完成；验签失败不落任何业务数据。重复投递按事件编号去重，重复时返回成功但不推进状态。

| 来源 | 路径 | 验签 | 事件 | 幂等 |
| --- | --- | --- | --- | --- |
| Stripe | `/webhooks/stripe/:org_id/:env`、`/webhooks/connect/:env` | 签名头 + 组织密钥 | 订阅创建/更新/删除、发票支付/终结、结算会话完成/过期 | 事件编号 5 分钟窗口 |
| RevenueCat | `/webhooks/revenuecat/:org_id/:env` | 共享密钥等值比较 | 首购、续订、取消、到期、账单问题 | 状态检查 |
| 微信支付 | `/webhooks/wechatpay/:org_id/:env` | 平台公钥验签 + AES-GCM 解密 | 支付成功、关单 | 事件唯一键 + 履约唯一键 |
| 内部互通 | `/webhooks/autumn` | 回调签名 | 内部事件（当前仅记录） | 无（不产生副作用） |

### 8.2 Outbound

出站回调由投递服务统一发送，事件类型为：产品变更、余额阈值、额度用尽、自动充值成功、账单更新。载荷包含事件编号、发生时间、客户标识与变更摘要；投递失败按指数退避重试，超过上限进入失败列表并在控制台可见。

## 9. Internal Dashboard APIs

控制台调用内部接口，路径不带 `/v1`，认证为会话 Cookie，路径首段声明资源，权限走作用域，环境由请求头中的环境标记决定。它们与对外接口共享同一批领域服务，差异只在认证方式、响应投影与展开深度，禁止另写一套业务逻辑。下表按资源组给出唯一标识，组内每个具体路径都属于该组契约的一部分。

| 标识 | 资源组与路径前缀 | 方法与范围 | 用途 | 权限 | 主要错误 |
| --- | --- | --- | --- | --- | --- |
| `API-UI-01` | `/customers` | `POST` 列表、搜索、计数、清缓存 | 客户列表与筛选 | `customers:read` | `GEN-429-001` |
| `API-UI-02` | `/customers/:customer_id` | `GET` 详情、套餐、实体、推荐关系 | 客户详情组装 | `customers:read` | `CUS-404-001` |
| `API-UI-03` | `/customers/:customer_id/invoice-line-items` | `POST` 补录行项目 | 运营手工调账 | `billing:write` | `INV-409-001` |
| `API-UI-04` | `/products` | `GET` 列表、按价格查询、计数 | 套餐与功能项工作台 | `plans:read` | `GEN-500-001` |
| `API-UI-05` | `/products/:product_id` | `GET` 计数、数据、信息；`POST` 复制到生产 | 套餐版本与上线 | `plans:write` | `CAT-409-002` |
| `API-UI-06` | `/migrations.*` | `POST` 创建、预演、运行、取消、历史 | 迁移工作台 | `migrations:*` | `MIG-409-001` |
| `API-UI-07` | `/organization` | `GET`、`PATCH` 组织与配置；成员、邀请、标识 | 组织设置 | `organisation:read` 或 `:write` | `TEN-403-001` |
| `API-UI-08` | `/organization/stripe`、`/organization/revenuecat` | `GET`、`POST`、`DELETE` 连接与配置 | 支付通道接入 | `organisation:write` | `GEN-400-001` |
| `API-UI-09` | `/invoice_templates` | `GET`、`POST`、`PATCH`、`DELETE` | 账单模板 | `organisation:write` | `INV-404-001` |
| `API-UI-10` | `/dev/api_key` | `POST` 创建、`DELETE` 吊销 | 密钥管理 | `apiKeys:write` | `AUTH-403-001` |
| `API-UI-11` | `/query/*` | `POST` 事件、原始数据、收入指标 | 分析与图表 | `analytics:read` | `GEN-400-001` |
| `API-UI-12` | `/saved_views` | `GET`、`POST`、`DELETE` | 保存的筛选 | `customers:read` | `GEN-404-001` |
| `API-UI-13` | `/consents` | `GET`、`DELETE` 授权与关联密钥 | 授权应用管理 | `organisation:read` | `AUTH-403-001` |
| `API-UI-14` | `/feedback`、`/pricing-agent/*` | `POST` 反馈、定价助手会话 | 反馈与助手 | 会话 | `GEN-429-001` |
| `API-UI-15` | `/admin/*` | 组织、用户、开关、代登录、队列与缓存诊断 | 平台管理 | `superuser` | `AUTH-403-001` |

分页、筛选与排序在内部接口与对外接口使用同一套参数名；内部接口额外返回调试字段（内部标识、通道原始编号），由响应过滤在非管理员调用时移除。

## 10. Versioning and Deprecation

版本变更分三类：新增可选字段不升版本；字段语义变化或必填化升次版本；删除或重命名升主版本。旧版本至少保留两个主版本周期，期间通过响应转换层维持兼容，并在响应头返回弃用提示。已弃用接口在文档与控制台标注，调用量归零后才物理下线。
