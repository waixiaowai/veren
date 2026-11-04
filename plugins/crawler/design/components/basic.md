---
title: 基础组件
description: 控制台面板基础组件契约：只负责样式与交互，不含业务语义。
sidebar:
  order: 101
  label: 基础组件
lastUpdated: 2026-11-04
---

基础组件层只负责样式和交互，不获取业务数据、不绑定领域权限。面板复用成熟的 shadcn 风格组件族，本章定义其在本方案中的能力面与适配契约；不写组件内部实现，仅给出调用级伪代码。

## 1. Component List

| 组件 | 用途 |
| --- | --- |
| Button | 动作触发，含提交中、禁用、危险变体 |
| Input / Textarea | 单行与多行文本输入 |
| Select / Combobox | 选项选择（平台、模式、介质等枚举） |
| Switch | 开关（评论、媒体、无头等布尔项） |
| Checkbox | 多选（目标 id 列表等） |
| Label | 表单标签与错误关联 |
| Dialog | 对话框容器（免责声明、环境检查、数据预览） |
| Card | 区块容器 |
| Badge | 状态与级别标记 |
| Tooltip | 悬停提示 |
| ScrollArea | 统一滚动容器（终端、表格） |
| Icon | 内联 SVG 图标契约 |

## 2. Contracts

```tsx
interface IconButtonProps {
  icon: IconName;                 // 统一图标名，SVG 内联
  label: string;                  // 必填：可访问名称
  onClick: () => void;
  disabled?: boolean;
}

interface ButtonProps {
  variant: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;              // 提交中：禁点且换Spinner
  children: React.ReactNode;
}

interface ScrollAreaProps {
  followBottom?: boolean;         // 终端日志贴底跟随语义
  onScrollStateChange?: (following: boolean) => void;
}
```

微交互声明（逐组件）：Button 悬停与提交中变化背景色与透明度，`motion-fast` 标准曲线，可中断，降级为透明度跳变；Dialog 进出用 `motion-normal` 进入曲线，可中断，降级为直接显隐；Switch 与 Checkbox 变化用 `motion-fast`，降级为状态跳变；ScrollArea 回到底部按钮的显隐用 `motion-fast` 透明度过渡。反馈不改变元素占位，时长一律取动效令牌。

## 3. Usage

```tsx
// 用途：表达基础组件的组合调用方式（非实现）
<Dialog open={open}>
  <Label htmlFor="keywords">关键词</Label>
  <Textarea id="keywords" aria-describedby="keywords-error" />
  <span id="keywords-error" role="alert">{errorText}</span>
  <Button variant="primary" loading={submitting} onClick={onStart}>启动采集</Button>
</Dialog>
```
