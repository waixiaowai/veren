---
title: 业务组件
description: 十四个绑定接口的业务组件。
sidebar:
  order: 3
---
## 12. Business Components

业务组件绑定数据与状态：它们调用第 3 章定义的接口，把返回字段映射到复合组件，并处理加载、空、失败、重试、无权限、提交中与提交后反馈。业务组件不直接拼接链接、不格式化业务语义（格式化走统一入口），也不自行决定权限——权限判定来自第 4 章矩阵。

公共约定：每个业务组件持有一个 `requestSeq`，响应返回时若序号已过期则丢弃，避免旧响应覆盖新筛选；刷新或重试保持当前筛选与分页；提交中禁用重复提交，但不阻塞取消（取消只终止等待，不回滚已提交的服务端任务）。

| 状态 | 呈现 | 默认动作 |
|---|---|---|
| 加载 | 复合组件骨架 + `Spinner` | 无（超过 5 秒后追加"仍在处理"） |
| 空 | `EmptyState`（区分"尚无数据"与"筛选无结果"） | 清除筛选或给出创建入口 |
| 失败 | `ErrorBlock`（事实 + 原因 + 下一步） | 重试（保持参数）或返回 |
| 无权限 | `ErrorBlock`（说明原因与申请入口） | 打开授权或会员入口 |
| 提交中 | 按钮文案改为进行时 + 禁用 | 可取消等待 |
| 提交后 | 结果卡 + 链接 + 提示 | 继续下一个操作 |

### 12.1 AuthStatusView

接口：`CLI-WHOAMI`（读）、`CLI-LOGIN`（写）。字段映射：`baidu_name` → 账号名、`expires_at` → 到期时间、`authStatus` → 状态标签。

Props：`state`（`"anonymous" | "authorized" | "expiring" | "expired"`，必填）、`accountName`（string，可选）、`expiresAt`（string，可选）、`loginPlan`（`{ authUrl: string; expiresInMinutes: number }`，可选）。事件：`onLogin()`、`onLogout()`、`onRefresh()`。

```tsx
export const AuthStatusView = (props: AuthStatusViewProps) => {
  if (props.state === "anonymous") return <AuthGuidePanel state="notice" onAcceptNotice={props.onLogin} />;
  return (
    <ResultCard tone={props.state === "expiring" ? "warning" : "success"} title="百度网盘"
      rows={[{ label: "账号", value: props.accountName ?? "—" }, { label: "有效期至", value: props.expiresAt ?? "—" }]}
      note={props.state === "expired" ? "授权已过期，需要重新登录" : undefined} />
  );
};
```

竞态：登录与注销互斥；注销后立即清空账号名与到期时间，不保留上一次结果。

### 12.2 FileBrowser

接口：`CLI-LS`。字段映射：`server_filename` → 名称列、`size` → 大小（1024 进制）、`server_mtime` → 时间列、`return_markdown` → 链接列、`saved_path`/`path` → 路径。

Props：`dir`（string，必填）、`order`（`"name"|"time"|"size"`，可选）、`folderOnly`（boolean，默认 false）、`files`（`FileEntry[]`）、`loading`（boolean）、`error`（`{ code: string; message: string }`，可选）。事件：`onChangeOrder(next)`、`onOpenEntry(fsid)`、`onCopyPath(path)`。

```tsx
export const FileBrowser = (props: FileBrowserProps) => {
  if (props.loading) return <FileListPanel loading rows={[]} total={0} />;
  if (props.error) return <ErrorBlock title="无法读取目录" reason={props.error.message} code={props.error.code} retryable onRetry={props.onReload} />;
  return <FileListPanel total={props.files.length} rows={toRows(props.files)} loading={false}
    empty={{ title: "这个目录还是空的", description: "可以先上传文件，或换一个目录看看" }} />;
};
```

### 12.3 UploadResultView

接口：`CLI-UPLOAD`。字段映射：`action` → 动作文案（新建/另存/覆盖/复用）、`saved_path` → 路径、`conflict_detected` → 冲突提示、`verification` 与 `content_verified` → 校验说明、`return_markdown` → 链接。

Props：`result`（`UploadOutcome`，可选）、`pending`（boolean）、`error`（可选）、`onRetry()`、`onConfirmOverwrite()`。事件：`onOpenLink()`。

状态：冲突且未确认时展示 `ConfirmDialog`（对象为源与目标，后果为旧内容不可恢复）；提交中禁用重复点击；成功后提示"仅校验路径与大小"。竞态：同一目标的重复提交在 `pending` 期间被忽略。

### 12.4 DownloadResultView

接口：`CLI-DOWNLOAD`。字段映射：`local` → 本地落点、`saved_path` → 分享模式的转存落点、`remote` → 远端源、`return_markdown` → 链接。

Props：`result`（可选）、`pending`、`error`、`onRetry()`。提交后提示：分享模式必须同时展示"已转存到"与"已下载到"两处落点，缺一视为未完成。

### 12.5 TransferResultView

接口：`CLI-TRANSFER`、`CLI-TRANSFER-LIST`、`CLI-TRANSFER-SELECT`。字段映射：`status` → 状态标签（`completed` → "已保存"，`submitted` → "已提交"）、`files[].saved_path` → 逐项路径、`files[].return_markdown` → 逐项链接、`count` → 数量。

Props：`result`（可选）、`pending`、`error`、`sharePreview`（可选，分享目录条目）、`onListShare()`、`onConfirmSelect(fsids)`、`onRetry()`。状态：`submitted` 时只显示"任务已提交"，不显示完成链接；查询无结果时显示等待提示并保留任务号。

### 12.6 SearchResults

接口：`CLI-SEARCH`。字段映射：`items[].server_filename` → 名称、`category` → 类型、`size` → 大小、`return_markdown` → 链接。

Props：`query`（string）、`category`（number）、`page`（number）、`items`（`FileItem[]`）、`total`（number）、`loading`、`error`、`onFilterChange()`、`onPageChange()`。竞态：`requestSeq` 递增，旧请求回来直接丢弃；筛选变化把页码重置为 1。

### 12.7 ContentSearchResults

接口：`CLI-SEARCH-CONTENT`。字段映射：`hits[].file_name` → 文件名、`snippet` → 片段（占位文案转为提示）、`file_url` → 链接、`source_ref_id` → 与来源匹配的键（不展示）。

Props：`result`（可选）、`loading`、`error`、`notSvip`（boolean）、`onOpenHit(index)`、`onRetry()`。无权限：`notSvip` 为真时展示会员入口，而不是空白；零结果提示"未命中，不等于资料不存在"。

### 12.8 ContentReaderView

接口：`CLI-GET-CONTENT`、`CLI-GET-CONTENT-RESULT`。字段映射：`content` → 正文、`url` → 临时地址、`page_start`/`page_end`/`page_num` → 页范围、`char_count` → 字数、`truncated` → 截断提示、`return_markdown` → 链接。

Props：`items`（`ContentItem[]`）、`pending`（boolean）、`error`、`onPoll(taskId)`、`onRetryFailed(fsids)`、`onOpenUrl()`。状态：有 `task_id` 无 `content` → 进度面板 + "已转后台"；`running` → 继续轮询且不报失败；`partial` → 逐项标注成功/失败并只重试失败项；多文件下用下标对应，不用文件标识匹配。

```tsx
export const ContentReaderView = (props: ContentReaderViewProps) => {
  const pendingItems = props.items.filter((it) => it.task_id && !it.content);
  if (pendingItems.length) return <TaskProgressPanel mode="indeterminate" phase="正在解析文档" elapsedSeconds={props.elapsed} />;
  return <>{props.items.map((it, i) => (
    <ContentReader key={i} fileName={it.name} content={it.content} url={it.url}
      pageRange={toRange(it)} charCount={it.char_count} truncated={it.truncated}
      link={{ markdown: it.return_markdown }} loading={false} />
  ))}</>;
};
```

### 12.9 ShareResultView

接口：`CLI-SHARE`。字段映射：`link` → 链接、`pwd` → 提取码、`period` → 有效期文案（0 → "永久"）。

Props：`result`、`pending`、`error`、`onCopyLink()`、`onCreateNew()`。永久链接必须附带一句安全提示；不得把分享链接当作本人回端链接。

### 12.10 QuotaView

接口：`CLI-QUOTA`。字段映射：`total_display`/`used_display`/`free_display` → 三行摘要、`usage_percent` → 进度、`expire` → 到期提示、`message` → 状态说明。

Props：`snapshot`（`QuotaSnapshot`，可选）、`loading`、`error`、`onRefresh()`。异常数据（总量 ≤ 0、已用大于总量）不得渲染为 0% 成功态，按失败处理并保留原始值。

### 12.11 MemoryBackupView

接口：受控脚本（备份、列举、恢复），不直接调用 `CLI-UPLOAD`/`CLI-DOWNLOAD`。字段映射：`displayDir` → 备份目录、`fileCount` → 文件数、`safetyNetDir` → 安全网目录、`matchedBackup` → 命中备份。

Props：`mode`（`"backup" | "list" | "restore"`，必填）、`receipt`（可选）、`pending`、`error`、`backups`（可选）、`onBackup()`、`onRestore(date)`。状态：非支持环境 → 直接显示"当前环境不支持记忆备份"，不显示操作按钮；恢复确认中展示命中日期与将覆盖的文件数。

### 12.12 McpToolResultView

接口：`MCP-*`（由宿主传入）。字段映射：文本块 → `ToolResultCard.text`、`errorCode` → 错误码、`retryable` → 重试提示。

Props：`toolName`（string）、`result`（`ToolResult`）、`onRetry()`。协议宿主侧的组件不解析业务字段，只展示宿主已渲染的文本，避免与工具侧重复实现。

### 12.13 HelpView

接口：`CLI-HELP`（`--help`、`init`、`version`）。字段映射：安装路径、配置路径、版本号、更新提示。Props：`installPath`、`configPath`、`version`、`updateAvailable`、`onCheckUpdate()`。状态：版本不匹配时优先展示"需要升级"而不是参数说明。

### 12.14 Interface Consistency

每个业务组件只调用一个主接口（转存组件调用三个同族接口），调用的接口必须在 3.3 节存在且具备第 4 章矩阵中的判定；组件不自行实现"是否允许删除/覆盖"的判断，只消费 `BDPAN_CONFIRM_REQUIRED` 与 `BDPAN_PATH_OUT_OF_SCOPE` 等错误码并转向确认或提示。
