---
title: guard 安全闸门
description: 路径边界、凭据、危险动作与脱敏。
sidebar:
  order: 5
---
## 2.5 Guard

guard 是安全闸门：它在任何请求离开进程之前，判断路径是否落在授权根内、凭据是否可用且不会被泄露、危险动作是否满足前置条件，并在日志与错误信息中统一脱敏。它与相邻模块的分界是：guard 不生成业务结果、不决定用户看到什么话术、不缓存文件元数据；它只给出"允许/拒绝/需要确认"三类裁决与理由。

### 2.5.1 Capabilities

【部分实现】路径与凭据判断已在命令层与行为层各自落地；统一为独立职责、由所有入口共同调用，属【拟议】P-03。

| 能力 | 规则 |
|---|---|
| 路径归一 | 相对路径一律相对授权根解析；绝对路径必须位于授权根内；归一后再次校验，防止"先通过后穿越" |
| 穿越拒绝 | 拒绝独立父目录段 `..`、其编码形式（如 `%2e%2e`）、`~` 展开、NTFS 交替数据流与末尾点号截断等平台特例 |
| 合法点号保留 | 普通名称中的连续点号（`xxx..mp4`、`会议...docx`）原样保留，不得为"通过校验"而删点、解码或改名 |
| 重命名约束 | 重命名的第二参数必须是单个名称，不能包含 `/` 或 `\`；创建目录允许逐级路径 |
| 双向映射 | 调用命令时使用 `/apps/...` 形式；展示给用户时映射为"我的应用数据/..."；映射只做展示，不改变调用参数 |
| 凭据读取 | 只从本机凭据库读取；不得输出其内容；授权码只经标准输入传递，不出现在命令行参数与进程列表中 |
| 凭据刷新 | 到期前自动刷新；刷新失败视为需要重新授权，不静默降级 |
| 危险动作 | 删除、显式覆盖、下载同名覆盖必须有"明确意图 + 明确确认"凭证；缺少凭证一律拒绝 |
| 日志脱敏 | 调试日志与错误附带信息中，令牌、刷新令牌、密钥、会话密钥一律掩码；响应体截断后保留 |
| 完整性 | 安装包与更新包必须校验哈希；校验失败删除临时文件并终止 |
| 隔离 | 不读写工作区之外的凭据目录；不把令牌写入任何输出、临时文件或崩溃转储 |

### 2.5.2 Key Decisions

- 准入与执行分离，所有出网请求先过闸门：否则路径穿越与越权读写成单点疏忽。
- 先归一后校验，拒绝独立父目录段与编码穿越，保留合法连续点号：删点改名会误伤正常文件。
- 拒绝与"需确认"分开：前者不可重试，后者可重试；混用会让可恢复操作被判死。
- 凭据只读不写日志，授权码经标准输入：凭据一旦进入进程列表或日志即泄露。
- 恢复策略：刷新失败即要求重新授权；确认凭证绑定对象集合，主体切换或集合变化立即失效。

### 2.5.3 Contracts

```ts
interface PathVerdict {
  allowed: boolean;
  normalized: string;                      // 归一后的服务端路径；拒绝时为空串
  displayPath: string;                     // 面向用户的路径
  reason: "ok" | "traversal" | "outside-root" | "encoded-traversal" | "tilde" | "invalid-name" | "platform-trap";
}

interface ActionGateInput {
  action: "delete" | "overwrite" | "download-overwrite" | "transfer" | "restore";
  objects: Array<{ path: string; kind: "file" | "dir" }>;
  confirmation?: { grantedAt: string; scope: string[] };  // 确认凭证：时间 + 对象集合
}

interface ActionGateDecision {
  decision: "allow" | "deny" | "confirm";
  code?: string;                           // deny 或 confirm 时的错误码
  reason: string;
}

interface CredentialRef {
  accountRef: string;                      // 账号引用，可出现在日志中
  expiresAt: string;                       // ISO 8601
}

interface Guard {
  checkPath(input: string, options?: { allowRoot?: boolean; singleName?: boolean }): PathVerdict;
  checkAction(input: ActionGateInput): ActionGateDecision;
  readCredential(): Promise<CredentialRef | null>;
  refreshCredential(): Promise<CredentialRef>;
  redact(value: unknown): unknown;
}
```

错误约定：拒绝必须携带稳定错误码与可读原因，原因中不得回显敏感值；"需要确认"与"拒绝"必须区分，前者可重试，后者不可。

### 2.5.4 Flows

```ts
function checkPath(input: string, opts: { allowRoot?: boolean; singleName?: boolean }): PathVerdict {
  if (opts.singleName && /[\\/]/.test(input)) return deny("invalid-name", "名称不能包含路径分隔符");
  if (input.includes("~")) return deny("tilde", "不支持家目录展开");

  const decoded = decodeRepeatedly(input, 2);            // 防双重编码穿越
  if (hasStandaloneDotDot(decoded)) return deny("traversal", "包含父目录段");

  const joined = input.startsWith("/") ? input : `${ROOT}/${input}`;   // ROOT = /apps/bdpan
  const normalized = normalize(joined);                  // 折叠重复分隔符、去掉末尾斜杠
  if (normalized !== ROOT && !normalized.startsWith(`${ROOT}/`)) {
    return deny("outside-root", "路径超出授权根");
  }
  if (opts.singleName && normalize(input) === "") return deny("invalid-name", "名称为空");

  return { allowed: true, normalized, displayPath: toDisplay(normalized), reason: "ok" };
}
```

删除的裁决顺序是：先归一与越界判断，再核对确认凭证覆盖的对象集合（集合不一致即要求重新确认），最后才放行；覆盖上传额外要求"目标当前存在"这一事实来自刚刚完成的目录读取，而不是缓存。

### 2.5.5 Acceptance

| 编号 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|
| GD-01 | 任意 | 传入 `/apps/bdpan/a/../b.txt` | 拒绝，`reason=traversal`，不发起请求 |
| GD-02 | 任意 | 传入 `%2e%2e/%2e%2e/etc/passwd` | 拒绝，`reason=encoded-traversal` |
| GD-03 | 任意 | 传入 `/apps/other/file.txt` | 拒绝，`reason=outside-root` |
| GD-04 | 任意 | 传入 `a..b/文件..txt` | 允许，名称中的连续点号被原样保留 |
| GD-05 | 任意 | 重命名新名为 `x/y` | 拒绝，`reason=invalid-name` |
| GD-06 | 删除已确认对象 | 确认集合与目标集合一致 | 放行 |
| GD-07 | 删除 | 确认集合少于目标集合 | 返回"需要确认"，不放行 |
| GD-08 | 已登录 | 任意命令开启调试 | 日志中无明文令牌、密钥、授权码 |
| GD-09 | 授权码提交 | 检查进程列表 | 授权码不出现在参数中 |
| GD-10 | 安装包哈希不符 | 执行安装 | 删除临时文件并终止，提示完整性校验失败 |
| GD-11 | 展示路径 | 列出 `/apps/bdpan/docs/a.pdf` | 用户可见文本为"我的应用数据/bdpan/docs/a.pdf" |
| GD-12 | 凭据过期 | 调用文件命令 | 先刷新；刷新失败返回需要重新授权，不静默失败 |
