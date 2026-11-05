---
title: 数据字典
description: 关键实体的字段、类型、单位、归属主体与可见性约定。
sidebar:
  order: 9
  label: 数据字典
lastUpdated: 2026-11-05
---

本章是字段口径的唯一来源，模块契约、接口与页面均引用本章字段而不重复定义。字段类型以存储层为准，接口层的命名转换在 服务端接口 中说明。

## 1. Conventions

### 1.1 Identifiers

| 约定 | 规则 | 说明 |
| --- | --- | --- |
| 内部主键 | `internal_id`，前缀化随机串 | 仅内部使用，绝不外泄；用于跨表关联 |
| 外部标识 | `id`，由集成方提供或系统生成 | 对外的客户标识、功能项标识、套餐标识均在此列 |
| 组合唯一 | `org_id` + `env` + `id` | 同一组织内沙箱与生产可以复用同名标识 |
| 关联列 | `internal_*_id` | 统一以 `internal_` 前缀标记内部外键 |

### 1.2 Time

所有业务时间以「自 1970-01-01 起的毫秒数」存为数值列，不使用数据库时区类型；认证与审计表例外，使用带时区时间戳。周期边界（`starts_at`、`period_start`、`next_reset_at`）一律为绝对时刻，不做「当地月中」之类的隐式换算。

### 1.3 Money

金额列与支付通道同单位，以最小货币单位（如分）存储为数值，另设 `currency` 列保存三位货币代码。展示层的除零与格式化只在界面层发生，接口与存储不出现小数金额。

### 1.4 Scope

`org_id` 出现在租户级实体上（客户、功能项、套餐、发票、结算会话、迁移、密钥），`env` 出现在同一组织需要分区的地方。子实体（客户产品、客户权益、行项目、用量窗口）不重复携带 `org_id`，通过父级关联隐式归属，查询时由父级联表加锁。

## 2. Entity Overview

| 实体 | 所属模块 | 粒度 | 说明 |
| --- | --- | --- | --- |
| Organization | Tenancy | 组织 | 租户根，持有支付通道与回调配置 |
| ApiKey | Identity | 密钥 | 机器身份，按环境区分 |
| Customer | Customers | 客户 | 被计费主体，跨套餐存在 |
| Entity | Customers | 子主体 | 客户下的席位、工作区等 |
| Feature | Catalog | 功能项 | 计量单位或权限位 |
| Product | Catalog | 套餐 | 可售单元，带版本 |
| Price | Catalog | 价格 | 套餐的一个收费项 |
| Entitlement | Catalog | 权益模板 | 套餐对某功能项授予多少 |
| CustomerProduct | Billing | 订阅实例 | 客户持有某套餐的一次实例 |
| CustomerEntitlement | Balances | 余额实例 | 权益模板在某客户/实体上的落地 |
| Rollover | Balances | 结转 | 上一周期未用完的额度 |
| UsageWindow | Balances | 用量窗口 | 滑动窗口内的用量计数 |
| Event | Events | 用量事件 | 上报的不可变记录 |
| Invoice | Invoices | 发票 | 与通道发票一一对应 |
| InvoiceLineItem | Invoices | 行项目 | 金额的最小不可变单位 |
| Checkout | Checkout | 结算会话 | 一次购买意图的执行上下文 |
| Migration | Migrations | 迁移 | 套餐或客户批处理任务 |

## 3. Field Dictionary

### 3.1 Organization

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `internal_id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `slug` | text | 是 | 小写短横线，全局唯一 | 无 | — | 对外可读 |
| `name` | text | 是 | 1–80 字符 | 无 | — | 成员可见 |
| `default_currency` | text | 是 | 三位货币代码 | `usd` | — | 成员可见 |
| `stripe_config` | jsonb | 否 | 通道账号与密钥引用 | 空 | — | 仅管理员可见，读接口不返回密钥 |
| `processor_configs` | jsonb | 是 | 按通道类型分组的配置 | `{}` | — | 仅管理员可见 |
| `svix_config` | jsonb | 是 | 出站回调的应用标识 | `{}` | — | 仅管理员可见 |
| `test_pkey` / `live_pkey` | text | 否 | 可公开密钥，按环境唯一 | 无 | — | 可公开 |

### 3.2 Customer

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `internal_id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `id` | text | 否 | 集成方传入的外部标识；为空时按邮箱兜底 | 无 | — | 对外 |
| `email` | text | 否 | 邮箱格式，同组织同环境下唯一（仅当 `id` 为空时约束） | 无 | — | 运营可见 |
| `name` | text | 否 | 1–120 字符 | 无 | — | 运营可见 |
| `org_id` | text | 是 | 所属组织 | 无 | — | 内部 |
| `env` | text | 是 | `sandbox` 或 `live` | `sandbox` | — | 内部 |
| `processor` | jsonb | 否 | 通道类型与通道侧客户标识 | 无 | — | 内部 |
| `auto_topups` | jsonb 数组 | 是 | 自动充值规则集合 | `[]` | — | 运营可见 |
| `spend_limits` | jsonb 数组 | 是 | 客户级消费上限 | `[]` | 最小货币单位 | 运营可见 |
| `usage_limits` | jsonb 数组 | 是 | 客户级用量上限 | `[]` | 功能项单位 | 运营可见 |
| `created_at` | numeric | 是 | 毫秒时间戳 | 无 | 毫秒 | 运营可见 |

### 3.3 Entity

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `internal_id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `id` | text | 是 | 客户内唯一的外部标识 | 无 | — | 对外 |
| `internal_customer_id` | text | 是 | 所属客户 | 无 | — | 内部 |
| `internal_feature_id` | text | 否 | 实体所依附的功能项 | 无 | — | 内部 |
| `name` | text | 否 | 展示名 | 无 | — | 运营可见 |
| `deleted` | boolean | 是 | 逻辑删除标记 | `false` | — | 内部 |
| `billing_controls` | jsonb 数组 | 是 | 实体级上限与告警 | `[]` | 同客户口径 | 运营可见 |

### 3.4 Feature

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `internal_id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `id` | text | 是 | 组织内唯一，创建后不可改 | 无 | — | 对外 |
| `name` | text | 是 | 1–80 字符 | 无 | — | 对外 |
| `type` | text | 是 | `boolean` / `metered` / `credit_system` / `ai_credit_system` | 无 | — | 对外 |
| `config` | jsonb | 否 | 计量配置或信用换算表 | 无 | — | 对外 |
| `event_names` | text 数组 | 是 | 允许上报的事件名，空表示不限 | `[]` | — | 对外 |
| `archived` | boolean | 是 | 归档标记，归档后不可新授予 | `false` | — | 对外 |

### 3.5 Product and Price

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `products.internal_id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `products.id` | text | 是 | 组织内唯一；同一标识可有多版本 | 无 | — | 对外 |
| `products.version` | numeric | 是 | 正整数，发布递增 | `1` | — | 对外 |
| `products.is_add_on` | boolean | 是 | 是否为附加包 | `false` | — | 对外 |
| `products.is_default` | boolean | 是 | 是否为新客户默认套餐 | `false` | — | 对外 |
| `products.group` | text | 是 | 互斥分组，同组不可并存 | 空串 | — | 对外 |
| `products.archived` | boolean | 是 | 是否停止销售 | `false` | — | 对外 |
| `prices.config` | jsonb | 是 | 固定价或阶梯用量价 | 无 | — | 对外 |
| `prices.billing_type` | text | 是 | 一次性、周期固定、用量预付、用量后付等 | 无 | — | 对外 |
| `prices.tier_behavior` | text | 否 | `graduated` 或 `volume` | 无 | — | 对外 |
| `prices.proration_config` | jsonb | 否 | 升降级时的差价策略 | 无 | — | 对外 |

### 3.6 Entitlement

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `internal_product_id` | text | 否 | 所属套餐；与奖励二选一 | 无 | — | 内部 |
| `internal_feature_id` | text | 是 | 授予的功能项 | 无 | — | 内部 |
| `allowance_type` | text | 是 | `fixed` / `unlimited` / `none` | 无 | — | 对外 |
| `allowance` | numeric | 否 | `fixed` 时的授予量 | 无 | 功能项单位 | 对外 |
| `interval` | text | 是 | `lifetime` / `minute` / `hour` / `day` / `week` / `month` / `quarter` / `semi_annual` / `year` | 无 | — | 对外 |
| `interval_count` | numeric | 是 | 每几个周期重置一次 | `1` | 周期 | 对外 |
| `rollover` | jsonb | 否 | 结转上限、比例与有效期 | 无 | — | 对外 |
| `usage_limit` | numeric | 否 | 单周期允许超出的上限 | 无 | 功能项单位 | 对外 |
| `expiry` | jsonb | 否 | 授予后固定有效期的长度与单位 | 无 | — | 对外 |

### 3.7 CustomerProduct

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `internal_customer_id` | text | 是 | 持有客户 | 无 | — | 内部 |
| `internal_product_id` | text | 是 | 对应套餐版本 | 无 | — | 内部 |
| `status` | text | 是 | `scheduled` / `active` / `trialing` / `past_due` / `expired` / `paused` / `unknown` | `active` | — | 对外 |
| `processor` | jsonb | 否 | 通道类型与通道侧订阅标识 | 无 | — | 内部 |
| `canceled` | boolean | 是 | 是否已发起取消 | `false` | — | 对外 |
| `canceled_at` | numeric | 否 | 取消生效时刻 | 无 | 毫秒 | 对外 |
| `starts_at` | numeric | 是 | 实例生效时刻 | 无 | 毫秒 | 对外 |
| `trial_ends_at` | numeric | 否 | 试用结束时刻 | 无 | 毫秒 | 对外 |
| `billing_cycle_anchor_resets_at` | numeric | 否 | 账期锚点，决定续费日 | 无 | 毫秒 | 对外 |
| `quantity` | numeric | 是 | 席位数量 | `1` | 个 | 对外 |
| `collection_method` | text | 是 | `charge_automatically` / `send_invoice` | `charge_automatically` | — | 对外 |
| `on_trial_end` | text | 否 | `bill` 或 `revert` | 无 | — | 对外 |
| `billing_version` | text | 是 | `v1` 或 `v2`，标记结算引擎版本 | 无 | — | 内部 |

### 3.8 CustomerEntitlement

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `customer_product_id` | text | 否 | 来源实例；为空表示游离授予 | 无 | — | 内部 |
| `internal_customer_id` | text | 是 | 归属客户 | 无 | — | 内部 |
| `internal_entity_id` | text | 否 | 归属子实体；为空表示客户级 | 无 | — | 内部 |
| `unlimited` | boolean | 是 | 是否不限量 | `false` | — | 对外 |
| `balance` | numeric | 是 | 当前可用额度 | `0` | 功能项单位 | 对外 |
| `additional_balance` | numeric | 是 | 额外授予的可用部分 | `0` | 功能项单位 | 对外 |
| `next_reset_at` | numeric | 否 | 下次重置时刻；为空表示不重置 | 无 | 毫秒 | 对外 |
| `usage_allowed` | boolean | 是 | 用尽后是否允许超额 | `false` | — | 对外 |
| `expires_at` | numeric | 否 | 游离授予的过期时刻 | 无 | 毫秒 | 对外 |
| `entities` | jsonb | 否 | 子实体维度的余额分布 | 无 | 功能项单位 | 内部 |
| `cache_version` | integer | 是 | 缓存代次，写入时递增 | `0` | — | 内部 |

### 3.9 Rollover and UsageWindow

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `rollovers.cus_ent_id` | text | 是 | 来源余额实例 | 无 | — | 内部 |
| `rollovers.balance` | numeric | 是 | 结转额度 | 无 | 功能项单位 | 对外 |
| `rollovers.usage` | numeric | 是 | 结转额度中已用部分 | `0` | 功能项单位 | 对外 |
| `rollovers.expires_at` | numeric | 否 | 结转过期时刻；为空表示永久 | 无 | 毫秒 | 对外 |
| `usage_windows.internal_customer_id` | text | 是 | 归属客户 | 无 | — | 内部 |
| `usage_windows.internal_entity_id` | text | 否 | 归属子实体 | 无 | — | 内部 |
| `usage_windows.feature_id` | text | 是 | 计量功能项 | 无 | — | 内部 |
| `usage_windows.window_start_at` / `window_end_at` | numeric | 是 | 窗口边界 | 无 | 毫秒 | 内部 |
| `usage_windows.usage` | numeric | 是 | 窗口内累计用量 | `0` | 功能项单位 | 内部 |

同一（客户、功能项、实体）只有一行可变计数器，靠唯一约束保证并发写入不产生重复窗口。

### 3.10 Event

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `org_id` | text | 是 | 所属组织 | 无 | — | 内部 |
| `env` | text | 是 | 环境 | 无 | — | 内部 |
| `customer_id` | text | 是 | 外部客户标识 | 无 | — | 对外 |
| `event_name` | text | 是 | 事件名，须在功能项允许列表内 | 无 | — | 对外 |
| `idempotency_key` | text | 否 | 幂等键；为空表示不去重 | 无 | — | 对外 |
| `value` | numeric | 是 | 计量值 | 无 | 功能项单位 | 对外 |
| `timestamp` | timestamptz | 是 | 事件发生时刻 | 当前时刻 | — | 对外 |
| `properties` | jsonb | 否 | 自定义属性 | 无 | — | 对外 |
| `deductions` | jsonb | 否 | 本次扣减的明细快照 | 无 | — | 内部 |

唯一约束为（组织、环境、客户、事件名、幂等键），幂等键为空时视为不同事件，因此集成方需要去重时必须显式传键。

### 3.11 Invoice and LineItem

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `invoices.id` | text | 是 | 内部主键 | 无 | — | 内部 |
| `invoices.stripe_id` | text | 是 | 通道发票号，唯一 | 无 | — | 对外 |
| `invoices.status` | text | 是 | `draft` / `open` / `paid` / `void` / `uncollectible` | `draft` | — | 对外 |
| `invoices.total` | numeric | 是 | 应付总额 | `0` | 最小货币单位 | 对外 |
| `invoices.amount_paid` | numeric | 否 | 已付金额 | 无 | 最小货币单位 | 对外 |
| `invoices.refunded_amount` | numeric | 是 | 已退金额 | `0` | 最小货币单位 | 对外 |
| `invoices.currency` | text | 是 | 三位货币代码 | `usd` | — | 对外 |
| `invoices.discounts` | jsonb 数组 | 是 | 折扣快照 | `[]` | — | 对外 |
| `invoice_line_items.amount` | numeric | 是 | 折前金额 | 无 | 最小货币单位 | 对外 |
| `invoice_line_items.amount_after_discounts` | numeric | 是 | 折后金额 | 无 | 最小货币单位 | 对外 |
| `invoice_line_items.direction` | text | 是 | `charge` 或 `refund` | 无 | — | 对外 |
| `invoice_line_items.billing_timing` | text | 是 | `in_advance` 或 `in_arrear` | 无 | — | 对外 |
| `invoice_line_items.effective_period_start` / `_end` | numeric | 否 | 计费区间 | 无 | 毫秒 | 对外 |
| `invoice_line_items.customer_product_ids` | jsonb 数组 | 是 | 来源实例集合 | `[]` | — | 内部 |

行项目只追加不修改；重算采用「删除旧行、写入新行」的方式并以通道行项目号对齐，历史金额由发票快照保留。

### 3.12 Checkout

| 字段 | 类型 | 必填 | 取值或格式 | 默认 | 单位 | 归属与可见性 |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | text | 是 | 内部主键，同时作为幂等标识 | 无 | — | 内部 |
| `org_id` | text | 是 | 所属组织 | 无 | — | 内部 |
| `env` | text | 是 | 环境 | 无 | — | 内部 |
| `internal_customer_id` | text | 是 | 发起购买的客户 | 无 | — | 内部 |
| `action` | text | 是 | `attach` / `create_schedule` / `update_subscription` | 无 | — | 内部 |
| `params` | jsonb | 是 | 冻结的请求参数快照 | 无 | — | 内部 |
| `status` | text | 是 | `pending` / `action_required` / `completed` / `expired` | `pending` | — | 对外 |
| `response` | jsonb | 否 | 完成后的结果快照 | 无 | — | 对外 |
| `expires_at` | numeric | 是 | 会话过期时刻 | 无 | 毫秒 | 对外 |

## 4. Derivations and Units

| 口径 | 计算方式 | 适用字段 |
| --- | --- | --- |
| 可用额度 | `balance` 减去锁定中预留量 | `customer_entitlements.balance` |
| 已用额度 | 授予量减去可用额度，结转单独计 | 对账与账单行项目 |
| 周期用量 | 窗口内 `usage` 之和 | `usage_windows.usage` |
| 套餐月费 | 价格金额按账单周期归一 | 报表与毛利分析 |
| 结转过期 | `expires_at` 为空表示永久，否则到期清零 | `rollovers.expires_at` |

> **注意**：金额单位与接口层是否一致仍需与实现核对，见 校验记录 的 A-07。
