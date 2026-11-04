---
title: command 命令行能力面
description: 子命令、输出形态、冲突处理与模块验收。
sidebar:
  order: 2
---
## 2.2 Command

command 是整套能力的执行面：它把身份、容量、文件、分享、检索、正文、备份相关的动作收敛成子命令，并同时产出面向人的文本与面向机器的结构化结果。它与相邻模块的分界是：command 只执行"已经表达清楚的意图"，不判断用户是否真的想删除、不负责把自然语言翻译成参数；路径边界与凭据读取虽在进程内完成，但判断规则属于 guard，文案组织属于 skill。

### 2.2.1 Capabilities

【实现】能力面共 20 个子命令，分为六组。所有子命令支持 `--json`；成功以退出码 0 表示，失败以非零退出码表示。

| 组 | 子命令 | 作用与关键规则 | 默认行为 |
|---|---|---|---|
| 身份 | `login` / `logout` / `whoami` / `vip` | 取授权地址、回填授权码、清除本机凭据、查登录状态、返回会员收银台入口 | `whoami` 未登录时退出码 0 但状态为未登录；`vip` 固定返回移动端与桌面端两条链接 |
| 容量 | `quota` | 只读返回账号整体容量，非应用目录占用 | 剩余量按"总量减已用、下限为零"计算 |
| 传输 | `upload` / `download` / `transfer` | 上传、下载（含分享链接下载）、分享转存 | 上传默认同名另存；下载遇分享链接先转存再下载 |
| 文件 | `ls` / `share` / `mkdir` / `mv` / `cp` / `rename` / `rm` | 列目录、创建分享、建目录、移动、复制、重命名、删除 | `share` 有效期默认 7 天，取值 0/1/7/30 |
| 检索 | `search` / `search-content` / `get-content` / `get-content-result` | 文件名检索、正文片段检索、读正文、查解析结果 | `search` 每页 5 条、上限 50；`search-content` 每页 10 条、上限 50 |
| 运维 | `init` / `version` / `update` / `uninstall` | 显示安装信息、版本与更新检查、技能包更新、卸载 | 更新必须由用户显式触发，不自动执行 |

公共参数：`--agentname`、`--session-input`、`--session-id` 用于来源与会话归因，缺失不阻断执行；`--uid`、`--traceid` 仅用于回端链接归因，缺失不影响链接生成；`--config-path`、`--no-check-update` 为全局开关。路径参数一律相对于授权根；绝对路径必须位于授权根内。软链接与 `..` 段、编码穿越形式在本地拒绝。

输出形态有三种：统一信封（含 `code`/`data`/`error`）、裸对象（如分享、转存、文件管理结果）、顶层数组或列表对象（如 `ls` 返回数组、`search` 返回 `items`）。这三种形态是现状事实，本方案在第 3.2 节给出统一信封的收敛设计（【拟议】P-01），在收敛完成前，调用方必须按命令分别取字段。

### 2.2.2 Key Decisions

- 写入类命令先做冲突预检，再决定新建、另存或覆盖：直接覆盖会让旧版本无声消失。
- 结果不确定时先查询后重试，不重发写请求：盲目重试会产生重复文件或重复转存任务。
- 退出码只分成功与非零两档，中间态用结构化字段表达：把进行中当失败会让上游自动重试。
- 链接只透传不拼接：自行拼接的回端链接会 404，或把身份参数带错。
- 恢复策略：批量操作完整返回数组、失败项带错误；确认凭证绑定对象集合，集合变化立即失效。

### 2.2.3 Contracts

```ts
interface CommandInvocation {
  command: string;                        // 如 "upload"、"search-content"
  positional: string[];                   // 位置参数
  flags: Record<string, string | boolean>; // 解析后的开关与值
  context: AgentContext;                  // 归因上下文，全部可选
  format: "text" | "json";                // --json 决定
}

interface AgentContext {
  agentName?: string;                     // --agentname
  sessionInput?: string;                  // --session-input，逐字原文
  sessionId?: string;                     // --session-id，形如 1784035443-a1b2c3
  uid?: string;                           // --uid，宿主注入
  traceId?: string;                       // --traceid，宿主注入
}

interface ResultEnvelope<T> {
  code: 0 | 1;
  data: T | null;
  error: string;                          // 失败原因；成功为空串
  exitCode: number;                       // 0 成功，非零失败，与 code 同步
}

interface ReturnLink {
  returnUrl?: string;                     // 不透明值，禁止改写
  returnHint?: string;                    // 展示提示，当前固定"点击查看"
  returnMarkdown?: string;                // 预渲染的 Markdown 链接，优先原样输出
  returnTargetType?: "directory" | "file_preview";
  clientReturnTargetType?: "file" | "directory";
}

interface FileItem extends ReturnLink {
  fsid: string;                           // 必须为字符串，避免精度丢失
  path: string;                           // 服务端路径
  name: string;
  size: ByteCount;
  isDir: boolean;
  md5: string;
  mtime: string;                          // ISO 8601 带时区
  category: number;
}

interface UploadOutcome extends ReturnLink {
  action: "created" | "renamed" | "overwritten" | "unchanged" | "unknown";
  requestedPath: string;                  // 请求时的目标
  savedPath: string;                      // 实际落点，面向用户展示用
  conflictDetected: boolean;
  verification: "metadata";               // 仅元数据校验
  contentVerified: false;                 // 未做逐字节校验
  fsid: string;
}

interface TransferOutcome extends ReturnLink {
  status: "completed" | "submitted";
  taskId?: string;
  savedPath?: string;                     // 顶层为共同目标目录
  count?: number;
  files?: Array<FileItem & { savedPath: string }>;
}

interface ContentItem {
  fsid: string;
  name: string;
  path: string;
  content?: string;                       // 文本类或解析完成后有值
  url?: string;                           // 超长正文的签名下载地址，2 小时有效
  taskId?: string;                        // 文档类首次调用只有任务号
  pageStart?: number;
  pageEnd?: number;
  pageNum?: number;
  charCount?: number;
  truncated?: boolean;
  error?: string;
  returnMarkdown?: string;
}

interface SearchHit {
  fsid: string;
  fileName: string;
  path: string;
  snippet: string;                        // 可能是"索引生成中"占位文案
  fileUrl: string;                        // 本命令唯一的链接字段
  fileUrlTarget: "file" | "directory";
  sourceRefId: string;
}

abstract class CommandSurface {
  abstract run(invocation: CommandInvocation): Promise<ResultEnvelope<unknown>>;
  abstract describe(command: string): CommandSpec;   // 帮助与能力自查
}
```

错误约定：参数解析失败、路径越界、未登录属于本地可判定失败，退出码非零且不发起网络请求；上游失败保留上游错误号并映射为第 5 章统一码；部分成功（多文件读取、批量删除）以"数组完整返回 + 失败项带 `error` + 整条命令非零退出"表达，禁止只返回失败项而丢掉成功项。

### 2.2.4 Flows

上传的冲突处理是命令层最需要固定顺序的一段：预检、决策、执行、结果归一，任何一步失败都不得回退成"先删后传"。

```ts
async function runUpload(inv: CommandInvocation): Promise<ResultEnvelope<UploadOutcome>> {
  const [local, remote] = inv.positional;
  const verdict = gate.checkPath(remote, { allowRoot: true });      // 越界直接拒绝
  if (!verdict.allowed) return fail("BDPAN_PATH_OUT_OF_SCOPE", verdict.reason);

  const target = await surface.listParent(remote);                  // 读父目录，判断同名与类型
  const overwrite = inv.flags["overwrite"] === true;
  if (target.exists && target.isDir) return fail("BDPAN_INVALID_ARG", "目标是目录");
  if (target.exists && !overwrite && target.sameContent) {
    return ok({ action: "unchanged", savedPath: target.savedPath, contentVerified: false });
  }
  if (target.exists && !overwrite) {
    return ok({ action: "renamed", savedPath: `${target.savedPath}.1`, conflictDetected: true });
  }
  if (target.exists && overwrite) {
    if (!inv.context.userConfirmedOverwrite) return fail("BDPAN_CONFIRM_REQUIRED", "覆盖需在会话中确认");
  }

  const receipt = await kernel.upload({ localPath: local, remotePath: remote, conflictPolicy: overwrite ? "overwrite" : "rename" });
  const link = await linker.forFile(receipt.fsid);                  // 失败不影响上传结论
  return ok({ action: overwrite ? "overwritten" : "created", savedPath: toUserPath(receipt.path), fsid: receipt.fsid, ...link });
}
```

转存的关键在于把"已提交"与"已完成"分开表达；正文检索的关键在于每条命中都必须带上自己的链接，且链接字段名与其他命令不同。

```ts
async function runTransfer(inv: CommandInvocation): Promise<ResultEnvelope<TransferOutcome>> {
  const share = parseShareLink(inv.positional[0]);                  // 解析分享标识与可选提取码
  const dest = inv.flags["dir"] ?? defaultTransferDir();            // 缺省按日期建目录
  const target = gate.checkPath(dest, { allowRoot: true });
  if (!target.allowed) return fail("BDPAN_PATH_OUT_OF_SCOPE", target.reason);

  const submitted = await kernel.transfer({ share, pwd: inv.flags["-p"] ?? share.pwd, dest });
  if (submitted.completed) {                                       // 同步完成
    return ok({ status: "completed", count: submitted.files.length, files: submitted.files.map(withUserPath) });
  }
  return ok({ status: "submitted", taskId: submitted.taskId });     // 只承诺"已提交"
}
```

其他命令的差异：`ls` 直接返回数组，每项带链接；`search` 返回带 `items` 的对象；`search-content` 返回 `data.hits`，链接字段为 `file_url`；`get-content` 返回数组且文档类只有任务号；`rm` 仅在显式传入强制开关且已确认时执行；`share` 与 `version` 不接受授权根之外的参数。

### 2.2.5 Acceptance

| 编号 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|
| CM-01 | 已登录，授权根内无同名文件 | `upload ./a.pdf a.pdf --json` | `code=0`，`action=created`，`saved_path` 为"我的应用数据/bdpan/a.pdf" |
| CM-02 | 授权根内已有同名不同内容文件 | `upload ./a.pdf a.pdf --json` | 返回 `action=renamed`，新增带后缀副本，旧文件保留 |
| CM-03 | 同上 | `upload ./a.pdf a.pdf --overwrite --json`（未经确认） | 非零退出，`BDPAN_CONFIRM_REQUIRED`，远端不变 |
| CM-04 | 目标路径含 `../` | `upload ./a.pdf ../escape.pdf --json` | 本地拒绝，不发起请求，退出码非零 |
| CM-05 | 分享链接有效且无提取码要求 | `transfer <链接> --json` | 返回 `files[]` 与逐项保存路径；每项含 `return_markdown` |
| CM-06 | 分享链接需要提取码 | `transfer <链接> --json` | 失败并返回 `BDPAN_SHARE_PWD_REQUIRED`，提示补充提取码 |
| CM-07 | 服务端返回已提交 | `transfer select <链接> --fsid ... --json` | `status=submitted`，保留 `task_id`，不宣称完成 |
| CM-08 | 目录内有 3 个文件 | `ls --json` | 顶层数组、3 项、每项含字符串 `fsid` 与 `return_markdown` |
| CM-09 | 存在可检索文件 | `search report --json` | 结果位于 `items[]`，逐项含 `return_markdown` |
| CM-10 | 存在命中文档 | `search-content 验收 --json` | `data.hits[]` 每项含 `file_url`，无 `return_markdown` |
| CM-11 | 文档类文件 | `get-content <fsid> --json` | 返回 `task_id` 与链接，无 `content`；后续 `get-content-result` 取正文 |
| CM-12 | 多文件读取中一项不存在 | `get-content <a> <b> --json` | 数组完整、失败项带 `error`、整条命令非零退出 |
| CM-13 | 未登录 | 任意文件命令 | 提示未登录并引导授权，退出码非零，不发起文件请求 |
| CM-14 | 带 `--json` | 任意命令 | 标准输出可被解析；进度与提示写标准错误 |
