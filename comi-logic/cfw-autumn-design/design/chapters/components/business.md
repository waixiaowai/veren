---
title: 业务组件
description: 绑定数据与接口的业务组件、字段映射与状态处理。
sidebar:
  order: 132
  label: 业务组件
lastUpdated: 2026-11-05
---

业务组件把接口数据、界面状态与用户操作绑在一起。每个组件必须写明使用的接口标识、字段映射、加载与失败处理、重复操作与竞态的处理方式。

## 1. Component List

| 组件 | 使用的接口 | 主要职责 |
| --- | --- | --- |
| `CustomerListTable` | `API-CUS-01`、`API-CUS-02` | 列表、筛选、分页、创建入口 |
| `CustomerHeader` | `API-CUS-03` | 客户摘要、状态徽标、上下文操作 |
| `CustomerPlanSection` | `API-CUS-03`、`API-BILL-01`、`API-BILL-03` | 展示套餐、发起变更 |
| `BalanceUsageTable` | `API-BAL-05`、`API-BAL-06`、`API-BAL-08` | 额度、用量、调整与结算 |
| `RecordUsageDialog` | `API-BAL-02` | 上报用量并反馈剩余 |
| `CheckBalanceDialog` | `API-BAL-01` | 按需求量试算准入 |
| `PlanEditor` | `API-CAT-07`、`API-CAT-09`、`API-CAT-11` | 套餐编辑、发布、版本提示 |
| `FeatureEditor` | `API-CAT-02`、`API-CAT-03`、`API-CAT-05` | 功能项与信用系统编辑 |
| `InvoiceTable` | `API-INV-01`、`API-INV-02` | 发票列表与退款 |
| `ApiKeyManager` | `API-AUTH-05`、密钥签发接口 | 创建、复制、吊销密钥 |
| `MigrationWizard` | `API-MIG-01` 至 `API-MIG-05` | 三步迁移与运行监控 |
| `AnalyticsPanel` | 分析聚合接口 | 时间范围、分组、图表与下钻 |

## 2. Contracts

```ts
interface CustomerListTableProps {
  orgId: string;
  env: "sandbox" | "live";
  filters: { search?: string; status?: string; planId?: string };
  page: { index: number; size: number };
  onFiltersChange: (next: CustomerListTableProps["filters"]) => void;
  onPageChange: (index: number) => void;
  onSelect: (customerId: string) => void;
}

interface PlanEditorProps {
  planId: string;
  version: number;
  canWrite: boolean;
  onPublished: (result: { version: number; affectedCustomerCount: number }) => void;
}

interface BalanceUsageTableProps {
  customerId: string;
  entityId?: string;
  canWrite: boolean;
  onChanged: () => void;
}
```

## 3. Data Binding

```tsx
const CustomerListTable = (props: CustomerListTableProps) => {
  const query = useCustomersQuery({ orgId: props.orgId, env: props.env, ...props.filters, ...props.page });
  if (query.isPending) return <DataTableSkeleton rows={8} columns={6} />;
  if (query.isError) {
    return <ErrorState message="客户列表加载失败" onRetry={() => query.refetch()} />;
  }
  return (
    <DataTable
      rows={query.data.list}
      columns={customerColumns}
      empty={{ title: "还没有客户", description: "客户会在首次调用接口时自动创建。", action: <CreateCustomerButton /> }}
      page={{ index: props.page.index, size: props.page.size, total: query.data.total }}
      onPageChange={props.onPageChange}
      onRowClick={(row) => props.onSelect(row.id)}
    />
  );
};
```

字段映射固定为接口字段直出：列表行显示名称、外部标识、邮箱、套餐摘要、创建时间与操作列；套餐摘要取第一条生效实例，其余折叠为「再加 N 个」。金额与额度使用统一格式化入口，不在组件内拼接单位。

## 4. States

| 组件 | 加载 | 空 | 失败 | 无权限 | 重复操作与竞态 |
| --- | --- | --- | --- | --- | --- |
| CustomerListTable | 8 行骨架 | 说明 + 创建入口 | 区块错误条 + 重试 | 隐藏创建入口 | 请求带版本号，旧响应丢弃 |
| CustomerPlanSection | 卡片骨架 | 展示「未订阅」+ 购买入口 | 区块错误 + 重试 | 只读展示 | 变更按钮提交中禁用 |
| BalanceUsageTable | 行骨架 | 「该功能项未授予」 | 区块错误 + 重算入口 | 只读 | 调整后重新拉取，禁用并发提交 |
| PlanEditor | 表单骨架 | 不适用 | 顶部错误条，保留草稿 | 全部只读 | 保存中禁用保存；版本冲突提示重载 |
| InvoiceTable | 5 行骨架 | 「暂无发票」 | 错误条 + 重试 | 隐藏退款 | 退款成功后就地更新行 |
| MigrationWizard | 步骤骨架 | 不适用 | 预演失败展示阻塞清单 | 只读步骤 | 运行中轮询，取消后停止轮询 |

## 5. Submission Rules

所有写操作遵循三条：提交中禁用触发控件并保持按钮宽度；成功后就地更新受影响区域而不是整页刷新；失败时保留用户输入并给出可操作的原因。涉及金额、额度与权限的写操作在提交前必须展示影响预览（改价影响客户数、退款金额、迁移影响范围），预览来自服务端而不是前端估算。
