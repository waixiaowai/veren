---
title: 页面组件
description: 终端视图、会话场景与协议端页面。
sidebar:
  order: 4
---
## 13. Page Components

页面是业务组件与基础组件的薄封装，只负责路由参数、组件组装与页面级交互，不重复实现业务请求。终端端的"路由"是子命令，会话端的"路由"是场景，方案站点与原型有真实 URL；三种路由的状态来源不同，但恢复原则一致：能放进参数的状态就放进参数，放不进的（草稿、确认凭证）在会话上下文里短期保存，敏感内容一律不入参数。

### 13.1 State Sources

| 页面类型 | 状态来源 | 可分享/可恢复 | 刷新行为 | 说明 |
|---|---|---|---|---|
| 终端视图 | 子命令与开关 | 是（参数可重放） | 重新执行即恢复 | 无 URL；脚本可通过重复命令复现同一状态 |
| 会话场景 | 会话上下文 + 用户输入 | 否（会话不透明） | 由宿主恢复对话历史 | 不把确认凭证写入任何持久化位置 |
| 原型页 | URL 查询参数 | 是 | 由参数重建 | 参数见 13.4 节，非法值回落默认 |
| 方案站点 | URL 锚点 + 主题本地存储 | 是 | 定位同一锚点 | 主题偏好存 `localStorage`，键 `design-theme` |

终端视图的参数约定：筛选与分页只出现在 `ls`、`search`、`search-content`（`--page`、`--page-size`、`--category`、`--no-dir`、`--dir-only`）；排序只出现在 `ls`（`--order`、`--desc`）；筛选变化一律把页码重置为 1。非法值（如 `--page-size 0`）在参数解析阶段拒绝，回落到默认值并提示，不静默接受。

### 13.2 Terminal Pages

#### 13.2.1 Login Page

Props：`state`（`"notice" | "awaiting-code" | "exchanging" | "failed"`）、`authUrl`、`expiresInMinutes`、`error`、`welcome`。布局：须知段落（不超过 6 行）→ 授权链接（独占一行）→ 回填说明 → 状态行。事件：`onAcceptNotice`、`onSubmitCode`、`onRetry`。

```tsx
export const LoginPage = (props: LoginPageProps) => (
  <AuthGuidePanel state={props.state} authUrl={props.authUrl} expiresInMinutes={props.expiresInMinutes}
    error={props.error} welcome={props.welcome}
    onAcceptNotice={props.onAcceptNotice} onSubmitCode={props.onSubmitCode} onRetry={props.onRetry} />
);
```

四态：加载 = 等待用户确认（不显示链接）；空 = 已登录时不进入本页；失败 = 展示失败原因与重试；无权限 = 不适用。

#### 13.2.2 Status Page

Props：`state`、`accountName`、`expiresAt`。组装 `AuthStatusView`。四态：加载 = 查询中；空 = 未登录（引导登录）；失败 = 查询失败可重试；无权限 = 不适用。

#### 13.2.3 List Page

Props：`dir`（默认授权根）、`order`、`desc`、`folderOnly`、`files`、`total`、`loading`、`error`。组装 `FileBrowser`。四态：加载 = 空表 + 骨架；空 = 目录为空（给上传入口）或筛选无结果（给清除筛选）；失败 = 可重试；无权限 = 越界提示（不显示空白）。

#### 13.2.4 Upload Page

Props：`localPath`、`remotePath`、`overwrite`、`result`、`pending`、`error`。组装 `UploadResultView` + （冲突时）`ConfirmDialog`。四态：加载 = 进度面板；空 = 不适用；失败 = 分片或创建失败；无权限 = 越界或未登录。

#### 13.2.5 Download Page

Props：`remote`、`local`、`pwd`、`transferDir`、`result`、`pending`、`error`。组装 `DownloadResultView` + `TaskProgressPanel`（大文件）。四态：加载 = 进度；空 = 不适用；失败 = 直链失效或写入失败；无权限 = 越界。

#### 13.2.6 Transfer Page

Props：`shareLink`、`pwd`、`destDir`、`result`、`preview`、`pending`、`error`。组装 `TransferResultView` + `FileListPanel`（分享目录）+ `ConfirmDialog`（选择性与删除性操作）。四态：加载 = 排队或提交中；空 = 分享目录为空；失败 = 提取码、上限、任务不可查；无权限 = 越界或未登录。

#### 13.2.7 Search Page

Props：`query`、`category`、`page`、`pageSize`、`items`、`total`、`loading`、`error`。组装 `SearchResults`。四态：加载 = 骨架；空 = 无匹配（保留查询词，提供清除筛选）；失败 = 可重试并保持筛选；无权限 = 越界或未登录。

#### 13.2.8 Content Search Page

Props：`query`、`dir`、`fileTypes`、`pageSize`、`result`、`notSvip`、`loading`、`error`。组装 `ContentSearchResults`。四态：加载 = 检索中；空 = 未命中（说明"不等于不存在"）；失败 = 权益、配额或索引未就绪；无权限 = 非超级会员（给会员入口）。

#### 13.2.9 Content Page

Props：`items`、`pending`、`error`、`elapsed`。组装 `ContentReaderView`。四态：加载 = 解析中（含已等待）；空 = 正文为空（但保留链接）；失败 = 转换中、文件无效、超时；无权限 = 越界或类型不支持。

#### 13.2.10 Share Page

Props：`paths`、`period`、`result`、`pending`、`error`。组装 `ShareResultView`。四态：加载 = 创建中；空 = 不适用；失败 = 路径不存在或无权限；无权限 = 越界。

#### 13.2.11 Quota Page

Props：`snapshot`、`loading`、`error`。组装 `QuotaView`。四态：加载 = 查询中；空 = 不适用；失败 = 数据异常（保留原始值）；无权限 = 未登录。

#### 13.2.12 Memory Page

Props：`mode`、`receipt`、`backups`、`pending`、`error`、`supported`。组装 `MemoryBackupView` + `ConfirmDialog`（恢复前）。四态：加载 = 上传或下载中；空 = 暂无备份；失败 = 清单无效或安全网失败；无权限 = 非支持环境。

#### 13.2.13 Help Page

Props：`installPath`、`configPath`、`version`、`requiredVersion`、`updateAvailable`。组装 `HelpView`。四态：加载 = 不适用；空 = 不适用；失败 = 版本检查失败（不阻断帮助内容）；无权限 = 不适用。

### 13.3 Conversation and Host

#### 13.3.1 Conversation Scene

Props：`scene`（六个场景之一）、`plan`（`DisplayPlan`）、`confirm`（`RiskAssessment`，可选）、`progress`（`{ phase: string; percent?: number; elapsedSeconds: number }`，可选）。组装：确认场景用 `ConfirmDialog`，进度场景用 `TaskProgressPanel`，结果场景用 `ResultCard`/`FileListPanel`/`SearchHitsPanel`/`ContentReader`，失败场景用 `ErrorBlock`。

```tsx
export const ConversationScene = (props: ConversationSceneProps) => {
  switch (props.scene) {
    case "confirm": return <ConfirmDialog {...toConfirmProps(props.confirm!)} onConfirm={props.onConfirm} onCancel={props.onCancel} />;
    case "progress": return <TaskProgressPanel {...props.progress!} onCancel={props.onCancel} />;
    case "result": return <ResultCard {...toResultProps(props.plan)} />;
    default: return <ErrorBlock {...toErrorProps(props.plan)} />;
  }
};
```

四态与会话场景的映射：加载 = `progress`；空 = 结果为空时用 `EmptyState`；失败 = `error`；无权限 = `error` 中带"申请授权/开通会员"入口。转场：场景切换不做整屏位移动画，只做内容替换；深链接不适用（会话无 URL），刷新由宿主恢复对话。

#### 13.3.2 Tools Page

Props：`tools`（`ToolSpec[]`）、`connected`（boolean）、`error`。组装：工具列表（名称 + 说明 + 必填参数），不使用表格（宿主控件更合适）。四态：加载 = 连接中；空 = 无工具（未授权）；失败 = 连接错误；无权限 = 令牌无效提示。

#### 13.3.3 Tool Result Page

Props：`toolName`、`result`（`ToolResult`）。组装 `McpToolResultView`。四态：加载 = 调用中；空 = 结果为空文本（提示"没有返回内容"）；失败 = `isError=true`；无权限 = 未授权错误码。

### 13.4 Prototype and Transitions

原型页 `prototype.html` 的查询参数：`tab`（`agent` / `terminal` / `host`）、`scene`（`list` / `upload` / `transfer` / `search-content` / `confirm` / `error`）、`state`（`success` / `empty` / `error` / `no-permission`）、`theme`（`light` / `dark`）。默认 `tab=agent&scene=list&state=success`；非法值回落到默认并在控制台提示，不弹错误页。参数变化用 `replace` 写回，不产生历史记录堆栈；`tab` 切换属于视图切换，用 `push` 以便后退返回上一个视图。

转场与状态恢复的先后：先恢复滚动位置与展开状态，再播放进入动画（`--dur-base`）；刷新与前进后退可重放转场，但转场不得改写 URL、不得重复请求（原型无请求，此约束用于真实实现）。视觉位置恢复优先于进场动画，避免"先动画后跳位"的抖动。

页面组装的三条硬规则：其一，页面不直接构造 `return_markdown`，只透传；其二，页面不在渲染期发起请求，请求由业务组件在挂载时触发一次，参数变化时以 `requestSeq` 守卫；其三，四态必须覆盖，无权限不得以空白或"加载中"长期停留。
