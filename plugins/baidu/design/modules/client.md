---
title: client 开发库内核
description: 嵌入式能力内核：契约、上传下载编排与错误分类。
sidebar:
  order: 1
---
## 2.1 Client

client 是嵌入型能力内核：它以库的形式把网盘的读写、检索与上传下载编排暴露给开发者，负责参数校验、请求重试、错误分类与结果归一化。它与相邻模块的分界是：client 不做意图识别、不生成面向人的文案、不判断"该不该覆盖"，这些分别属于 skill 与 command；client 也不持有账号凭据，凭据由调用方在初始化时注入。

### 2.1.1 Capabilities

【实现】以两层组织：底层与开放平台接口一一对应（授权、用户、容量、列表、语义搜索、文件管理、上传三段、下载两段），上层做业务编排（自动取用户标识、冲突前置检查、分片与重试、目录列表归一化）。下列能力为契约面，不随实现语言变化。

| 能力 | 行为与规则 | 关键约束 | 状态 |
|---|---|---|---|
| 授权：授权码换令牌 | 用应用标识、密钥与授权码换取访问令牌与刷新令牌 | 服务密钥不得出现在日志中 | 【实现】 |
| 授权：设备码 | 申请设备码与用户码，轮询换取令牌，适合无浏览器环境 | 设备码有效期短，过期需重新申请 | 【实现】 |
| 授权：刷新 | 用刷新令牌换新令牌 | 刷新失败意味着刷新令牌失效，必须重新授权 | 【实现】 |
| 用户资料 | 取账号名、头像、会员类型、用户标识 | 会员类型以服务端返回为准，不推断 | 【实现】 |
| 容量 | 取总容量、已用、剩余与到期提示 | 剩余量按"总量减已用、下限为零"计算，不采用服务端"免费容量"字段 | 【实现】 |
| 目录列表 | 按目录、排序、偏移、数量、是否仅目录取条目 | 单传数量而不传偏移时服务端会忽略数量 | 【实现】 |
| 语义搜索 | 按自然语言查询、目录范围、类型过滤、数量上限检索 | 目录范围需要用户标识，内核负责取用并缓存 | 【实现】 |
| 上传 | 预创建、分片上传、创建文件三段；命中秒传则跳过后续 | 分片默认 4 MB；每段失败重试三次，间隔 1/2/4 秒 | 【实现】 |
| 下载 | 取直链后流式写入本地，失败清理半成品 | 不把整文件读入内存 | 【实现】 |
| 文件管理 | 复制、移动、重命名、删除、创建目录；写前检查源与目标 | 目标已存在时默认返回"已存在"而不是覆盖 | 【实现】 |
| 错误分类 | 把四种上游错误形态归一为统一失败对象，保留脱敏诊断信息 | 诊断信息截断，凭据字段脱敏 | 【实现】 |
| 调用可取消 | 所有方法接受可取消上下文 | 取消后不得继续写入本地文件 | 【实现】 |

### 2.1.2 Contracts

```ts
type UnixSeconds = number;
type ByteCount = number;

interface ClientConfig {
  accessToken?: string;          // 访问令牌；为空表示匿名客户端（仅授权类方法可用）
  baseUrl?: string;              // 服务基址，缺省为官方地址
  uploadBaseUrl?: string;        // 分片上传基址，缺省为官方地址
  httpTimeoutMs?: number;        // 单请求超时，缺省 30000
  debug?: boolean;               // 调试日志，默认 false；输出必须脱敏
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;      // 距过期秒数
  scope: string;                 // 授权范围，原样保存
}

interface AccountProfile {
  uid: string;                   // 账号唯一标识（字符串，避免大整数精度丢失）
  displayName: string;
  vipType: 0 | 1 | 2;            // 0 普通，1 会员，2 超级会员
}

interface QuotaSnapshot {
  totalBytes: ByteCount;
  usedBytes: ByteCount;
  freeBytes: ByteCount;          // max(total - used, 0)
  expireWithin7Days: boolean;    // 仅表示 7 天内是否有容量到期
}

interface FileEntry {
  fsid: string;                  // 字符串形式的文件标识，必填
  path: string;                  // 服务端路径，必填
  name: string;                  // 文件名，必填
  isDir: boolean;
  size: ByteCount;               // 目录为 0
  category: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  md5: string;                   // 目录为空串
  serverMtime: UnixSeconds;
  serverCtime: UnixSeconds;
}

interface UploadRequest {
  localPath: string;             // 必填，本地普通文件
  remotePath: string;            // 必填，必须以 "/" 开头且落在授权根内
  sliceBytes?: number;           // 缺省 4 MiB
  conflictPolicy?: "fail" | "rename" | "overwrite"; // 缺省 fail
}

interface UploadReceipt {
  fsid: string;
  path: string;
  bytes: ByteCount;
  md5: string;
  viaFastUpload: boolean;        // 是否命中秒传
}

interface DownloadRequest {
  fsid: string;                  // 必填
  localPath: string;             // 必填，父目录必须已存在
}

interface DownloadReceipt {
  path: string;                  // 服务端路径
  localPath: string;
  bytes: ByteCount;
  md5: string;
}

interface ApiFailure extends Error {
  code: string;                  // 见第 5 章统一错误码
  retryable: boolean;
  upstreamCode?: number;         // 上游原始错误号，仅用于排查
  diagnostics: { method?: string; url?: string; bodyDigest?: string };
}

interface TransferQuery {
  taskId: string;
}

interface TransferState {
  taskId: string;
  status: "submitted" | "running" | "succeeded" | "partial" | "failed" | "unknown";
  files: Array<{ fsid: string; savedPath: string; bytes: ByteCount }>;
}

interface ClientKernel {
  auth: {
    codeToToken(appKey: string, secretKey: string, code: string): Promise<AuthTokens>;
    deviceCode(appKey: string): Promise<{ deviceCode: string; userCode: string; expiresInSeconds: number }>;
    deviceToken(appKey: string, secretKey: string, deviceCode: string): Promise<AuthTokens>;
    refresh(appKey: string, secretKey: string, refreshToken: string): Promise<AuthTokens>;
  };
  profile(): Promise<AccountProfile>;
  quota(): Promise<QuotaSnapshot>;
  listDir(dir: string, options?: { order?: "name" | "time" | "size"; desc?: boolean; start?: number; limit?: number; folderOnly?: boolean }): Promise<FileEntry[]>;
  search(query: { text: string; dir?: string; categories?: number[]; limit?: number }): Promise<FileEntry[]>;
  upload(request: UploadRequest): Promise<UploadReceipt>;
  download(request: DownloadRequest): Promise<DownloadReceipt>;
  copy(src: string, destDir: string, newName: string, onDup?: "fail" | "overwrite" | "rename" | "skip"): Promise<void>;
  move(src: string, destDir: string, newName: string): Promise<void>;
  rename(src: string, newName: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  mkdir(path: string): Promise<void>;
  queryTransfer(task: TransferQuery): Promise<TransferState>;
}
```

错误约定：参数为空、路径不以 `/` 开头、文件标识为空串等本地校验失败，直接以 `ApiFailure` 抛出且 `retryable=false`、`upstreamCode` 缺省；上游返回非零错误号时，`upstreamCode` 必有值，是否可重试按第 5 章映射表判定；网络中断与超时归为可重试，但上传的"创建文件"一步在超时后属于结果不确定，必须由调用方以结果查询确认，不得盲目重试（避免产生重复文件）。

### 2.1.3 Flows

下面的伪代码说明上传入口的调用顺序、分支与失败处理；下载与检索只在差异处注明，不重复展开。

```ts
async function upload(kernel: ClientKernel, req: UploadRequest): Promise<UploadReceipt> {
  assertInsideRoot(req.remotePath);                    // 越界直接抛错，不发起请求
  const stat = statLocalFile(req.localPath);           // 不存在或非普通文件 -> 抛错
  const blocks = blockMd5List(stat.path, req.sliceBytes ?? 4 * 1024 * 1024);

  const pre = await retry(3, () => kernel.upload.precreate({
    path: req.remotePath, size: stat.bytes, blocks,
    policy: req.conflictPolicy ?? "fail",
  }));

  if (pre.fastUpload) {                                // 秒传：服务端已有同内容对象
    return { fsid: pre.fsid, path: req.remotePath, bytes: stat.bytes, md5: pre.md5, viaFastUpload: true };
  }

  const partMd5: string[] = [];
  for (const seq of pre.missingParts) {                 // 只上传服务端缺失的分片
    const slice = readSlice(stat.path, seq, blocks.length, req.sliceBytes);
    const uploaded = await retry(3, () => kernel.upload.slice({ ...pre, seq, slice }));
    partMd5.push(uploaded.md5);
  }

  const created = await createWithUncertaintyGuard(pre, partMd5); // 超时后先查询再决定是否重试
  return { fsid: created.fsid, path: created.path, bytes: created.size, md5: created.md5, viaFastUpload: false };
}
```

下载的差异在于两步（取直链、流式写入），写入失败必须删除本地半成品；检索的差异在于先取用户标识再拼目录范围，标识缓存失败时下一次调用重新获取，不缓存空值。

### 2.1.4 Acceptance

| 编号 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|
| CA-01 | 持有有效令牌 | 调用上传，目标为授权根内新路径 | 返回落点与文件标识；远端列表可见该文件；`viaFastUpload` 与实际路径一致 |
| CA-02 | 目标路径已存在且内容不同 | 以默认冲突策略上传同名文件 | 返回"已存在"失败，远端旧文件不变，不产生副本 |
| CA-03 | 本地文件被删除 | 调用上传 | 本地校验即失败，不发起任何请求，`retryable=false` |
| CA-04 | 令牌已过期 | 调用列目录 | 返回令牌过期失败，`retryable=false`，`upstreamCode` 为 20016 |
| CA-05 | 网络在分片阶段中断 | 调用上传 | 三次重试后失败；本地无残留临时文件；远端不出现半成品 |
| CA-06 | 创建文件一步超时 | 调用上传 | 内核先查询结果再决定是否重试，最终最多产生一个远端文件 |
| CA-07 | 目标路径含 `..` 或越出授权根 | 调用上传 | 本地拒绝，`upstreamCode` 缺省 |
| CA-08 | 目标为目录 | 调用上传 | 返回参数非法，不发起写入 |
| CA-09 | 调试模式开启 | 调用授权换令牌 | 日志中访问令牌、刷新令牌、密钥均为掩码 |
