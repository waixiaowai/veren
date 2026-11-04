/**
 * 领域类型：凭据、账号、容量、文件条目与各操作回执。本文件只放类型，
 * 不放任何运行时代码；形状与设计方案《数据字典》一章对齐。
 * Domain types: credentials, account, quota, file entries, and operation
 * receipts. Types only — no runtime code lives here; shapes follow the
 * design doc's data-dictionary chapter.
 *
 * @module @veren/baidu-pan
 */

/** OAuth 令牌三元组（授权流写入凭据记录的载荷）。The OAuth token triple (the payload stored in the credential record). */
export interface OAuthTokens {
  /** 访问令牌；只在请求头/查询参数里瞬时存在。Access token; exists transiently in request params only. */
  accessToken: string
  /** 刷新令牌；过期前换取新令牌。Refresh token; trades for a new pair before expiry. */
  refreshToken: string
  /** 访问令牌到期时间（ISO 8601）。Access-token expiry (ISO 8601). */
  expiresAt: string
  /** 授权范围，服务端返回原样保存。Granted scope, stored verbatim. */
  scope: string
}

/** 账号资料。The account profile. */
export interface AccountProfile {
  /** 账号唯一标识（字符串，避免大整数精度丢失）。Baidu UID (string — no bigint precision loss). */
  uid: string
  /** 展示名（昵称或百度账号）。Display name (nickname or Baidu account). */
  displayName: string
  /** 会员类型：0 普通 / 1 会员 / 2 超级会员。VIP type: 0 normal / 1 VIP / 2 SVIP. */
  vipType: 0 | 1 | 2
}

/** 容量快照。The quota snapshot. */
export interface QuotaSnapshot {
  totalBytes: number
  usedBytes: number
  /** 总量减已用、下限为零；不用服务端"免费容量"字段。max(total - used, 0); the server's "free" field is ignored. */
  freeBytes: number
  /** 仅表示 7 天内是否有容量到期。True only when quota expires within 7 days. */
  expireWithin7Days: boolean
}

/** 文件分类（服务端 category 字段）。The server's file category. */
export type FileCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/** 文件条目（列表/检索归一化后的形状）。A file entry (the normalized list/search shape). */
export interface FileEntry {
  /** 文件标识；一律字符串，杜绝精度丢失。File id; always a string — no precision loss. */
  fsid: string
  /** 服务端路径（授权根内）。Server path (inside the authorized root). */
  path: string
  /** 文件名。The file name. */
  name: string
  isDir: boolean
  /** 字节数；目录为 0。Byte count; 0 for directories. */
  size: number
  category: FileCategory
  /** MD5；目录为空串。MD5; empty for directories. */
  md5: string
  serverMtime: number
  serverCtime: number
}

/** 文件元数据回执（filemetas，含下载直链）。The filemetas receipt (carries the download dlink). */
export interface FileMeta extends FileEntry {
  /** 下载直链（2 小时有效）。Download dlink (valid for 2 hours). */
  dlink: string
}

/** 上传回执。The upload receipt. */
export interface UploadReceipt {
  fsid: string
  path: string
  bytes: number
  md5: string
  /** 是否命中秒传（服务端已有同内容对象）。True when fast-upload hit (the server already held identical content). */
  viaFastUpload: boolean
}

/** 下载回执。The download receipt. */
export interface DownloadReceipt {
  path: string
  /** 本地落点（绝对路径）。The local landing path (absolute). */
  localPath: string
  bytes: number
  md5: string
}

/** 分享回执。The share receipt. */
export interface ShareReceipt {
  /** 分享主链。The share link. */
  link: string
  /** 短链（可能缺省）。Short link (may be absent). */
  shortUrl?: string
  /** 提取码。The extraction password. */
  password: string
  /** 有效期天数。Validity in days. */
  period: number
}

/** 文件管理操作：复制、移动、重命名、删除、建目录。File-management operations. */
export type ManageOp = 'copy' | 'move' | 'rename' | 'delete'

/** 分享参数。Share parameters. */
export interface ShareRequest {
  /** 分享对象的文件标识集合。The fsid set to share. */
  fsids: readonly string[]
  /** 有效期天数（0/1/7/30，官方允许值）。Validity days (0/1/7/30 — the official values). */
  period: number
  /** 提取码（4 位）。The 4-char password. */
  password: string
}
