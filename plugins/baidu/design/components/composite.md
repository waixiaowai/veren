---
title: 复合组件
description: 八个复合组件与组合一致性。
sidebar:
  order: 2
---
## 11. Composite Components

复合组件由基础组件组合而成，负责布局、插槽、对齐与组件间交互，仍不获取业务数据：所有数据由业务层以已格式化的形式传入。复合组件的微交互必须节奏一致——同一区域的展开、提交与提示共用 `--dur-fast`，进度与骨架共用 `--dur-base`。

### 11.1 ResultCard

用途：单结果操作的统一呈现（上传、下载、移动、复制、重命名、建目录、分享）。组合：`StatusLabel` + `KeyValueRow`（动作类型、实际落点）+ `PathText` + `LinkLine` + `HintBar`（校验范围提示）。

Props：`tone`（`Tone`，必填）、`title`（string，必填，如"上传完成"）、`rows`（`Array<{ label: string; value: string; mono?: boolean }>`，必填）、`path`（`{ display: string; full: string }`，可选）、`link`（`{ markdown?: string; url?: string; hint?: string }`，可选）、`note`（string，可选）、`onCopyPath`（可选）。事件：`onOpenLink`、`onCopyPath`。

布局：标题行左对齐状态与标题，右侧放复制动作；键值行两列对齐，值列左对齐；路径独占一行；链接单独一行，不与路径同行以免误点。窄屏（终端 < 70 列）时键值对改为上下两行。

```tsx
<ResultCard tone="success" title="上传完成"
  rows={[{ label: "动作", value: "新建" }, { label: "大小", value: "2.4 MB" }]}
  path={{ display: "我的应用数据/bdpan/报告.pdf", full: "/apps/bdpan/报告.pdf" }}
  link={{ markdown: result.return_markdown, url: result.return_url }}
  note="仅校验路径与大小，未做逐字节校验" />
```

### 11.2 FileListPanel

用途：目录浏览的统一容器（工具栏 + 表格 + 汇总）。组合：`SectionHeading` + `Table` + `EmptyState` + `HintBar`。

Props：`title`（string，默认"文件列表"）、`columns`（同 `Table`）、`rows`（行数组，每行已含名称、大小、时间、链接）、`total`（number，必填）、`empty`（`{ title: string; description?: string; actionLabel?: string }`，可选）、`loading`（boolean，默认 false）。事件：`onActivateRow(index)`、`onEmptyAction()`。

响应式：宽屏四列；终端 60–79 列时把"时间"并入名称行第二行；< 60 列降级为键值列表。空目录与筛选无结果使用不同 `empty` 文案。

```tsx
<FileListPanel total={files.length} rows={toRows(files)} loading={pending}
  empty={{ title: "这个目录还是空的", description: "可以先上传文件，或换一个目录看看" }} />
```

### 11.3 SearchHitsPanel

用途：正文检索结果的呈现（片段 + 来源 + 链接）。组合：`SectionHeading` + `SnippetBlock` + `LinkLine` + `HintBar`。

Props：`hits`（`Array<{ fileName: string; snippet: string; placeholder: boolean; link: { markdown?: string; url?: string; hint?: string } }>`，必填）、`total`（number，必填）、`note`（string，可选，如"结果可能未覆盖全部相关内容"）。事件：`onOpenLink(index)`。

布局：每条命中一个块，块内顺序为"文件名 → 片段 → 链接"；块间留 16 px（终端 1 行）。链接不得与片段混排在同一段落，避免被当作片段内容。

### 11.4 TaskProgressPanel

用途：异步任务的进度呈现（大文件传输、转存提交、解析轮询）。组合：`StatusLabel` + `ProgressBar` 或 `Spinner` + `KeyValueRow`（阶段、已等待）+ `HintBar`（后台提示）。

Props：`phase`（string，必填，如"上传分片 3/8"）、`percent`（number，可选）、`detail`（string，可选，如"1.2 GiB / 3.2 GiB"）、`elapsedSeconds`（number，必填）、`mode`（`"determinate" | "indeterminate"`，默认 `determinate`）、`cancelHint`（string，默认"可以按 Ctrl+C 取消"）。事件：`onCancel()`。

行为：`mode=indeterminate` 时隐藏百分比，只显示已等待秒数与阶段；超过 60 秒追加"仍在处理，不是失败"的提示；任务结束后由外层替换为结果卡，不在进度面板内直接显示成功。

### 11.5 AuthGuidePanel

用途：登录引导（须知 → 授权链接 → 回填授权码）。组合：`StatusLabel` + 文本段落 + `LinkLine`（授权地址）+ `HintBar`（有效期与安全提示）+ `ConfirmPrompt`（须知确认）。

Props：`state`（`"notice" | "awaiting-code" | "exchanging" | "failed"`，必填）、`authUrl`（string，可选）、`expiresInMinutes`（number，默认 10）、`error`（`{ title: string; reason?: string; code?: string }`，可选）、`welcome`（string，可选，登录成功后的场景化欢迎语）。事件：`onAcceptNotice()`、`onSubmitCode(code)`、`onRetry()`。

约束：须知未确认不展示授权链接；授权码输入不回显、不进入日志；失败时先说明原因再给重试入口，不直接要求重新授权。

### 11.6 ConfirmDialog

用途：高危操作的确认容器（会话端与原型）。组合：`ConfirmPrompt` + `Table`（对象清单）+ `HintBar`（不可逆说明）。

Props：`question`（string，必填）、`objects`（`Array<{ text: string; kind: string }>`，必填）、`consequence`（string，必填）、`confirmLabel`（string，必填）、`danger`（boolean，默认 true）。事件：`onConfirm()`、`onCancel()`、`onEditSelection()`。

布局：标题 → 对象清单（可滚动，最多 8 行后折叠为"还有 N 项"）→ 后果 → 动作区。动作区固定"取消"在左、"执行"在右，默认焦点在取消；`Esc` 等价取消。

### 11.7 ContentReader

用途：正文阅读区（含页范围、字数、截断与超长提示）。组合：`SectionHeading` + `KeyValueRow` + 正文块 + `LinkLine` + `HintBar`。

Props：`fileName`（string，必填）、`content`（string，可选）、`url`（string，可选，超长正文的临时地址）、`pageRange`（`{ start: number; end: number; total: number }`，可选）、`charCount`（number，可选）、`truncated`（boolean，默认 false）、`link`（可选）、`loading`（boolean，默认 false）。事件：`onOpenUrl()`、`onCopyContent()`。

状态：加载（Spinner + "正在解析"）、正文（正文块带最大高度与内部滚动）、超长（正文为空时展示"正文超过 2 万字，请用临时地址获取"，并提示 2 小时有效）、失败（ErrorBlock）。

### 11.8 ToolResultCard

用途：协议宿主侧的工具结果呈现（宿主渲染时的建议结构）。组合：`StatusLabel` + 等宽文本块 + `ErrorBlock`（失败时）+ `HintBar`（可重试提示）。

Props：`toolName`（string，必填）、`isError`（boolean，必填）、`text`（string，必填）、`errorCode`（string，可选）、`retryable`（boolean，默认 false）。事件：`onRetry()`。约束：不渲染 Markdown 链接为可点击（由宿主决定），不隐藏错误码。

### 11.9 Composition Consistency

八个复合组件共用三条规则：其一，标题行永远在最上、动作在最右；其二，链接永远单独成行且带前缀文案，不与数据混排；其三，任何"提交中"状态都在原地切换文案，不插入新行导致布局跳动。
