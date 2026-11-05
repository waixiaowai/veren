---
title: 存储
description: "保存大对象并安全地发放地址：六方法抽象、本地与对象存储双实现、三前缀策略、签名与过期、引用授权与真实路径校验。"
sidebar:
  order: 14
  label: 14 存储
draft: false
lastUpdated: 2026-11-04
---

## 14. Storage

存储模块负责"大对象放哪里、谁能引用、凭什么能下载"。它把文件写入本地目录或对象存储，发放有时效的读取地址，并用授权表回答"这个租户能不能引用这个键"。它不解析业务含义，附件挂在哪条消息上由 [会话](./conversation/) 决定；它也不决定谁能看这个会话，那取决于 [工作区](./workspace/) 的边界。它守两条线：元数据以存储为准，地址一律带时限。

### 14.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 六方法对象抽象与两种实现的语义对齐 | 附件与消息的绑定关系（`Conversation`） |
| 对象键的归一化、前缀白名单与命名 | 邮件附件的业务归属（`Email`） |
| 预签名直传、能力查询与上传上限 | 图片压缩与缩略图生成（端或生成服务） |
| 签名地址的签发、过期与按需重签 | 头像由谁生成、生成几次（`Agent`） |
| 引用授权表与租户范围内的键校验 | 租户与角色（`Workspace`） |
| 存储元数据作为大小与类型的权威 | 文本抽取与视觉能力判定（`Turn`） |
| 能力查询（模式、是否支持直传、上限与白名单） | 客户端的上传交互与进度展示（端） |
| 本地读取的路径与符号链接校验 | 边缘缓存策略的部署（运维） |

### 14.2 Capabilities

- **六个方法就是全部契约**：写入、预签名、元数据、公开地址、前缀列举、删除。删除永不抛出，只返回是否真的删掉，清理任务据此重试；列举只用于对账与回收，不用于业务读。
- **两种实现，同一套语义**：对象存储走预签名直传，签名绑定内容长度，浏览器无法上传更大的对象；本地模式不支持预签名，客户端必须先问能力端点，再决定直传还是经服务端上传。上层只看到同一组方法，差异只体现在能力响应里。
- **三个前缀，只有一个公开**：聊天附件、邮件附件、头像。头像可公开读取，前两者必须签名；键名在写入前归一化，拒绝超长、控制字符、查询与片段符号、空段与上级引用、非白名单前缀。
- **签名带过期与 HMAC**：签名覆盖"键加过期时间"，比较是常量时间；边缘网关只放行读取与探测两种方法，并拒绝有效期超过一天，避免出现永久后门。公开前缀免签，缓存策略与私有对象不同。
- **上传三条上限**：单文件 25MB、一次最多 16 个、合计 25MB；MIME 白名单 24 项，每项定义类别与扩展名，不在表内即 `415`。文件名的展示长度也截断，避免超长名字进入列表。
- **元数据以存储为准**：客户端声明的类型、大小、类别一律被存储侧元数据覆盖后再校验；本地模式用同名边车文件记录类型，避免只凭扩展名判断。
- **授权表决定能不能引用**：对象键必须属于当前租户的授权行（待用、有效、撤销三态），上传成功即记为有效；写入消息时仍要回查元数据，因此被废弃的预签名不能被当成已有附件。
- **读取时按需重签**：气泡里的地址会过期，打开时重新签发；重签同样要求有效授权，过期不等于公开。
- **本地读取三重校验**：词法包含、真实路径包含、打开时拒绝跟随符号链接，且只允许附件前缀；任何一层不通过即拒绝，不做尽力而为的读取。
- **直传与中转共用一套校验。** 直传只签写入方法并绑定长度，中转走更大的请求体上限；两条路径落库前都要过同一套归一键名、授权与元数据校验，不因为走了快路径就少校验一项。
- **对账是内建能力。** 按前缀列举加元数据比对，可以回答"哪些键有引用但对象不见了"与"哪些对象已经没人引用"；对账只读，实际删除交给清理任务。
- **键与地址的转换是单向的。** 只接受站内地址或已配置的公开基址，任意绝对地址永不视为存储引用，避免本模块被当成任意外链的代理；键与地址同时给出且指向不同对象时按无效处理，不做二选一猜测。
- **键名与展示名分离。** 键是随机生成且带扩展名的稳定标识，展示名只存在于描述符里；改名不产生新对象，避免同一份内容因为改标题被存两遍。
- **密钥缺失要响亮。** 签名密钥没配置时不做无签名地址，而是告警并按拒绝处理；上传失败、签名失败、对账差异都计入指标，便于在用户报错前发现问题。
- **列举与删除只服务清理。** 两者都不参与业务读，因此不暴露给端；删除不抛出、列举有前缀边界，避免一次清理误扫整个桶。

### 14.3 Contracts

```ts
type StorageMode = 'local' | 'r2'
type StoragePrefix = 'attachments' | 'email-attachments' | 'avatars'
type GrantStatus = 'pending' | 'active' | 'revoked'
type AttachmentKind = 'img' | 'pdf' | 'file' | 'fig'

interface ObjectMetadata { key: string; sizeBytes: number; mime: string; updatedAt: string }
interface SignedUrl { url: string; expiresAt: string }          // exp 与 HMAC 都在地址里
interface UploadTicket { key: string; uploadUrl: string; expiresAt: string; maxBytes: number }

interface AttachmentGrant { storageKey: string; companyId: string; status: GrantStatus; createdAt: string }

interface AttachmentDescriptor {
  key: string
  name: string                 // 仅展示用途，已截断
  sizeBytes: number            // 取自存储元数据，不取客户端声明
  mime: string                 // 同上
  kind: AttachmentKind
}

interface UploadLimits { maxFiles: 16; maxFileBytes: number; maxTotalBytes: number; allowedMime: readonly string[] }

abstract class ObjectStore {                    // 六方法，两个实现共用
  abstract readonly mode: StorageMode
  abstract put(key: string, body: Uint8Array, mime: string): Promise<ObjectMetadata>
  abstract presignPut(key: string, mime: string, sizeBytes: number, ttlSeconds?: number): Promise<UploadTicket | null>
  abstract statObject(key: string): Promise<ObjectMetadata | null>
  abstract publicUrl(key: string, ttlSeconds?: number): Promise<SignedUrl>
  abstract listObjectsByPrefix(prefix: string): Promise<string[]>
  abstract deleteObject(key: string): Promise<boolean>        // 永不抛出，返回是否删除
}

abstract class StorageService {
  abstract authorizeUpload(scope: Scope, input: UploadInput): Promise<UploadTicket | AttachmentGrant>
  abstract resolveAttachments(scope: Scope, submitted: AttachmentInput[]): Promise<AttachmentDescriptor[]>
  abstract readUrl(scope: Scope, key: string): Promise<SignedUrl | { path: string }>
  abstract refreshUrl(scope: Scope, key: string): Promise<SignedUrl>
  abstract revoke(key: string, companyId: string): Promise<void>
}
```

错误约定：键不合法或 MIME 不在白名单返回 `415`；超过大小或数量上限返回 `413`；对象不存在返回 `404`；没有有效授权返回 `403` 且不区分"不属于你"与"不存在"；签名过期不是业务错误，客户端重取一次地址即可。稳定码见 [错误码与状态模型](../errors/)。

### 14.4 Flow

```ts
async function resolveAttachments(deps: StorageDeps, scope: Scope, submitted: AttachmentInput[]): Promise<AttachmentDescriptor[]> {
  if (submitted.length > deps.limits.maxFiles) throw new StorageError('ATTACHMENT_TOO_MANY', 413)
  const resolved: AttachmentDescriptor[] = []
  for (const item of submitted) {
    const key = deps.keys.normalize(item.key)                        // 前缀、空段、上级引用、控制字符
    if (!key || !deps.mime.isAllowed(item.mime)) throw new StorageError('ATTACHMENT_UNSUPPORTED', 415)
    if (item.sizeBytes > deps.limits.maxFileBytes) throw new StorageError('ATTACHMENT_TOO_LARGE', 413)
    // 授权表先判"这个租户能不能引用这个键"，再判对象是否真的存在
    if (!(await deps.grants.hasActive(scope.companyId, key))) throw new StorageError('ATTACHMENT_FORBIDDEN', 403)

    // 元数据以存储为准：客户端声称的大小与类型一律被覆盖
    const stat = await deps.store.statObject(key)
    if (!stat) throw new StorageError('ATTACHMENT_MISSING', 404)
    if (stat.sizeBytes > deps.limits.maxFileBytes || !deps.mime.isAllowed(stat.mime)) {
      throw new StorageError('ATTACHMENT_UNSUPPORTED', 415)
    }
    resolved.push({ key, name: deps.trim(item.name, 200), sizeBytes: stat.sizeBytes, mime: stat.mime, kind: deps.mime.kindOf(stat.mime) })
  }
  const total = resolved.reduce((sum, item) => sum + item.sizeBytes, 0)
  if (total > deps.limits.maxTotalBytes) throw new StorageError('ATTACHMENT_TOTAL_TOO_LARGE', 413)
  return resolved
}

async function readUrl(deps: StorageDeps, scope: Scope, key: string): Promise<SignedUrl | { path: string }> {
  if (!(await deps.grants.hasActive(scope.companyId, key))) throw new StorageError('ATTACHMENT_FORBIDDEN', 403)
  const stat = await deps.store.statObject(key)
  if (!stat) throw new StorageError('ATTACHMENT_MISSING', 404)
  if (deps.store.mode === 'local') {
    // 词法包含与真实路径包含都要过，最后以不跟随符号链接的方式打开
    const real = await deps.fs.realpathWithin(deps.store.root, key)
    if (!real) throw new StorageError('ATTACHMENT_FORBIDDEN', 403)
    return { path: real }
  }
  return deps.store.publicUrl(key, deps.limits.urlTtlSeconds)         // 带 exp 与 HMAC，边缘有上限
}
```

分支说明：先判授权再判存在，避免用"不存在"回答"你没有权限"而泄漏对象是否存在；大小与类型以存储元数据为准，客户端声明只在展示时使用，因此改扩展名骗不过校验；总量在逐项校验之后才算，任何一项失败都不会写入附件数组，消息侧拿不到半份结果；本地分支的真实路径校验失败即拒绝，不尝试"退回到词法路径"。

### 14.5 Recovery and Idempotency

- **签名过期**：读取时重新签发，客户端只需在收到拒绝后重取一次地址；不把过期地址写进持久化的消息体。
- **对象缺失**：按缺失处理并提示重新上传，不返回半截内容，也不把缺失当成空文件。
- **授权悬挂**：上传成功但业务始终未引用时，授权停在待用或有效状态；由清理任务按窗口回收，窗口长度待确认。
- **删除永不抛出**：失败返回否，留待下一轮清理；已经断开引用的对象最终由对账任务处理，不影响业务响应。
- **本地逃逸**：真实路径校验失败即拒绝，不降级；符号链接、越界相对路径、非附件前缀都属于拒绝而不是纠正。
- **签名密钥轮换**：旧密钥在窗口内继续验签，窗口外一律拒绝；双密钥窗口长度待确认，轮换期间不要求客户端做任何事。
- **对象存储不可用**：元数据仍可写，但写入与读取都会失败；读取按缺失处理并提示重新上传，不把失败伪装成空文件，也不把附件说成已就绪。

### 14.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| ST-01 | 已登录且属于当前工作区 | 上传一个 25MB 内的白名单文件并引用它 | 返回对象键与来自存储的元数据；下载地址带过期与签名，过期后重新请求得到新地址，内容字节一致 |
| ST-02 | 上传对象实际是压缩包 | 以图片类型提交并引用 | 返回 `415`；消息未写入，附件数组为空，存储中不存在被改写的类型记录 |
| ST-03 | 对象键属于另一个租户 | 在当前工作区引用该键 | 返回 `403`，响应不区分不存在与无权限；该键未被绑定，另一租户的读取不受影响 |
| ST-04 | 已有 16 个附件 | 追加第 17 个或使合计超过 25MB | 返回 `413`；整批不写入，已有附件不受影响，重试上传更小的集合可以成功 |
| ST-05 | 同一对象键重复上传并授权 | 并发提交两次引用 | 授权行唯一（同键同租户只有一行），两次都成功且消息侧各只有一份引用，无重复计数 |
| ST-06 | 本地模式，附件目录内存在指向目录外的符号链接 | 通过该链接读取 | 返回 `403`；读取未发生，符号链接目标内容没有被返回，其他正常文件仍可读 |
| ST-07 | 边缘网关收到有效期为两天的签名地址 | 请求该地址 | 被拒绝，因为超出一天的有效期上限；改为一天以内的地址后正常返回，私有对象缓存标记为私有 |
| ST-08 | 一个预签名地址已过期且上传从未完成 | 把该键当作附件引用提交 | 返回 `403` 或 `404`；消息未写入，授权行状态未因此变成有效，键不会被当作已有对象 |
| ST-09 | 同一文件分别经直传与中转上传 | 两次都引用并发起下载 | 两条路径的元数据一致，下载内容字节相同；上限判定一致，直传超长与中转超长都返回 `413` |
| ST-10 | 客户端把任意外部绝对地址当作附件地址 | 提交该地址作为引用 | 返回 `415` 或 `403`；服务端不发起任何外部抓取，也不把该地址写进消息；改用站内基址的地址后成功 |
| ST-11 | 某个键仍有消息引用，但对象已被外部删除 | 打开该附件 | 返回 `404` 并提示重新上传；对账报告该键引用存在而对象缺失，消息其余部分仍可正常读取 |
| ST-12 | 同一对象已被删除 | 再次删除同一键 | 返回未删除但不报错，清理任务不因此中断，其他对象可正常读写 |
| ST-13 | 头像对象与聊天附件各一个 | 直接请求两者的地址 | 头像无需签名即可读取且缓存较久；聊天附件缺签名时被边缘拒绝，带签名后可读且缓存为私有 |
