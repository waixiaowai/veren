---
title: bridge 协议网关
description: 工具目录、两种运行形态与调用结果。
sidebar:
  order: 3
---
## 2.3 Bridge

bridge 是协议网关：它把能力注册成宿主可发现的工具目录，接收工具调用、校验参数、转成内核调用，再把结果组织成宿主可消费的文本块。它与相邻模块的分界是：bridge 不读取本地文件（唯一的例外是本地进程形态下的本地上传工具）、不保存账号凭据（凭据随连接注入）、不维护跨会话状态；它也不生成面向最终用户的整段回复，只交付"工具结果文本"。

### 2.3.1 Capabilities

【实现】两种运行形态：远端托管（宿主以远端地址接入，凭据作为连接参数）+ 本地进程（宿主以标准输入输出拉起进程，凭据经环境变量注入，可访问本地文件）。工具面覆盖文件信息、文件管理、上传、检索、分享、用户与容量六组，共 18 项。

| 工具 | 作用 | 关键参数与限制 | 可达形态 |
|---|---|---|---|
| `file_list` | 列目录（不限类型） | `dir` 绝对路径，中文需编码；`page` 缺省时不分页返回全部 | 两种 |
| `file_doc_list` / `file_image_list` / `file_video_list` | 按类型列目录 | 参数同 `file_list` | 两种 |
| `file_meta` | 按文件标识批量取详情 | `fsids` 数组，最多 10 个 | 两种 |
| `make_dir` | 创建目录 | `path` 必填；`rtype` 冲突策略 0/1/2/4 | 两种 |
| `file_copy` / `file_move` | 复制、移动 | `async` 0/1/2；`ondup` fail/newcopy/overwrite/skip；`filelist` 为对象数组 | 两种 |
| `file_del` | 删除 | `filelist` 为路径数组；高风险工具 | 两种 |
| `file_rename` | 重命名 | `filelist` 为 `{path,newname}` 数组 | 两种 |
| `file_keyword_search` | 文件名关键词检索 | `dir`、`key`、`page`、`num`（缺省 50） | 两种 |
| `file_semantics_search` | 自然语言语义检索 | `dir`、`query` | 两种 |
| `file_sharelink_set` | 创建分享链接 | `fsid_list` 为 JSON 字符串数组；`period` 天；`pwd` 4 位 | 两种 |
| `user_info` | 取账号资料 | 无参数 | 两种 |
| `get_quota` | 取容量 | 无参数 | 两种 |
| `file_upload_by_url` | 按远程链接上传 | `url`、`dir`、`filename`；未指定目录时落到网关默认目录 | 两种 |
| 文本上传（工具名待定） | 按文本内容生成文件 | `content` 不超过 2 万字；未指定文件名时生成文档格式 | 两种 |
| `upload_file` | 上传本地文件 | `local_file_path`、可选 `remote_path` | 仅本地进程 |

【待确认】文本上传在工具表中与链接上传共用 `file_upload_by_url` 名称，宿主侧会出现重名工具；文本上传的正式工具名与是否合并参数需要与上游确认（见 17.3 节 D-03）。

参数校验规则：路径必须是绝对路径且以 `/` 开头；`fsid` 一律按字符串处理，禁止转数值；分页参数从 1 开始；`async` 只在复制、移动、删除、重命名上生效。工具结果统一为文本块的数组，结构化字段以 JSON 文本内嵌，宿主可原样展示或解析。

### 2.3.2 Contracts

```ts
type ToolScope = "read" | "write" | "dangerous";

interface ToolSpec {
  name: string;                           // 全局唯一，snake_case
  title: string;                          // 面向宿主的短标题
  description: string;                    // 说明用途、限制与默认值，不写实现细节
  scope: ToolScope;                       // 只读 / 写入 / 危险
  inputSchema: JsonSchema;                // 参数模式，含 required 与默认值
  idempotent: boolean;                    // 重复调用是否等价
  transports: Array<"remote" | "local">;  // 可达形态
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  requestId: string;                      // 宿主提供的调用标识，用于日志关联
}

interface ToolTextContent { type: "text"; text: string }

interface ToolResult {
  isError: boolean;
  content: ToolTextContent[];             // 至少一块；结构化结果序列化为 JSON 文本
  errorCode?: string;                     // 见第 5 章
  retryable?: boolean;
}

interface GatewaySession {
  transport: "remote" | "local";
  accountRef: string;                     // 账号引用，不落明文令牌
  startedAt: string;                      // ISO 8601
}

abstract class Gateway {
  abstract listTools(): ToolSpec[];
  abstract call(call: ToolCall, session: GatewaySession): Promise<ToolResult>;
  abstract describeResource(uri: string): Promise<string>;   // 帮助类只读资源
}
```

错误约定：参数缺失或类型不符在网关层直接拒绝（`isError=true`，不调用上游）；上游失败按第 5 章映射为 `errorCode` 并保持 `isError=true`；删除类工具在缺少明确对象时拒绝执行，不提供"删除整个目录"的语法糖。

### 2.3.3 Flows

```ts
async function handleCall(call: ToolCall, session: GatewaySession): Promise<ToolResult> {
  const spec = catalog.find(call.name);
  if (!spec) return toolError("BDPAN_INVALID_ARG", `未知工具 ${call.name}`);
  const parsed = validate(spec.inputSchema, call.arguments);        // 类型、必填、范围
  if (!parsed.ok) return toolError("BDPAN_INVALID_ARG", parsed.reason);

  if (spec.scope === "dangerous" && parsed.value.confirmToken !== session.confirmToken) {
    return toolError("BDPAN_CONFIRM_REQUIRED", "危险操作需要在会话中确认后重试");
  }

  const normalized = normalizePaths(parsed.value);                  // 绝对路径、字符串标识
  const result = await kernel.execute(call.name, normalized, session.accountRef);
  if (!result.ok) {
    const mapped = mapFailure(result.failure);                      // 统一码 + 可重试标记
    return { isError: true, errorCode: mapped.code, retryable: mapped.retryable,
             content: [{ type: "text", text: renderFailure(mapped) }] };
  }
  return { isError: false, content: [{ type: "text", text: renderSuccess(call.name, result.value) }] };
}
```

`renderSuccess` 的职责边界要写清：它只把结构化字段渲染成"可读但不承诺排版"的文本，不拼接链接、不判断可预览性、不生成面向用户的整段话术；这些属于宿主或行为层。

### 2.3.4 Acceptance

| 编号 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|
| BR-01 | 网关已启动 | 列出工具 | 返回 18 项，重名项被标注，`upload_file` 只在本地形态出现 |
| BR-02 | 本地进程形态 | 调用 `upload_file` 上传本地文件 | 返回文件标识与远端路径；未指定目录时落到网关默认目录 |
| BR-03 | 远端托管形态 | 调用 `upload_file` | 工具不存在，宿主收到明确的"不支持"错误而非静默失败 |
| BR-04 | 任意形态 | 调用 `file_list` 且 `dir` 含中文 | 路径编码正确，返回该目录条目 |
| BR-05 | 任意形态 | 调用 `file_meta` 传入 11 个标识 | 网关层拒绝，提示上限 10，不调用上游 |
| BR-06 | 任意形态 | `file_del` 缺少对象 | 拒绝执行，返回参数错误 |
| BR-07 | 令牌失效 | 任意工具 | 返回未授权错误码，宿主可提示重新授权 |
| BR-08 | 上游限流 | 连续调用检索 | 返回限流错误码且标记可重试 |
| BR-09 | 任意形态 | 调用不存在的工具名 | 返回参数错误，不抛未捕获异常 |
| BR-10 | 帮助资源 | 读取帮助资源 | 返回工具清单与参数说明，内容与工具目录一致 |
