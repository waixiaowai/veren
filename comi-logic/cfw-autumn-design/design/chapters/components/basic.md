---
title: 基础组件
description: 原子组件的属性、状态、微交互与令牌引用规则。
sidebar:
  order: 130
  label: 基础组件
lastUpdated: 2026-11-05
---

基础组件只负责样式与交互，不获取业务数据、不判断权限。所有尺寸与颜色只能引用 界面规范 的令牌，禁止在组件内写死色值。

## 1. Component List

| 组件 | 用途 | 尺寸与变体 | 状态 |
| --- | --- | --- | --- |
| Button | 触发操作 | 高度 28、32、36；主、次、幽灵、危险 | 默认、悬停、按下、加载、禁用、聚焦 |
| IconButton | 图标操作 | 24、28、32 | 同上，另需可访问名称 |
| CopyButton | 复制文本 | 24、28 | 默认、复制成功、失败 |
| Input | 单行文本 | 32、36 | 默认、聚焦、错误、禁用、只读 |
| AmountInput | 金额与数量 | 36 | 默认、越界、单位提示 |
| Select | 单选下拉 | 32、36 | 默认、展开、选中、禁用 |
| Checkbox | 布尔选择 | 16 | 未选、已选、半选、禁用 |
| Badge | 状态标记 | 小、中；六种语义色 | 默认、带图标 |
| Tooltip | 补充说明 | 单行、多行 | 显示、延迟显示 |
| Dialog | 模态确认 | 小 400、中 560 | 打开、关闭、提交中 |
| Sheet | 右侧面板 | 448、全屏 | 打开、关闭、层级叠加 |
| Tabs | 分区切换 | 下划线、分段 | 选中、悬停、禁用 |
| Skeleton | 加载占位 | 文本、卡片、表格行 | 显示、淡出 |
| Toast | 即时反馈 | 成功、错误、信息 | 显示、自动消失、手动关闭 |

## 2. Contracts

```ts
interface ButtonProps {
  variant: "primary" | "secondary" | "ghost" | "danger";
  size: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
}

interface FieldProps {
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
}

interface SheetProps {
  open: boolean;
  title: string;
  description?: string;
  width?: 448 | "full";
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}
```

## 3. Micro-interactions

每个可交互组件必须声明触发条件、变化属性、时长曲线、可中断性与降级行为。

| 组件 | 触发 | 变化属性 | 时长与曲线 | 可中断 | 减少动态效果降级 |
| --- | --- | --- | --- | --- | --- |
| Button | 悬停 | 背景色 | `motion-instant` 线性 | 是 | 无位移，仅换色 |
| Button | 提交中 | 内容替换为进度并锁定宽度 | `motion-fast` 淡出淡入 | 否，直到请求返回 | 直接切换文本 |
| Input | 聚焦 | 边框色 + 焦点环 | `motion-instant` | 是 | 立即显示焦点环 |
| Badge | 值变化 | 背景与文字淡换 | `motion-fast` | 是 | 立即替换 |
| Checkbox | 勾选 | 勾形路径描边 | `motion-fast` | 是 | 立即显示勾 |
| Sheet | 打开与关闭 | 位移 + 遮罩透明度 | `motion-base` 进入缓出 | 是，可再次点击关闭 | 仅淡入淡出 |
| Dialog | 打开 | 缩放 0.98 到 1 | `motion-base` | 是 | 仅淡入 |
| Toast | 出现与消失 | 位移 8px + 透明度 | `motion-fast` | 否 | 仅淡入淡出 |
| Skeleton | 数据到达 | 透明度降到 0 后移除 | `motion-slow` | 否 | 直接替换 |
| CopyButton | 复制成功 | 图标替换为勾，1.2 秒后还原 | `motion-fast` | 否 | 直接替换 |

任何反馈都不得改变元素占位导致布局跳动；上表中的时长全部取自动效令牌，不写死毫秒数；动画只做反馈，不承载业务状态。

## 4. Composition Rules

基础组件之间只通过属性通信，不共享全局状态。弹层统一挂载到内容容器而非文档根，保证在有侧边栏时遮罩不覆盖导航。表单控件在禁用时保留可读性，不降低对比度到不可辨认。图标按钮必须有 `aria-label`；纯装饰图标对辅助技术隐藏。

```tsx
const SaveButton = (props: { loading: boolean; onSave: () => void }) => (
  <Button variant="primary" size="md" loading={props.loading} onClick={props.onSave}>
    保存并生效
  </Button>
);
```
