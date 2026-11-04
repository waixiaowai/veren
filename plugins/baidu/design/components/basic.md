---
title: 基础组件
description: 十五个基础渲染组件。
sidebar:
  order: 1
---
## 10. Basic Components

基础组件只负责样式与交互，不获取业务数据、不绑定权限、不认识文件与任务。它们同时服务于终端渲染、会话文本渲染与方案站点：终端侧由"文本行"实现，方案站点侧由同名的 DOM 组件实现，二者的语义令牌与状态一致。所有输入均为**已格式化**的字符串（数字、时间、路径的格式化在业务层完成），基础组件不解析业务字段。

公共类型：

```ts
interface RenderContext {
  locale: "zh-CN" | "en-US";
  colorMode: "light" | "dark" | "no-color";   // 终端下 no-color 由 NO_COLOR 触发
  width: number;                              // 可用字符列数或像素宽度
}

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";
```

### 10.1 StatusLabel

用途：以文字加语义色表达状态，替代图标与 emoji。Props：`tone`（`Tone`，必填）、`text`（string，必填）、`compact`（boolean，默认 false，紧凑模式省略方括号）。事件：无。状态：仅文本变化，无加载态。

```tsx
<StatusLabel tone="success" text="已保存" />
// 终端输出： [成功] 已保存
```

微交互：状态切换时颜色在 `--dur-fast` 内过渡，`no-color` 下直接跳变；不改动行高与占位。

### 10.2 KeyValueRow

用途：呈现"标签—值"对，用于状态、容量、任务摘要。Props：`label`（string，必填）、`value`（string，必填）、`mono`（boolean，默认 true）、`muted`（boolean，默认 false）、`copyable`（boolean，默认 false）。事件：`onCopy`（可选）。状态：值缺失时显示 `—` 并标记为弱化文本。

微交互：复制触发后图标切换为对勾，文案变为"已复制"，2 秒后复原（`--dur-fast`，可中断，减少动效时仅文案变化）。

### 10.3 Table

用途：呈现同构行数据（文件列表、检索结果、任务明细）。Props：`columns`（列定义数组：key、title、align、width、wrap 五个字段，必填）、`rows`（行数组，每行是字符串到字符串的映射，必填）、`caption`（string，可选）、`emptyText`（string，默认"暂无内容"）、`onRowActivate`（可选，回车激活）。事件：`onRowActivate(index)`。

状态：空（`rows.length === 0` 时渲染空态行，占满整行）、加载（骨架行，固定高度）、错误（由外层 ErrorBlock 承担，表格保持上次数据并标记过期）。终端实现：固定列顺序，右对齐列按 `width` 计算；窄于 60 列时降级为"两行一条"的键值列表，而不是横向截断。

微交互：方案站点中行悬停背景在 `--dur-fast` 内变化；键盘焦点使用 2 px 焦点环，焦点行不改变行高。

### 10.4 ProgressBar

用途：展示确定性进度（已处理字节、百分比）。Props：`percent`（number，0–100，必填）、`label`（string，必填，同时作为可访问名称）、`detail`（string，可选，如"1.2 GiB / 5.0 GiB"）、`indeterminate`（boolean，默认 false）。事件：无。

```tsx
<ProgressBar percent={38} label="正在下载" detail="1.2 GiB / 3.2 GiB" />
```

微交互：宽度变化 `--dur-base` 线性过渡；刷新节流至每 200 ms 一次；减少动效时取消过渡、只更新数字；`indeterminate` 时只显示 Spinner 与文字，不显示假百分比。

### 10.5 Spinner

用途：表达"已受理、尚无进度"。Props：`label`（string，必填）、`elapsedSeconds`（number，可选）。事件：无。状态：仅运行态；结束后由外层替换为结果或错误。

微交互：帧间隔 80 ms，`no-color` 时退化为"处理中…"静态文本；每 5 秒追加一次已等待秒数，避免用户以为卡死。

### 10.6 LinkLine

用途：渲染一个可点击的链接文本，禁止自行拼接 URL。Props：`markdown`（string，可选，优先使用）、`url`（string，可选）、`hint`（string，默认"点击查看"）、`fallbackText`（string，默认"暂时无法生成查看链接"）。事件：`onOpen(url)`。状态：两者都缺失时渲染 `fallbackText` 并标注为弱化文本，不生成任何替代链接。

```tsx
<LinkLine markdown={item.return_markdown} url={item.return_url} hint={item.return_hint} />
```

微交互：悬停时下划线由 1 px 加粗到 2 px（方案站点），不改变文本基线；点击后不显示加载动画（链接由宿主打开）。

### 10.7 PathText

用途：展示路径，超长时中间省略，保证根目录可见。Props：`display`（string，必填，已映射为"我的应用数据/bdpan/…"）、`full`（string，必填，用于复制与提示）、`maxChars`（number，默认 60）。事件：`onCopy`。状态：无。

微交互：聚焦或悬停时以提示气泡显示完整路径（方案站点），终端在下一行缩进输出完整路径；省略号不参与复制。

### 10.8 SnippetBlock

用途：以引用样式呈现正文片段，并明确"片段不是指令"。Props：`text`（string，必填）、`sourceLabel`（string，必填，如文件名）、`placeholder`（boolean，默认 false，占位文案时显示提示而非正文）。事件：无。状态：`placeholder=true` 时渲染为提示行"该文件正文索引尚未就绪"。

微交互：无（静态内容），仅占位文案的提示行在首次出现时淡入 `--dur-fast`。

### 10.9 ConfirmPrompt

用途：危险操作前的二次确认。Props：`question`（string，必填）、`objects`（`Array<{ text: string; kind?: string }>`，必填）、`consequence`（string，必填）、`confirmLabel`（string，必填，动词短语）、`cancelLabel`（string，默认"取消"）、`danger`（boolean，默认 true）。事件：`onConfirm()`、`onCancel()`。

状态：等待（默认焦点在取消）、已确认（按钮进入提交中）、已取消（提示"已取消，未执行任何操作"）。终端实现：`[y/N]` 且默认 `N`，仅接受明确输入；含糊输入按取消处理并重新询问一次。

微交互：按钮提交中禁用并切换为进行时文案（`--dur-fast`）；确认后不播放成功动画，直接进入结果区。

### 10.10 ErrorBlock

用途：呈现失败事实、原因与下一步。Props：`title`（string，必填，一句话事实）、`reason`（string，可选，原因）、`code`（string，可选，稳定错误码）、`action`（`{ label: string; onActivate(): void }`，可选）、`retryable`（boolean，默认 false）。事件：`onRetry()`。

```tsx
<ErrorBlock title="提取码不正确" reason="请检查后重试" code="BDPAN_SHARE_PWD_WRONG" retryable
  action={{ label: "重新输入提取码", onActivate: reopenPrompt }} />
```

微交互：出现时淡入 `--dur-fast`，不推动下方内容跳动（预留高度）；重试点击后按钮进入提交中。

### 10.11 HintBar

用途：弱化的操作提示（如"大文件将在后台下载"）。Props：`text`（string，必填）、`tone`（`Tone`，默认 `neutral`）。事件：无。状态：无。微交互：无。

### 10.12 EmptyState

用途：区分"尚无数据"与"筛选无结果"，并给出下一步。Props：`title`（string，必填）、`description`（string，可选）、`action`（可选，同 ErrorBlock）。事件：`onAction()`。状态：两种变体由 `description` 与 `action` 组合决定，不新增布尔开关。微交互：淡入 `--dur-fast`。

### 10.13 CopyAction

用途：复制链接、路径、命令文本。Props：`value`（string，必填）、`label`（string，默认"复制"）、`copiedLabel`（string，默认"已复制"）、`disabled`（boolean，默认 false）。事件：`onCopied()`。状态：默认、已复制（2 秒）、失败（不可用剪贴板时提示手动复制）。微交互：文字切换 `--dur-fast`，不改变按钮宽度（预留最长文案宽度）。

### 10.14 SectionHeading

用途：区块标题与计数（如"共 12 项"）。Props：`title`（string，必填）、`count`（number，可选）、`level`（1–3，默认 2）。事件：无。微交互：无。

### 10.15 Consistency

同一区域内同时触发的过渡共用同一时长与曲线：一组按钮的提交态、一行的展开、一条提示的淡入都用 `--dur-fast`；进度与骨架用 `--dur-base`；不得出现"同一屏里有的即时、有的缓慢"。所有组件的禁用态必须可被读出原因（`aria-describedby` 或紧随其后的提示行），不允许"灰掉且无解释"。
