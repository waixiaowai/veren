---
title: 页面组件
description: 页面级组装、路由参数、URL 状态与四态实现。
sidebar:
  order: 133
  label: 页面组件
lastUpdated: 2026-11-05
---

页面是业务组件的薄封装：只负责路由参数解析、区块组装、页面级交互与状态恢复，不重复实现业务请求逻辑。每个页面对应 产品原型章 中的一条页面标识。

## 1. Page List

| 页面组件 | 对应页面 | 主要区块 | URL 状态 |
| --- | --- | --- | --- |
| `SignInPage` | `/design/dash-signin/` | 表单、第三方登录、通行密钥 | `client_id`、`redirect` |
| `CustomerListPage` | `/design/dash-customers/` | 页头、筛选条、客户表、引导卡 | `search`、`status`、`plan`、`page`、`size` |
| `CustomerDetailPage` | `/design/dash-customer/` | 页头、套餐、功能项额度、用量分析、账单、面板 | `tab`、`entity`、`sheet` |
| `PlanEditorPage` | `/design/dash-plan-editor/` | 页头、套餐卡片、右侧面板、保存条 | `sheet`、`item` |
| `CatalogPage` | `/design/dash-catalog/` | 页签、列表、编辑面板 | `tab`、`search` |
| `MigrationListPage` | `/design/dash-migrations/` | 页头、迁移表 | `page`、`status` |
| `MigrationDetailPage` | `/design/dash-migration/` | 步骤条、筛选、操作、运行监控 | `step`、`run` |
| `AnalyticsPage` | `/design/dash-analytics/` | 筛选条、指标卡、图表、明细表 | `range`、`group_by`、`feature` |
| `DeveloperPage` | `/design/dash-developer/` | 页签、密钥表、通道卡、回调配置 | `tab` |
| `SettingsPage` | `/design/dash-settings/` | 分组导航、表单、成员表 | `tab`、`section` |
| `CheckoutPage` | `/design/checkout-order/` | 抬头、套餐卡、摘要、确认区、结果态 | 路径参数 `checkout_id` |
| `AdminPage` | `/design/dash-admin/` | 页签、组织表、用户表、开关 | `tab`、`query` |

## 2. Contracts

```ts
interface CustomerDetailPageProps {
  orgId: string;
  env: "sandbox" | "live";
  customerId: string;
  tab: "plans" | "usage" | "analytics" | "billing" | "invoices";
  entityId?: string;
  sheet?: "edit-plan" | "record-usage" | "check" | "refund";
}
```

## 3. Composition

```tsx
const CustomerDetailPage = (props: CustomerDetailPageProps) => {
  const customer = useCustomerQuery({ orgId: props.orgId, env: props.env, customerId: props.customerId });
  if (customer.isPending) return <CustomerDetailSkeleton />;
  if (customer.isError) return <PageError message="客户详情加载失败" onRetry={customer.refetch} />;

  return (
    <PageShell>
      <CustomerHeader customer={customer.data} />
      <Tabs value={props.tab} onValueChange={(tab) => setTab(tab)} />
      <CustomerPlanSection customerId={props.customerId} />
      <BalanceUsageTable customerId={props.customerId} entityId={props.entityId} />
      <InvoiceTable customerId={props.customerId} />
      <SheetPanel open={Boolean(props.sheet)} title="编辑套餐" onClose={closeSheet}>
        <PlanEditor planId={props.sheet === "edit-plan" ? selectedPlanId : ""} version={selectedVersion} />
      </SheetPanel>
    </PageShell>
  );
};
```

页面不直接调用接口：所有请求封装在对应业务组件的钩子中，页面只传参数与回调。这样同一区块可以在详情页与面板中复用。

## 4. URL Initialization and Restoration

初始化顺序固定为：读取路由参数 → 读取查询参数 → 校验与回落 → 拉取数据 → 恢复面板与滚动位置。非法值回落到默认值并在界面上提示已重置，不静默改写历史记录。

| 交互 | 写入方式 | 说明 |
| --- | --- | --- |
| 切换页签 | 替换 | 不产生额外历史记录 |
| 筛选变化 | 替换 + 重置分页 | 避免返回时看到旧页码 |
| 翻页 | 新增 | 支持后退回到上一页 |
| 打开详情 | 新增 | 后退回到列表并保留筛选 |
| 打开面板 | 替换 | 面板是同一页面的局部状态 |
| 关闭面板 | 替换 | 不新增历史记录 |

刷新与前进后退必须可重放且幂等：重新挂载时按 URL 重新请求，不使用上一次的内存结果；面板恢复优先于进场动画，避免先播放再跳动。

## 5. Four States

| 页面 | 加载 | 空 | 失败 | 无权限 |
| --- | --- | --- | --- | --- |
| CustomerListPage | 表格骨架 + 筛选条可用 | 引导卡 + 创建入口 | 错误条 + 重试，保留筛选 | 隐藏创建与批量操作 |
| CustomerDetailPage | 区块骨架，几何一致 | 单区块空态（如未订阅） | 单区块错误，其他区块可用 | 全部只读，顶部说明原因 |
| PlanEditorPage | 表单骨架 | 不适用 | 保存失败保留草稿并提示 | 只读，隐藏保存条 |
| MigrationDetailPage | 步骤骨架 | 不适用 | 预演失败展示阻塞清单 | 隐藏运行按钮 |
| CheckoutPage | 摘要与套餐骨架 | 不适用 | 错误终态 + 返回入口 | 会话失效提示联系商户 |
| AnalyticsPage | 图表骨架 + 指标占位 | 时间范围内无数据，提供放宽范围 | 图表错误但指标可用 | 隐藏导出与下钻 |

部分可用是硬要求：单个区块失败不得让整页显示为错误页；摘要失败时结算页必须禁用确认按钮，而不是用旧值继续。

## 6. Transitions

页面级转场只在「列表到详情」与「步骤间前进」使用，时长取 `motion-slow`；面板与弹层使用 `motion-base`。转场不阻塞数据请求，也不改写 URL。减少动态效果偏好下，所有转场降级为即时切换。
