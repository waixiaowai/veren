---
title: 复合组件
description: 由基础组件组合而成的布局与交互结构组件。
sidebar:
  order: 131
  label: 复合组件
lastUpdated: 2026-11-05
---

复合组件负责布局、插槽与组合交互，仍不承担业务数据获取。它们决定「一块区域长什么样」，业务含义由传入的数据决定。

## 1. Component List

| 组件 | 用途 | 组成 | 响应式行为 |
| --- | --- | --- | --- |
| PageHeader | 页面标题与操作区 | 标题、辅助说明、操作按钮组、面包屑 | 窄屏操作换行到标题下方 |
| PageShell | 页面容器 | 最大宽度、页边距、滚动容器 | 640 以下单列，边距 16 |
| DataTable | 列表容器 | 工具栏、表头、表体、分页、空态 | 横向滚动，首列固定 |
| FilterBar | 筛选区 | 搜索框、下拉筛选、保存视图、清除 | 折叠为「筛选」按钮 |
| FormSection | 表单分节 | 标题、说明、字段组 | 单列，字段全宽 |
| FieldRow | 字段行 | 标签、控件、说明、错误 | 窄屏上下堆叠 |
| ConfirmDialog | 二次确认 | 标题、后果说明、确认输入、按钮 | 固定宽度，超长滚动 |
| SheetPanel | 右侧面板 | 标题栏、内容槽、底部操作条 | 640 以下全屏 |
| EmptyState | 空态 | 插图、标题、说明、主次操作 | 居中，最大宽度 360 |
| ErrorState | 失败态 | 图标、原因、重试、返回 | 同空态 |
| ChartCard | 图表卡 | 标题、筛选、图表、图例、骨架 | 高度固定，窄屏减半 |
| CodeGroup | 代码示例 | 语言切换、复制、高亮 | 横向滚动，不换行 |
| StepIndicator | 步骤条 | 步骤、当前步、完成态 | 窄屏只显示当前步 |

## 2. Contracts

```ts
interface DataTableProps<Row> {
  rows: Row[];
  columns: Array<{ key: string; header: string; width?: number; align?: "left" | "right" }>;
  loading?: boolean;
  error?: { message: string; onRetry: () => void };
  empty?: { title: string; description: string; action?: React.ReactNode };
  page: { index: number; size: number; total: number };
  onPageChange: (index: number) => void;
  onRowClick?: (row: Row) => void;
}

interface SheetPanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  requireTyping?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}
```

## 3. Composition and Rhythm

同一区域内的过渡必须共用同一组时长与曲线：打开面板时内容让位、面板滑入、遮罩淡入三者同时开始且同时结束（`motion-base`）。表格刷新时骨架与内容交叉淡换（`motion-slow`），不得先清空再显示。

插槽只接受已定义的具名插槽：`PageHeader` 接受 `actions` 与 `breadcrumbs`，`SheetPanel` 接受 `footer`，`ChartCard` 接受 `toolbar`。不允许把任意节点塞进标题区域，避免破坏对齐。

```tsx
const CustomerListShell = (props: { children: React.ReactNode; onFilter: () => void }) => (
  <PageShell>
    <PageHeader title="客户" />
    <FilterBar onOpenFilters={props.onFilter} />
    {props.children}
  </PageShell>
);
```

## 4. Interaction Rules

列表行点击与行内操作按钮必须互不干扰：行点击进入详情，行内按钮阻止冒泡。筛选变化重置到第一页；清除筛选保留排序。确认弹窗打开时焦点移入确认按钮，取消后归还原触发点。空态与失败态不共用插图，避免用户把「没有数据」误认为「出错」。
