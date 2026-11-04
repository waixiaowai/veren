---
title: 复合组件
description: 由基础组件构成的布局与组合契约，不承担业务数据获取。
sidebar:
  order: 102
  label: 复合组件
lastUpdated: 2026-11-04
---

复合组件由基础组件构成，定义布局、插槽、对齐与响应式行为，仍不承担业务数据获取。同一区域内同时触发的过渡共用同一动效令牌与曲线。

## 1. Component List

| 组件 | 构成 | 用途 |
| --- | --- | --- |
| FormRow | Label + 输入控件 + 错误文本 | 表单单行布局，错误与字段关联 |
| OptionGroup | Label + Select/Switch 组 | 枚举或开关配置的成组呈现 |
| CountField | Label + 数字输入 + 上下限校验 | 数量上限类配置 |
| TerminalView | ScrollArea + Badge + 文本行 | 终端日志区布局（级别标记 + 内容行） |
| FileGrid | Card 网格 + Badge | 数据文件卡片网格 |
| PreviewTable | 表格 + ScrollArea + 分页脚注 | 数据预览表格 |
| ModalShell | Dialog + 标题区 + 动作区 | 对话框统一外壳 |

## 2. Contracts

```tsx
interface FormRowProps {
  id: string;                     // 关联输入的 id
  label: string;
  error?: string | null;          // 非空时渲染错误文本并以 aria 关联
  required?: boolean;
  children: React.ReactNode;      // 输入控件插槽
}

interface TerminalViewProps {
  lines: TerminalLine[];          // { id, timestamp, level, message }
  connected: boolean;             // 连接状态徽标
  onCopy: () => void;
}

interface ModalShellProps {
  title: string;
  actions?: React.ReactNode;      // 底部动作插槽
  children: React.ReactNode;
}
```

```tsx
// 用途：表达组合与事件传递（非实现）
<FormRow id="max-notes" label="内容数量上限" error={errors.maxNotes}>
  <CountField value={value} min={1} onChange={setValue} />
</FormRow>
```

响应式行为：窄屏（<768px）下 FormRow 纵向堆叠、FileGrid 单列、PreviewTable 横向滚动；对齐规则统一为标签左对齐、动作区右对齐。子组件微交互节奏一致：对话框整体进出共用 `motion-normal`，组内控件反馈共用 `motion-fast`。
